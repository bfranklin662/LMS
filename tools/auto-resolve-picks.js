#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const API_URL = process.env.LMS_API_URL || "https://lms-api.nick-horne123.workers.dev";
const ADMIN_KEY = process.env.FIXTURE_ADMIN_KEY || process.env.LMS_ADMIN_KEY || "";

const APPLY = process.argv.includes("--apply");

const FIXTURE_SOURCES = [
  { league: "Premier League", file: "site/data/fixtures/premier-league.json" },
  { league: "Championship", file: "site/data/fixtures/championship.json" },
  { league: "League One", file: "site/data/fixtures/league-one.json" },
  { league: "League Two", file: "site/data/fixtures/league-two.json" },
  { league: "FA Cup", file: "site/data/fixtures/fa-cup.json" },
  { league: "World Cup", file: "site/data/fixtures/world-cup.json" },
];

const AUTO_RESOLVE_REPORT_FILE =
  path.join(PROJECT_ROOT, "site", "data", "auto-resolve-report.json");

const autoResolveReport = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "dry-run",
  checked: 0,
  resolved: 0,
  skipped: 0,
  ok: true,
  error: "",
  games: []
};

async function writeAutoResolveReport() {
  await fs.mkdir(path.dirname(AUTO_RESOLVE_REPORT_FILE), { recursive: true });
  await fs.writeFile(
    AUTO_RESOLVE_REPORT_FILE,
    JSON.stringify(autoResolveReport, null, 2) + "\n",
    "utf8"
  );
}

function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

function requireAdminKey() {
  if (!ADMIN_KEY) {
    throw new Error("Missing FIXTURE_ADMIN_KEY or LMS_ADMIN_KEY environment variable");
  }
}

async function api(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON API response (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || !data.ok) {
    throw new Error(data?.error || `API error (${res.status})`);
  }

  return data;
}

async function readJson(relPath) {
  const absPath = path.join(PROJECT_ROOT, relPath);
  const raw = await fs.readFile(absPath, "utf8");
  return JSON.parse(raw);
}

