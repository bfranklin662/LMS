require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const os = require("os");

const PORT = 3001;
const ADMIN_KEY = process.env.FIXTURE_ADMIN_KEY || "";
const BASE_DIR = process.env.LMS_BASE_DIR || path.resolve(__dirname, "..");

const {
  getCanonicalTeamName
} = require("./team-name-utils");

const FILE_MAP = {
  "premier-league": {
    live: "site/data/fixtures/premier-league.json",
    test: "site/data/fixtures/premier-league-test.json",
    label: "Premier League",
  },
  championship: {
    live: "site/data/fixtures/championship.json",
    test: "site/data/fixtures/championship-test.json",
    label: "Championship",
  },
  "league-one": {
    live: "site/data/fixtures/league-one.json",
    test: "site/data/fixtures/league-one-test.json",
    label: "League One",
  },
  "league-two": {
    live: "site/data/fixtures/league-two.json",
    test: "site/data/fixtures/league-two-test.json",
    label: "League Two",
  },
  "fa-cup": {
    live: "site/data/fixtures/fa-cup.json",
    test: "site/data/fixtures/fa-cup-test.json",
    label: "FA Cup",
  },
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

async function handleFixturesEditorView(body, res) {
  requireAdminKey(body);

  const {
    league = "all",
    allowedLeagueKeys = [],
    useTestFiles = false
  } = body;

  let targets = getTargetFiles({ league, useTestFiles });

  if (Array.isArray(allowedLeagueKeys) && allowedLeagueKeys.length) {
    const allowed = new Set(allowedLeagueKeys.map(String));
    targets = targets.filter(t => allowed.has(t.key));
  }
  const allFixtures = [];

  for (const target of targets) {
    const json = await readJsonFile(target.absPath);
    const matches = Array.isArray(json.matches) ? json.matches : [];

    matches.forEach((m, idx) => {
      allFixtures.push({
        fixtureId: `${target.file}::${idx}`,
        file: target.file,
        leagueKey: target.key,
        leagueLabel: target.label,
        gwId: String(m.gwId || "").trim().toUpperCase(),
        date: String(m.date || "").trim(),
        time: String(m.time || "").trim(),
        team1: String(m.team1 || "").trim(),
        team2: String(m.team2 || "").trim(),
        homeScore: Number.isInteger(m.homeScore) ? m.homeScore : null,
        awayScore: Number.isInteger(m.awayScore) ? m.awayScore : null,
        resultStatus: String(m.resultStatus || "pending").trim(),
        status: "existing",
        change: null
      });
    });
  }

  allFixtures.sort((a, b) => {
    const gwDiff = gwNum(a.gwId) - gwNum(b.gwId);
    if (gwDiff !== 0) return gwDiff;

    const dtDiff = fixtureSortKey(a).localeCompare(fixtureSortKey(b));
    if (dtDiff !== 0) return dtDiff;

    const leagueDiff = a.leagueLabel.localeCompare(b.leagueLabel);
    if (leagueDiff !== 0) return leagueDiff;

    return `${a.team1} ${a.team2}`.localeCompare(`${b.team1} ${b.team2}`);
  });

  const gwMap = new Map();

  for (const fixture of allFixtures) {
    const gwKey = fixture.gwId || "UNGROUPED";

    if (!gwMap.has(gwKey)) {
      gwMap.set(gwKey, {
        gwId: gwKey,
        displayGwId: gwKey,
        days: new Map()
      });
    }

    const gw = gwMap.get(gwKey);
    const dayKey = fixture.date || "unknown";

    if (!gw.days.has(dayKey)) {
      gw.days.set(dayKey, {
        dayKey,
        label: formatAdminDayLabel(dayKey),
        leagues: new Map()
      });
    }

    const day = gw.days.get(dayKey);

    if (!day.leagues.has(fixture.leagueKey)) {
      day.leagues.set(fixture.leagueKey, {
        leagueKey: fixture.leagueKey,
        leagueLabel: fixture.leagueLabel,
        fixtures: []
      });
    }

    day.leagues.get(fixture.leagueKey).fixtures.push(fixture);
  }

  const gameweeks = Array.from(gwMap.values())
    .sort((a, b) => gwNum(a.gwId) - gwNum(b.gwId))
    .map(gw => ({
      gwId: gw.gwId,
      displayGwId: gw.displayGwId,
      days: Array.from(gw.days.values())
        .sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey)))
        .map(day => ({
          dayKey: day.dayKey,
          label: day.label,
          leagues: Array.from(day.leagues.values())
            .sort(compareLeagueDisplayOrder)
        }))
    }));

  sendJson(res, 200, { ok: true, gameweeks });
}

