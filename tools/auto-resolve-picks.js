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
];

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
  return s === "WIN" || s === "LOSS";
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
  return api({
    action: "adminSetPickOutcome",
    adminKey: ADMIN_KEY,
    email: row.email,
    gameId,
    gwId: row.gwId,
    outcome,
  });
}

async function processGame(game, fixturesByGw) {
  const gameId = String(game.id || "").trim();
  const gameTitle = String(game.title || gameId).trim();

  if (!gameId) return { checked: 0, resolved: 0, skipped: 0 };

  let checked = 0;
  let resolved = 0;
  let skipped = 0;

  log(`[${gameTitle}] starting`);

  // only check display GWs that actually have unresolved picks
  const unresolvedRowsByGw = new Map();

  try {
    const data = await api({
      action: "adminGetAllPicks",
      adminKey: ADMIN_KEY,
      gameId,
    });

    const rows = Array.isArray(data.rows) ? data.rows : [];

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
    log(`[${gameTitle}] failed to load picks: ${err.message || err}`);
    return { checked: 0, resolved: 0, skipped: 0 };
  }

  for (const [displayGwId, rows] of unresolvedRowsByGw.entries()) {
    const actualGwId = getActualGwIdForGame(displayGwId, game);

    for (const row of rows) {
      checked += 1;

      const pick = String(row.pick || "").trim();
      if (!pick) {
        skipped += 1;
        log(`[${gameTitle}] ${displayGwId} ${row.email || "unknown"} skipped: no pick`);
        continue;
      }

      const fixture = findFixtureForPick(fixturesByGw, actualGwId, pick);

      if (!fixture) {
        skipped += 1;
        log(`[${gameTitle}] ${displayGwId} ${pick} skipped: no fixture found in ${actualGwId}`);
        continue;
      }

      if (!hasFinalScore(fixture)) {
        skipped += 1;
        log(
          `[${gameTitle}] ${displayGwId} ${pick} skipped: fixture unresolved (${fixture.team1} v ${fixture.team2})`
        );
        continue;
      }

      const outcome = getOutcomeForPick(fixture, pick);

      if (!outcome) {
        skipped += 1;
        log(
          `[${gameTitle}] ${displayGwId} ${pick} skipped: could not infer outcome from ${fixture.team1} ${fixture.homeScore}-${fixture.awayScore} ${fixture.team2}`
        );
        continue;
      }

      const resultLine = `${fixture.team1} ${fixture.homeScore}-${fixture.awayScore} ${fixture.team2}`;

      if (!APPLY) {
        log(`[DRY RUN] [${gameTitle}] ${displayGwId} ${row.email} ${pick} -> ${outcome} (${resultLine})`);
        resolved += 1;
        continue;
      }

      try {
        await applyOutcome(row, gameId, outcome);
        log(`[APPLIED] [${gameTitle}] ${displayGwId} ${row.email} ${pick} -> ${outcome} (${resultLine})`);
        resolved += 1;
      } catch (err) {
        skipped += 1;
        log(`[${gameTitle}] ${displayGwId} ${row.email} apply failed: ${err.message || err}`);
      }
    }
  }

  log(`[${gameTitle}] finished checked=${checked} resolved=${resolved} skipped=${skipped}`);
  return { checked, resolved, skipped };
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

  for (const game of games) {
    const summary = await processGame(game, fixturesByGw);
    totalChecked += summary.checked;
    totalResolved += summary.resolved;
    totalSkipped += summary.skipped;
  }

  log(`auto-resolve-picks finished checked=${totalChecked} resolved=${totalResolved} skipped=${totalSkipped}`);
}

main().catch(err => {
  console.error("❌ auto-resolve-picks failed");
  console.error(err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});