function gwNum(gwId) {
  const m = String(gwId || "").trim().toUpperCase().match(/^GW(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\bfootball club\b/g, "")
    .replace(/\bfc\b/g, "")
    .replace(/\bafc\b/g, "")
    .replace(/\butd\b/g, "united")
    .replace(/\s+/g, " ")
    .trim();
}

function isResolvedOutcome(outcome) {
  const s = String(outcome || "").trim().toUpperCase();
  return s === "WIN" || s === "LOSS" || s === "VOID";
}

function hasFinalScore(match) {
  return Number.isInteger(match?.homeScore) && Number.isInteger(match?.awayScore);
}

function getActualGwIdForGame(displayGwId, game) {
  const startGw = String(game?.startGw || "GW1").trim().toUpperCase();
  const startNum = gwNum(startGw);
  const displayNum = gwNum(displayGwId);

  if (!Number.isFinite(startNum) || !Number.isFinite(displayNum)) {
    return String(displayGwId || "").trim().toUpperCase();
  }

  return `GW${startNum + displayNum - 1}`;
}

function getOutcomeForPick(match, pick) {
  const pickKey = normalizeTeamName(pick);
  const homeKey = normalizeTeamName(match.team1);
  const awayKey = normalizeTeamName(match.team2);

  if (pickKey !== homeKey && pickKey !== awayKey) {
    return null;
  }

  const homeWon = match.homeScore > match.awayScore;
  const awayWon = match.awayScore > match.homeScore;

  if (pickKey === homeKey) {
    return homeWon ? "WIN" : "LOSS";
  }

  if (pickKey === awayKey) {
    return awayWon ? "WIN" : "LOSS";
  }

  return null;
}

function buildFixtureIndex(allMatches) {
  const byGw = new Map();

  for (const match of allMatches) {
    const gwId = String(match.gwId || "").trim().toUpperCase();
    if (!gwId) continue;

    if (!byGw.has(gwId)) byGw.set(gwId, []);
    byGw.get(gwId).push(match);
  }

  return byGw;
}

function findFixtureForPick(fixturesByGw, actualGwId, pick) {
  const fixtures = fixturesByGw.get(String(actualGwId || "").trim().toUpperCase()) || [];
  const pickKey = normalizeTeamName(pick);

  return fixtures.find(f => {
    return (
      normalizeTeamName(f.team1) === pickKey ||
      normalizeTeamName(f.team2) === pickKey
    );
  }) || null;
}

async function loadAllFixtures() {
  const allMatches = [];

  for (const source of FIXTURE_SOURCES) {
    try {
      const json = await readJson(source.file);
      const matches = Array.isArray(json.matches) ? json.matches : [];
      allMatches.push(...matches);
    } catch (err) {
      log(`[fixtures] failed to load ${source.file}: ${err.message || err}`);
    }
  }

  return allMatches;
}

async function loadGames() {
  const data = await api({ action: "getGames" });
  return Array.isArray(data.games) ? data.games : [];
}

async function loadGwIds() {
  const data = await readJson("site/data/gameweek-deadlines.json");
  const deadlines = Array.isArray(data.deadlines) ? data.deadlines : [];

  return Array.from(
    new Set(
      deadlines
        .map(d => String(d.gwId || "").trim().toUpperCase())
        .filter(Boolean)
    )
  ).sort((a, b) => gwNum(a) - gwNum(b));
}

async function getPendingRowsForGameAndGw(gameId, gwId) {
  const data = await api({
    action: "adminGetGwPicks",
    adminKey: ADMIN_KEY,
    gameId,
    gwId,
  });

  const rows = Array.isArray(data.rows) ? data.rows : [];
  return rows.filter(r => !isResolvedOutcome(r.outcome));
}

async function applyOutcome(row, gameId, outcome) {
  const result = await api({
    action: "adminSetPickOutcome",
    adminKey: ADMIN_KEY,
    email: row.email,
    gameId,
    gwId: row.gwId,
    outcome,
  });

  const pickedTeam = result.pickedTeam || row.pick || row.team || "";

  const sheetsSync = await api({
    action: "syncAdminSetPickOutcomeFromFirebase",
    adminKey: ADMIN_KEY,
    email: row.email,
    gameId,
    gwId: row.gwId,
    outcome: result.outcome || outcome,
    pickedTeam,
  });

  return {
    ...result,
    pickedTeam,
    sheetsSync,
    syncedToSheets: true,
  };
}

function getRowsByEmail(rows) {
  const byEmail = new Map();

  for (const row of rows) {
    const email = String(row.email || "").trim().toLowerCase();
    if (!email) continue;

    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(row);
  }

  for (const list of byEmail.values()) {
    list.sort((a, b) => gwNum(a.gwId) - gwNum(b.gwId));
  }

  return byEmail;
}

async function normalizeQueuedRowsForGame(game, rows, fixturesByGw) {
  const gameId = String(game.id || "").trim();
  const gameTitle = String(game.title || gameId).trim();
  const events = [];

  for (const [email, userRows] of getRowsByEmail(rows).entries()) {
    const hasPending = userRows.some(row =>
      String(row.outcome || "").trim().toUpperCase() === "PENDING"
    );

    if (hasPending) continue;

    const hasLoss = userRows.some(row =>
      String(row.outcome || "").trim().toUpperCase() === "LOSS"
    );

    if (hasLoss) continue;

    const nextQueued = userRows.find(row =>
      String(row.outcome || "").trim().toUpperCase() === "QUEUED"
    );

    if (!nextQueued) continue;

    const actualGwId = getActualGwIdForGame(nextQueued.gwId, game);
    const fixture = findFixtureForPick(fixturesByGw, actualGwId, nextQueued.pick);

    if (fixture && hasFinalScore(fixture)) {
      continue;
    }

    if (!APPLY) {
      log(`[DRY RUN] [${gameTitle}] ${nextQueued.gwId} ${email} ${nextQueued.pick} QUEUED -> PENDING`);
      events.push({
        type: "dry-run",
        gameId,
        gameTitle,
        gwId: nextQueued.gwId,
        email,
        pick: nextQueued.pick,
        outcome: "PENDING",
        reason: "Promote earliest queued pick"
      });
      continue;
    }

    try {
      const response = await applyOutcome(nextQueued, gameId, "PENDING");
      log(`[PROMOTED] [${gameTitle}] ${nextQueued.gwId} ${email} ${nextQueued.pick} QUEUED -> PENDING [sheets synced]`);
      events.push({
        type: response?.skipped ? "skipped" : "promoted",
        gameId,
        gameTitle,
        gwId: nextQueued.gwId,
        email,
        pick: nextQueued.pick,
        outcome: response?.outcome || "PENDING",
        reason: response?.reason || "Promoted earliest queued pick",
        syncedToSheets: response?.syncedToSheets === true
      });

      nextQueued.outcome = "PENDING";
    } catch (err) {
      log(`[${gameTitle}] ${nextQueued.gwId} ${email} promote failed: ${err.message || err}`);
      events.push({
        type: "error",
        gameId,
        gameTitle,
        gwId: nextQueued.gwId,
        email,
        pick: nextQueued.pick,
        outcome: "PENDING",
        reason: String(err.message || err)
      });
    }
  }

  return events;
}

async function processGame(game, fixturesByGw) {
  const events = [];
  const gameId = String(game.id || "").trim();
  const gameTitle = String(game.title || gameId).trim();

  if (!gameId) {
    return { checked: 0, resolved: 0, skipped: 0, events };
  }

  let checked = 0;
  let resolved = 0;
  let skipped = 0;

  log(`[${gameTitle}] starting`);

  const unresolvedRowsByGw = new Map();

  try {
    const data = await api({
      action: "adminGetAllPicks",
      adminKey: ADMIN_KEY,
      gameId,
    });

    const rows = Array.isArray(data.rows) ? data.rows : [];

    events.push(...await normalizeQueuedRowsForGame(game, rows, fixturesByGw));

    for (const row of rows) {
      if (isResolvedOutcome(row.outcome)) continue;

      const displayGwId = String(row.gwId || "").trim().toUpperCase();
      if (!displayGwId) continue;

      if (!unresolvedRowsByGw.has(displayGwId)) {
        unresolvedRowsByGw.set(displayGwId, []);
      }

      unresolvedRowsByGw.get(displayGwId).push(row);
    }
  } catch (err) {
    const reason = `failed to load picks: ${err.message || err}`;
    log(`[${gameTitle}] ${reason}`);

    events.push({
      type: "error",
      gameId,
      gameTitle,
      reason
    });

    return { checked: 0, resolved: 0, skipped: 0, events };
  }

  for (const [displayGwId, rows] of unresolvedRowsByGw.entries()) {
    const actualGwId = getActualGwIdForGame(displayGwId, game);

    for (const row of rows) {
      checked += 1;

      const email = String(row.email || "").trim();
      const pick = String(row.pick || "").trim();

      if (!pick) {
        skipped += 1;

        log(`[${gameTitle}] ${displayGwId} ${email || "unknown"} skipped: no pick`);

        events.push({
          type: "skipped",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          reason: "No pick"
        });

        continue;
      }

      const fixture = findFixtureForPick(fixturesByGw, actualGwId, pick);

      if (!fixture) {
        skipped += 1;

        log(`[${gameTitle}] ${displayGwId} ${pick} skipped: no fixture found in ${actualGwId}`);

        events.push({
          type: "skipped",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          reason: `No fixture found in ${actualGwId}`
        });

        continue;
      }

      if (!hasFinalScore(fixture)) {
        skipped += 1;

        log(
          `[${gameTitle}] ${displayGwId} ${pick} skipped: fixture unresolved (${fixture.team1} v ${fixture.team2})`
        );

        events.push({
          type: "skipped",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          reason: "Fixture unresolved",
          fixture: `${fixture.team1} v ${fixture.team2}`
        });

        continue;
      }

      const outcome = getOutcomeForPick(fixture, pick);

      if (!outcome) {
        skipped += 1;

        log(
          `[${gameTitle}] ${displayGwId} ${pick} skipped: could not infer outcome from ${fixture.team1} ${fixture.homeScore}-${fixture.awayScore} ${fixture.team2}`
        );

        events.push({
          type: "skipped",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          reason: "Could not infer outcome",
          fixture: `${fixture.team1} ${fixture.homeScore}-${fixture.awayScore} ${fixture.team2}`
        });

        continue;
      }

      const resultLine = `${fixture.team1} ${fixture.homeScore}-${fixture.awayScore} ${fixture.team2}`;

      if (!APPLY) {
        log(`[DRY RUN] [${gameTitle}] ${displayGwId} ${email} ${pick} -> ${outcome} (${resultLine})`);

        resolved += 1;

        events.push({
          type: "dry-run",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          outcome,
          result: resultLine
        });

        continue;
      }

      try {
        const response = await applyOutcome(row, gameId, outcome);

        log(`[APPLIED] [${gameTitle}] ${displayGwId} ${email} ${pick} -> ${outcome} (${resultLine}) [sheets synced]`);

        resolved += 1;

        events.push({
          type: response?.skipped ? "skipped" : "resolved",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          outcome: response?.outcome || outcome,
          result: resultLine,
          reason: response?.reason || "",
          syncedToSheets: response?.syncedToSheets === true
        });
      } catch (err) {
        skipped += 1;

        log(`[${gameTitle}] ${displayGwId} ${email} apply failed: ${err.message || err}`);

        events.push({
          type: "error",
          gameId,
          gameTitle,
          gwId: displayGwId,
          email,
          pick,
          outcome,
          result: resultLine,
          reason: String(err.message || err)
        });
      }
    }
  }

  log(`[${gameTitle}] finished checked=${checked} resolved=${resolved} skipped=${skipped}`);

  return { checked, resolved, skipped, events };
}

async function main() {
  requireAdminKey();

  log(`auto-resolve-picks started (${APPLY ? "apply" : "dry-run"})`);

  const [games, allFixtures] = await Promise.all([
    loadGames(),
    loadAllFixtures(),
  ]);

  const fixturesByGw = buildFixtureIndex(allFixtures);

  let totalChecked = 0;
  let totalResolved = 0;
  let totalSkipped = 0;

  autoResolveReport.games = [];

  for (const game of games) {
    const summary = await processGame(game, fixturesByGw);

    totalChecked += summary.checked;
    totalResolved += summary.resolved;
    totalSkipped += summary.skipped;

    autoResolveReport.games.push({
      gameId: String(game.id || ""),
      gameTitle: String(game.title || game.id || ""),
      checked: summary.checked,
      resolved: summary.resolved,
      skipped: summary.skipped,
      events: summary.events || []
    });
  }

  autoResolveReport.checked = totalChecked;
  autoResolveReport.resolved = totalResolved;
  autoResolveReport.skipped = totalSkipped;
  autoResolveReport.generatedAt = new Date().toISOString();
  autoResolveReport.ok = true;
  autoResolveReport.error = "";

  await writeAutoResolveReport();

  log(`auto-resolve-picks finished checked=${totalChecked} resolved=${totalResolved} skipped=${totalSkipped}`);
}

main().catch(async err => {
  console.error("❌ auto-resolve-picks failed");
  console.error(err.message || err);
  if (err.stack) console.error(err.stack);

  autoResolveReport.ok = false;
  autoResolveReport.error = String(err.message || err);
  autoResolveReport.generatedAt = new Date().toISOString();

  try {
    await writeAutoResolveReport();
  } catch (writeErr) {
    console.error("Failed to write auto-resolve report");
    console.error(writeErr.message || writeErr);
  }

  process.exit(1);
});
