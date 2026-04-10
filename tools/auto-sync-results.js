#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const FILE_CONFIG = [
  {
    file: "site/data/fixtures/premier-league.json",
    label: "Premier League",
  },
  {
    file: "site/data/fixtures/championship.json",
    label: "Championship",
  },
  {
    file: "site/data/fixtures/league-one.json",
    label: "League One",
  },
  {
    file: "site/data/fixtures/league-two.json",
    label: "League Two",
  },
  {
    file: "site/data/fixtures/fa-cup.json",
    label: "FA Cup",
  },
];

// how long after kickoff before we try to fetch a result
const RESULT_DELAY_MS = 105 * 60 * 1000;

// how often the watcher runs
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const MAX_FIXTURE_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// optional retry throttle per fixture so we do not hammer the same unresolved game every cycle
const RETRY_AFTER_MS = 30 * 60 * 1000; // 30 minutes

const STATE_FILE = path.join(PROJECT_ROOT, "tools", ".auto-sync-state.json");

function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

async function readJson(absPath) {
  const raw = await fs.readFile(absPath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(absPath, data) {
  await fs.writeFile(absPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function loadState() {
  try {
    return await readJson(STATE_FILE);
  } catch {
    return { fixtures: {} };
  }
}

async function saveState(state) {
  await writeJson(STATE_FILE, state);
}

function normalizeTime(time) {
  const s = String(time || "").trim();
  return s || "12:00";
}

function getKickoffMs(match) {
  if (!match?.date) return NaN;

  const time = normalizeTime(match.time);
  const d = new Date(`${match.date}T${time}:00`);
  return d.getTime();
}

function isResolved(match) {
  return Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore);
}

function makeFixtureKey(file, match) {
  return [
    file,
    String(match.gwId || "").trim().toUpperCase(),
    String(match.date || "").trim(),
    String(match.team1 || "").trim().toLowerCase(),
    String(match.team2 || "").trim().toLowerCase(),
  ].join("::");
}

function uniqueSortedDates(matches) {
  return Array.from(
    new Set(
      matches
        .map(m => String(m.date || "").trim())
        .filter(Boolean)
    )
  ).sort();
}

function buildDateWindows(dates) {
  if (!dates.length) return [];

  const windows = [];
  let start = dates[0];
  let prev = dates[0];

  function addOneDay(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  for (let i = 1; i < dates.length; i++) {
    const current = dates[i];
    const expectedNext = addOneDay(prev);

    if (current === expectedNext) {
      prev = current;
      continue;
    }

    windows.push({ from: start, to: prev });
    start = current;
    prev = current;
  }

  windows.push({ from: start, to: prev });
  return windows;
}

async function runSyncResults({ file, from, to }) {
  return new Promise((resolve, reject) => {
    const args = [
      "tools/sync-results.js",
      `--file=${file}`,
      `--from=${from}`,
      `--to=${to}`,
    ];

    const child = spawn("node", args, {
      cwd: PROJECT_ROOT,
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

async function getDueFixturesForFile(file, state) {
  const absPath = path.join(PROJECT_ROOT, file);
  const json = await readJson(absPath);
  const matches = Array.isArray(json.matches) ? json.matches : [];

  const now = Date.now();
  const due = [];

  for (const match of matches) {
    if (!match?.date) continue;
    if (isResolved(match)) continue;

    const kickoffMs = getKickoffMs(match);
    if (!Number.isFinite(kickoffMs)) continue;

    if ((now - kickoffMs) > MAX_FIXTURE_AGE_MS) continue;

    const resultCheckDueMs = kickoffMs + RESULT_DELAY_MS;
    if (now < resultCheckDueMs) continue;

    const fixtureKey = makeFixtureKey(file, match);
    const lastAttemptMs = Number(state?.fixtures?.[fixtureKey]?.lastAttemptMs || 0);

    if (lastAttemptMs && (now - lastAttemptMs) < RETRY_AFTER_MS) {
      continue;
    }

    due.push({
      ...match,
      _fixtureKey: fixtureKey,
    });
  }

  return due;
}

async function markAttempted(state, file, matches) {
  const now = Date.now();
  if (!state.fixtures) state.fixtures = {};

  for (const match of matches) {
    const key = match._fixtureKey || makeFixtureKey(file, match);
    state.fixtures[key] = {
      ...(state.fixtures[key] || {}),
      lastAttemptMs: now,
    };
  }
}

async function cleanupResolvedFromState(state) {
  if (!state.fixtures) state.fixtures = {};

  for (const cfg of FILE_CONFIG) {
    const absPath = path.join(PROJECT_ROOT, cfg.file);
    const json = await readJson(absPath);
    const matches = Array.isArray(json.matches) ? json.matches : [];

    for (const match of matches) {
      if (!isResolved(match)) continue;

      const key = makeFixtureKey(cfg.file, match);
      if (state.fixtures[key]) {
        delete state.fixtures[key];
      }
    }
  }
}

async function processFile(cfg, state) {
  const dueFixtures = await getDueFixturesForFile(cfg.file, state);

  if (!dueFixtures.length) {
    log(`[${cfg.label}] no due unresolved fixtures`);
    return;
  }

  const dates = uniqueSortedDates(dueFixtures);
  const windows = buildDateWindows(dates);

  log(
    `[${cfg.label}] due fixtures=${dueFixtures.length}, windows=${windows
      .map(w => `${w.from}->${w.to}`)
      .join(", ")}`
  );

  await markAttempted(state, cfg.file, dueFixtures);
  await saveState(state);

  for (const window of windows) {
    try {
      log(`[${cfg.label}] running sync-results ${window.from} -> ${window.to}`);
      const output = await runSyncResults({
        file: cfg.file,
        from: window.from,
        to: window.to,
      });

      process.stdout.write(output);
    } catch (err) {
      log(`[${cfg.label}] sync failed: ${err.message || err}`);
    }
  }
}

async function tick() {
  log("auto-sync tick started");

  const state = await loadState();

  for (const cfg of FILE_CONFIG) {
    try {
      await processFile(cfg, state);
    } catch (err) {
      log(`[${cfg.label}] processing error: ${err.message || err}`);
    }
  }

  try {
    await cleanupResolvedFromState(state);
    await saveState(state);
  } catch (err) {
    log(`state cleanup failed: ${err.message || err}`);
  }

  log("auto-sync tick finished");
}

async function main() {
  log("auto-sync-results started");

  await tick();

  log("auto-sync-results finished");
}

main().catch(err => {
  console.error("❌ auto-sync-results failed");
  console.error(err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});