async function handleFixturesRescanGw(body, res) {
  requireAdminKey(body);

  const {
    actualGwId,
    from,
    to,
    league = "all",
    allowedLeagueKeys = [],
    useTestFiles = false
  } = body;

  const actualGwKey = String(actualGwId).trim().toUpperCase();

  let targets = getTargetFiles({ league, useTestFiles });

  if (Array.isArray(allowedLeagueKeys) && allowedLeagueKeys.length) {
    const allowed = new Set(allowedLeagueKeys.map(String));
    targets = targets.filter(t => allowed.has(t.key));
  }

  if (!actualGwId) {
    throw new Error("Missing actualGwId");
  }

  if (!from || !to) {
    throw new Error("Missing from/to");
  }


  const fixtures = [];
  const leagueSummaries = [];

  console.log(`\n[fixtures/rescan-gw] actualGwId=${actualGwKey} from=${from} to=${to} league=${league}`);

  for (const target of targets) {
    const json = await readJsonFile(target.absPath);
    const localMatches = Array.isArray(json.matches) ? json.matches : [];

    const gwMatches = localMatches
      .map((m, idx) => ({ match: m, originalIdx: idx }))
      .filter(({ match }) =>
        String(match.gwId || "").trim().toUpperCase() === actualGwKey
      );

    if (!gwMatches.length) {
      console.log(`[fixtures/rescan-gw] ${target.file}: no local matches for ${actualGwKey}`);
      continue;
    }

    console.log(`[fixtures/rescan-gw] ${target.file}: ${gwMatches.length} local match(es) in ${actualGwKey}`);

    const output = await runSync({
      file: target.file,
      from,
      to,
      removeMissing: true,
      addMissing: true,
      dryRun: true,
      forceGwId: actualGwKey
    });

    console.log(`--- ${target.file} sync output start ---`);
    console.log(output);
    console.log(`--- ${target.file} sync output end ---`);

    const result = await buildResult(target.label, target.file, output);
    console.log(`[DEBUG] ${target.file} result counts`, {
      updated: (result.updated || []).length,
      removed: (result.removed || []).length,
      added: (result.added || []).length
    });

    leagueSummaries.push({
      leagueLabel: target.label,
      updated: (result.updated || []).length,
      removed: (result.removed || []).length,
      added: (result.added || []).length
    });

    for (const { match: m, originalIdx } of gwMatches) {
      const fixtureId = `${target.file}::${originalIdx}`;

      let status = "existing";
      let change = null;

      const updated = (result.updated || []).find(item => {
        const sameBeforeTeams =
          normalizeScanCompareTeam(item.before?.team1) === normalizeScanCompareTeam(m.team1) &&
          normalizeScanCompareTeam(item.before?.team2) === normalizeScanCompareTeam(m.team2);

        const sameAfterTeams =
          normalizeScanCompareTeam(item.after?.team1) === normalizeScanCompareTeam(m.team1) &&
          normalizeScanCompareTeam(item.after?.team2) === normalizeScanCompareTeam(m.team2);

        const sameBeforeDate =
          String(item.before?.date || "").trim() === String(m.date || "").trim();

        const sameAfterDate =
          String(item.after?.date || "").trim() === String(m.date || "").trim();

        return (sameBeforeTeams && sameBeforeDate) || (sameAfterTeams && sameAfterDate);
      });

      if (updated) {
        status = "updated";
        change = {
          type: "update",
          operationId: updated.id,
          beforeDate: updated.before.date,
          beforeTime: updated.before.time,
          afterDate: updated.after.date,
          afterTime: updated.after.time,
        };
      }

      const removed = (result.removed || []).find(item =>
        normalizeScanCompareTeam(item.team1) === normalizeScanCompareTeam(m.team1) &&
        normalizeScanCompareTeam(item.team2) === normalizeScanCompareTeam(m.team2) &&
        String(item.date || "").trim() === String(m.date || "").trim() &&
        String(item.time || "").trim() === String(m.time || "").trim()
      );

      if (removed) {
        status = "removed";
        change = {
          type: "remove",
          operationId: removed.id
        };
      }

      const displayTeam1 = updated
        ? String(getCanonicalTeamName(updated.after?.team1 || m.team1) || "").trim()
        : String(getCanonicalTeamName(m.team1) || "").trim();

      const displayTeam2 = updated
        ? String(getCanonicalTeamName(updated.after?.team2 || m.team2) || "").trim()
        : String(getCanonicalTeamName(m.team2) || "").trim();

      fixtures.push({
        fixtureId,
        file: target.file,
        leagueKey: target.key,
        leagueLabel: target.label,
        gwId: String(m.gwId || "").trim().toUpperCase(),
        date: String(m.date || "").trim(),
        time: String(m.time || "").trim(),
        team1: displayTeam1,
        team2: displayTeam2,
        status,
        change,
        scanStatus: "scanned"
      });
    }

    const existingGwKeys = new Set(
      gwMatches.map(({ match }) =>
        `${normalizeScanCompareTeam(match.team1)}__${normalizeScanCompareTeam(match.team2)}__${String(match.date || "").trim()}`
      )
    );

    (result.added || [])
      .forEach((item, idx) => {
        const itemDate = String(item.date || "").trim();

        // must be within the requested scan window
        if (!itemDate || itemDate < from || itemDate > to) return;

        const dedupeKey =
          `${normalizeScanCompareTeam(item.team1)}__${normalizeScanCompareTeam(item.team2)}__${itemDate}`;

        if (existingGwKeys.has(dedupeKey)) return;

        fixtures.push({
          fixtureId: `${target.file}::SCRAPED::${actualGwKey}::${idx}`,
          file: target.file,
          leagueKey: target.key,
          leagueLabel: target.label,
          gwId: actualGwKey,
          date: itemDate,
          time: String(item.time || "").trim(),
          team1: String(item.team1 || "").trim(),
          team2: String(item.team2 || "").trim(),
          status: "scraped-only",
          change: {
            type: "add",
            operationId: item.id
          },
          scanStatus: "scanned"
        });
      });

    console.log(
      `[fixtures/rescan-gw] ${target.file}: updated=${(result.updated || []).length} removed=${(result.removed || []).length} added=${(result.added || []).length}`
    );
  }

  console.log(`[fixtures/rescan-gw] returning ${fixtures.length} fixture row(s)\n`);
  sendJson(res, 200, { ok: true, fixtures, leagueSummaries });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function runResultSync({ file, from, to, dryRun, opsFile }) {
  return new Promise((resolve, reject) => {
    const args = [
      "tools/sync-results.js",
      `--file=${file}`,
      `--from=${from}`,
      `--to=${to}`,
    ];

    if (dryRun) args.push("--dry-run");
    if (opsFile) args.push(`--ops-file=${opsFile}`);

    const child = spawn("node", args, {
      cwd: BASE_DIR,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", d => {
      stdout += d.toString();
    });

    child.stderr.on("data", d => {
      stderr += d.toString();
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code !== 0) {
        return reject(new Error(stderr || stdout || `sync-results exited with code ${code}`));
      }
      resolve(stdout);
    });
  });
}

async function handleResultsUpdateGw(body, res) {
  requireAdminKey(body);

  const {
    actualGwId,
    from,
    to,
    league = "all",
    allowedLeagueKeys = [],
    useTestFiles = false
  } = body;

  if (!actualGwId) throw new Error("Missing actualGwId");
  if (!from || !to) throw new Error("Missing from/to");

  const actualGwKey = String(actualGwId).trim().toUpperCase();
  let targets = getTargetFiles({ league, useTestFiles });

  if (Array.isArray(allowedLeagueKeys) && allowedLeagueKeys.length) {
    const allowed = new Set(allowedLeagueKeys.map(String));
    targets = targets.filter(t => allowed.has(t.key));
  }
  const results = [];

  for (const target of targets) {
    const json = await readJsonFile(target.absPath);
    const localMatches = Array.isArray(json.matches) ? json.matches : [];

    const gwMatches = localMatches.filter(
      m => String(m.gwId || "").trim().toUpperCase() === actualGwKey
    );

    if (!gwMatches.length) {
      results.push({
        label: target.label,
        file: target.file,
        updated: []
      });
      continue;
    }

    const output = await runResultSync({
      file: target.file,
      from,
      to,
      dryRun: false
    });

    const changed = parseSectionLines(output, "Changed").map(line => line.trim());

    results.push({
      label: target.label,
      file: target.file,
      updated: changed,
      rawOutput: output
    });
  }

  sendJson(res, 200, { ok: true, results });
}

function requireAdminKey(body) {
  if (!ADMIN_KEY) {
    throw new Error("FIXTURE_ADMIN_KEY is not set on the server");
  }
  if (String(body.adminKey || "") !== ADMIN_KEY) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

function getTargetFiles({ league, useTestFiles }) {
  const keys =
    league && league !== "all"
      ? [league]
      : Object.keys(FILE_MAP);

  return keys.map((key) => {
    const cfg = FILE_MAP[key];
    if (!cfg) {
      throw new Error(`Unsupported league: ${key}`);
    }
    const file = useTestFiles ? cfg.test : cfg.live;
    return {
      key,
      label: cfg.label,
      file,
      absPath: path.join(BASE_DIR, file),
    };
  });
}

function gwNum(gwId) {
  const m = String(gwId || "").match(/^GW(\d+)$/i);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function fixtureSortKey(f) {
  return `${f.date || ""}T${String(f.time || "99:99")}`;
}

function formatAdminDayLabel(dateStr) {
  if (!dateStr) return "Unknown day";
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "Europe/London"
  }).format(d);
}

function normalizeScanCompareTeam(name) {
  return String(getCanonicalTeamName(name) || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\butd\b/g, "united")
    .replace(/\s+/g, " ")
    .trim();
}

async function readJsonFile(absPath) {
  const raw = await fs.readFile(absPath, "utf8");
  return JSON.parse(raw);
}


async function runSync({ file, from, to, removeMissing, addMissing, dryRun, opsFile, forceGwId }) {
  return new Promise((resolve, reject) => {
    const args = [
      "tools/sync-fixtures.js",
      `--file=${file}`,
      `--from=${from}`,
      `--to=${to}`,
    ];

    if (dryRun) args.push("--dry-run");
    if (removeMissing) args.push("--remove-missing");
    if (addMissing) args.push("--add-missing");
    if (opsFile) args.push(`--ops-file=${opsFile}`);
    if (forceGwId) args.push(`--force-gw-id=${forceGwId}`);

    const child = spawn("node", args, {
      cwd: BASE_DIR,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || stdout || `sync-fixtures exited with code ${code}`));
      }
      resolve(stdout);
    });
  });
}

function parseSectionLines(text, heading) {
  const lines = String(text || "").split("\n");
  const out = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === `${heading}:`) {
      inSection = true;
      continue;
    }

    if (inSection) {
      if (!trimmed) continue;
      if (!trimmed.startsWith("- ")) break;
      out.push(trimmed.slice(2));
    }
  }

  return out;
}

const LEAGUE_DISPLAY_ORDER = {
  "FA Cup": 1,
  "Premier League": 2,
  "Championship": 3,
  "League One": 4,
  "League Two": 5
};

function compareLeagueDisplayOrder(a, b) {
  const aRank = LEAGUE_DISPLAY_ORDER[a?.leagueLabel] ?? 999;
  const bRank = LEAGUE_DISPLAY_ORDER[b?.leagueLabel] ?? 999;

  if (aRank !== bRank) return aRank - bRank;
  return String(a?.leagueLabel || "").localeCompare(String(b?.leagueLabel || ""));
}

function splitFixtureTeams(text) {
  const parts = String(text || "").split(/\s+v\s+/i);
  return {
    team1: parts[0] || "",
    team2: parts.slice(1).join(" v ") || "",
  };
}

function normalizeTime(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s || s === "TBD") return "TBD";
  return s;
}

function parseUpdated(text) {
  return parseSectionLines(text, "Changed").map((line) => {
    let operationId = "";

    const idMatch = line.match(/^\[([^\]]+)\]\s+(.*)$/);
    if (idMatch) {
      operationId = idMatch[1];
      line = idMatch[2];
    }

    let m = line.match(
      /^(.+?)\s+\((\d{4}-\d{2}-\d{2})\s+([^)]+)\)\s+->\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\s+([^)]+)\)$/i
    );
    if (m) {
      const beforeTeams = splitFixtureTeams(m[1]);
      const afterTeams = splitFixtureTeams(m[4]);

      return {
        id: operationId,
        before: {
          team1: beforeTeams.team1,
          team2: beforeTeams.team2,
          date: m[2],
          time: normalizeTime(m[3]),
        },
        after: {
          team1: afterTeams.team1,
          team2: afterTeams.team2,
          date: m[5],
          time: normalizeTime(m[6]),
        },
        raw: line,
      };
    }

    m = line.match(/^(.+?)\s+v\s+(.+?):\s*(.+)$/i);
    if (m) {
      const baseBefore = {
        team1: m[1],
        team2: m[2],
        date: "",
        time: "",
      };

      const baseAfter = {
        team1: m[1],
        team2: m[2],
        date: "",
        time: "",
      };

      const changes = m[3];

      const dateMatch = changes.match(/date\s+(\d{4}-\d{2}-\d{2})\s+->\s+(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) {
        baseBefore.date = dateMatch[1];
        baseAfter.date = dateMatch[2];
      }

      const timeMatch = changes.match(/time\s+([^,]+?)\s+->\s+([^,]+?)(?:,|$)/i);
      if (timeMatch) {
        baseBefore.time = normalizeTime(timeMatch[1]);
        baseAfter.time = normalizeTime(timeMatch[2]);
      }

      const teamsMatch = changes.match(/teams\s+(.+?)\s+->\s+(.+)$/i);
      if (teamsMatch) {
        const beforeTeams = splitFixtureTeams(teamsMatch[1]);
        const afterTeams = splitFixtureTeams(teamsMatch[2]);

        baseBefore.team1 = beforeTeams.team1;
        baseBefore.team2 = beforeTeams.team2;
        baseAfter.team1 = afterTeams.team1;
        baseAfter.team2 = afterTeams.team2;
      }

      return {
        id: operationId,
        before: baseBefore,
        after: baseAfter,
        raw: line,
      };
    }

    return {
      id: operationId,
      before: { team1: "", team2: "", date: "", time: "" },
      after: { team1: "", team2: "", date: "", time: "" },
      raw: line,
    };
  });
}

function parseSimpleFixtures(text, heading) {
  return parseSectionLines(text, heading).map((line) => {
    const m = line.match(/^\[([^\]]+)\]\s+(.+?)\s+v\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}|TBD)\)$/);
    if (m) {
      return {
        id: m[1],
        team1: m[2],
        team2: m[3],
        date: m[4],
        time: m[5],
        raw: line,
      };
    }

    const m2 = line.match(/^(.+?)\s+v\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}|TBD)\)$/);
    if (m2) {
      return {
        id: null,
        team1: m2[1],
        team2: m2[2],
        date: m2[3],
        time: m2[4],
        raw: line,
      };
    }

    return { id: null, team1: line, team2: "", date: "", time: "", raw: line };
  });
}

async function enrichUpdatedWithFixtureDates(file, updated) {
  const absPath = path.join(BASE_DIR, file);
  const raw = await fs.readFile(absPath, "utf8");
  const json = JSON.parse(raw);
  const matches = Array.isArray(json.matches) ? json.matches : [];

  const norm = (s) => String(s || "").trim().toLowerCase();

  return updated.map((item) => {
    if (item.before?.date || item.after?.date) return item;

    const match = matches.find((m) => {
      return (
        norm(m.team1) === norm(item.after?.team1 || item.before?.team1) &&
        norm(m.team2) === norm(item.after?.team2 || item.before?.team2)
      );
    });

    if (!match) return item;

    return {
      ...item,
      before: {
        ...item.before,
        date: item.before?.date || match.date || "",
      },
      after: {
        ...item.after,
        date: item.after?.date || match.date || "",
      },
    };
  });
}

async function buildResult(label, file, output) {
  let updated = parseUpdated(output);
  updated = await enrichUpdatedWithFixtureDates(file, updated);

  return {
    label,
    file,
    updated,
    removed: parseSimpleFixtures(output, "Removed"),
    added: parseSimpleFixtures(output, "Added"),
    rawOutput: output,
  };
}

async function handlePreview(body, res) {
  requireAdminKey(body);

  const { league = "all", from, to, removeMissing = false, addMissing = false, useTestFiles = true } = body;

  console.log("Preview request:", { league, from, to });

  if (!from || !to) {
    throw new Error("Missing from/to");
  }

  const targets = getTargetFiles({ league, useTestFiles });
  const results = [];

  for (const target of targets) {
    const output = await runSync({
      file: target.file,
      from,
      to,
      removeMissing: true,
      addMissing: true,
      dryRun: true
    });

    console.log("SYNC OUTPUT:");
    console.log(output);
    console.log("------");

    results.push(await buildResult(target.label, target.file, output));
  }

  sendJson(res, 200, { ok: true, results });
}

async function handleCommit(body, res) {
  requireAdminKey(body);

  const {
    league = "all",
    allowedLeagueKeys = [],
    from,
    to,
    actualGwId,
    selectedOperationIdsByFile = {},
    manualRemoveFixtureIdsByFile = {},
    useTestFiles = false
  } = body;

  if (!from || !to) {
    throw new Error("Missing from/to");
  }

  let targets = getTargetFiles({ league, useTestFiles });

  if (Array.isArray(allowedLeagueKeys) && allowedLeagueKeys.length) {
    const allowed = new Set(allowedLeagueKeys.map(String));
    targets = targets.filter(t => allowed.has(t.key));
  }
  const results = [];
  let deadlinesOutput = "";

  for (const target of targets) {
    const selectedOperationIds = Array.isArray(selectedOperationIdsByFile[target.file])
      ? selectedOperationIdsByFile[target.file]
      : [];

    const manualRemoveFixtureIds = Array.isArray(manualRemoveFixtureIdsByFile[target.file])
      ? manualRemoveFixtureIdsByFile[target.file]
      : [];

    console.log(
      `Applying ${target.file}: ${selectedOperationIds.length} selected ops, ${manualRemoveFixtureIds.length} manual removes`
    );

    if (!selectedOperationIds.length && !manualRemoveFixtureIds.length) {
      results.push({
        label: target.label,
        file: target.file,
        updated: [],
        removed: [],
        added: []
      });
      continue;
    }

    const opsFile = path.join(
      os.tmpdir(),
      `fixture-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    await fs.writeFile(
      opsFile,
      JSON.stringify({ selectedOperationIds, manualRemoveFixtureIds }, null, 2),
      "utf8"
    );

    try {
      const output = await runSync({
        file: target.file,
        from,
        to,
        removeMissing: true,
        addMissing: true,
        dryRun: false,
        opsFile,
        forceGwId: actualGwId || null,
      });

      console.log(`--- commit output for ${target.file} start ---`);
      console.log(output);
      console.log(`--- commit output for ${target.file} end ---`);

      results.push(await buildResult(target.label, target.file, output));
    } finally {
      try {
        await fs.unlink(opsFile);
      } catch {
        // ignore cleanup error
      }
    }
  }

  const hasAnyAppliedChanges = results.some(r =>
    (r.updated || []).length > 0 ||
    (r.removed || []).length > 0 ||
    (r.added || []).length > 0
  );

  if (hasAnyAppliedChanges) {
    deadlinesOutput = await runGenerateDeadlines();
    console.log(`--- generate-deadlines output start ---`);
    console.log(deadlinesOutput);
    console.log(`--- generate-deadlines output end ---`);
  }

  sendJson(res, 200, { ok: true, results, deadlinesOutput });
}

async function runGenerateDeadlines() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["tools/generate-deadlines.js"], {
      cwd: BASE_DIR,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", d => {
      stdout += d.toString();
    });

    child.stderr.on("data", d => {
      stderr += d.toString();
    });

    child.on("error", reject);

    child.on("close", code => {
      if (code !== 0) {
        return reject(new Error(stderr || stdout || `generate-deadlines exited with code ${code}`));
      }
      resolve(stdout);
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 404, { ok: false, error: "Not found" });
  }

  try {
    const body = await parseBody(req);

    if (req.url === "/fixtures/editor-view") {
      return await handleFixturesEditorView(body, res);
    }

    if (req.url === "/preview") {
      return await handlePreview(body, res);
    }

    if (req.url === "/commit") {
      return await handleCommit(body, res);
    }

    if (req.url === "/fixtures/rescan-gw") {
      return await handleFixturesRescanGw(body, res);
    }

    if (req.url === "/results/update-gw") {
      return await handleResultsUpdateGw(body, res);
    }

    return sendJson(res, 404, { ok: false, error: "Unknown route" });
  } catch (err) {
    const status = err.statusCode || 500;
    return sendJson(res, status, {
      ok: false,
      error: err.message || "Server error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Fixture admin server running on http://localhost:${PORT}`);
  console.log(`Base dir: ${BASE_DIR}`);
});