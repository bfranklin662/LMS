#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const {
  getCanonicalTeamName
} = require("./team-name-utils");

const FILE_CONFIG = {
  "site/data/fixtures/league-one-test.json": {
    url: "https://www.flashscore.co.uk/football/england/league-one/results/",
    label: "League One",
  },
  "site/data/fixtures/league-one.json": {
    url: "https://www.flashscore.co.uk/football/england/league-one/results/",
    label: "League One",
  },
  "site/data/fixtures/league-two-test.json": {
    url: "https://www.flashscore.co.uk/football/england/league-two/results/",
    label: "League Two",
  },
  "site/data/fixtures/league-two.json": {
    url: "https://www.flashscore.co.uk/football/england/league-two/results/",
    label: "League Two",
  },
  "site/data/fixtures/championship-test.json": {
    url: "https://www.flashscore.co.uk/football/england/championship/results/",
    label: "Championship",
  },
  "site/data/fixtures/championship.json": {
    url: "https://www.flashscore.co.uk/football/england/championship/results/",
    label: "Championship",
  },
  "site/data/fixtures/premier-league-test.json": {
    url: "https://www.flashscore.co.uk/football/england/premier-league/results/",
    label: "Premier League",
  },
  "site/data/fixtures/premier-league.json": {
    url: "https://www.flashscore.co.uk/football/england/premier-league/results/",
    label: "Premier League",
  },
  "site/data/fixtures/fa-cup-test.json": {
    url: "https://www.flashscore.co.uk/football/england/fa-cup/results/",
    label: "FA Cup",
  },
  "site/data/fixtures/fa-cup.json": {
    url: "https://www.flashscore.co.uk/football/england/fa-cup/results/",
    label: "FA Cup",
  },
};

function buildResultSyncPlan({ localData, scrapedResults, from, to, file }) {
  if (!localData || !Array.isArray(localData.matches)) {
    throw new Error("JSON does not contain a valid { matches: [] } structure.");
  }

  const operations = [];

  for (let i = 0; i < localData.matches.length; i++) {
    const match = localData.matches[i];
    if (!isWithinWindow(match.date, from, to)) continue;

    const scraped = scrapedResults.find(item =>
      normalizeTeamName(item.team1) === normalizeTeamName(match.team1) &&
      normalizeTeamName(item.team2) === normalizeTeamName(match.team2) &&
      String(item.date || "") === String(match.date || "")
    );

    if (!scraped) {
      console.log("NO MATCH FOR LOCAL RESULT:", JSON.stringify({
        local: {
          gwId: match.gwId,
          date: match.date,
          time: match.time,
          team1: match.team1,
          team2: match.team2,
          homeScore: match.homeScore ?? null,
          awayScore: match.awayScore ?? null
        },
        scrapedResults
      }, null, 2));
      continue;
    }

    const currentHome = match.homeScore ?? null;
    const currentAway = match.awayScore ?? null;
    const nextHome = Number.isInteger(scraped.homeScore) ? scraped.homeScore : null;
    const nextAway = Number.isInteger(scraped.awayScore) ? scraped.awayScore : null;

    const currentStatus = match.resultStatus || "pending";
    const nextStatus = scraped.resultStatus || "final";

    const hasChange =
      currentHome !== nextHome ||
      currentAway !== nextAway ||
      currentStatus !== nextStatus;

    if (!hasChange) continue;

    operations.push({
      id: `${file}::result-update::${match.date}::${normalizeTeamName(match.team1)}::${normalizeTeamName(match.team2)}`,
      type: "result-update",
      index: i,
      before: {
        gwId: match.gwId,
        date: match.date,
        time: match.time,
        team1: match.team1,
        team2: match.team2,
        homeScore: currentHome,
        awayScore: currentAway,
        resultStatus: currentStatus
      },
      after: {
        ...match,
        gwId: scraped.gwId || match.gwId,
        date: scraped.date || match.date,
        time: scraped.time || match.time,
        team1: scraped.team1 || match.team1,
        team2: scraped.team2 || match.team2,
        homeScore: nextHome,
        awayScore: nextAway,
        resultStatus: nextStatus
      }
    });
  }

  return operations;
}

function applyResultSyncPlan({ localData, operations, selectedOperationIds }) {
  const selected = new Set(selectedOperationIds || []);
  const matches = [...localData.matches];

  for (const op of operations) {
    if (op.type !== "result-update") continue;
    if (!selected.has(op.id)) continue;
    matches[op.index] = op.after;
  }

  return {
    ...localData,
    matches: matches.map(match => ({
      ...match,
      homeScore: Number.isInteger(match.homeScore) ? match.homeScore : null,
      awayScore: Number.isInteger(match.awayScore) ? match.awayScore : null,
      resultStatus: String(match.resultStatus || (
        Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore)
          ? "final"
          : "pending"
      ))
    }))
  };
}

function parseFlashscoreResultLine(line, from, to) {
  const text = String(line || "").trim();

  // Example pattern to adapt after testing actual page text:
  // 28.03. 15:00 Bristol City Derby County 2 1
  let m = text.match(/^(\d{2})\.(\d{2})\.\s+(\d{2}):(\d{2})\s+(.+?)\s+(.+?)\s+(\d+)\s+(\d+)$/);
  if (!m) return null;

  const dd = m[1];
  const mm = m[2];
  const yyyy = inferYear(dd, mm, from, to);
  const date = `${yyyy}-${mm}-${dd}`;

  if (date < from || date > to) return null;

  return {
    date,
    team1: cleanTeamName(m[5]),
    team2: cleanTeamName(m[6]),
    homeScore: Number(m[7]),
    awayScore: Number(m[8]),
    resultStatus: "final"
  };
}

function parseResultsFromPageText(bodyText, from, to) {
  const text = (bodyText || "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const results = [];

  for (let i = 0; i < lines.length - 4; i++) {
    const dt = parseFlashscoreDateTime(lines[i], from, to);
    if (!dt) continue;

    // Flashscore result block looks like:
    // 03.04.2026
    // Wigan
    // Leyton Orient
    // 0
    // 0
    const team1 = cleanTeamName(lines[i + 1]);
    const team2 = cleanTeamName(lines[i + 2]);
    const homeScore = Number(lines[i + 3]);
    const awayScore = Number(lines[i + 4]);

    if (!looksLikeTeamName(team1) || !looksLikeTeamName(team2)) continue;
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;

    // Only keep matches inside requested window
    if (dt.date < from || dt.date > to) continue;

    results.push({
      date: dt.date,
      time: dt.time,
      team1,
      team2,
      homeScore,
      awayScore,
      resultStatus: "final"
    });
  }

  return dedupeResults(results);
}

function dedupeResults(results) {
  const map = new Map();

  for (const item of results) {
    const key = `${normalizeTeamName(item.team1)}__${normalizeTeamName(item.team2)}__${item.date}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
}

async function scrapeFlashscoreResults({ url, from, to, headful }) {
  const browser = await chromium.launch({
    headless: !headful,
  });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 2200 },
  });

  try {
    await gotoWithRetry(page, url);

    const cookieSelectors = [
      'button#onetrust-accept-btn-handler',
      'button:has-text("Accept")',
      'button:has-text("I Accept")',
      'button:has-text("Allow all")',
    ];

    for (const selector of cookieSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          await page.waitForTimeout(1200);
          break;
        }
      } catch { }
    }

    await page.waitForTimeout(1500);
    await expandResults(page, url, from);

    const bodyText = await page.locator("body").innerText();

    const parsedResults = parseResultsFromPageText(bodyText, from, to);

    console.log("SCRAPED RESULTS:", JSON.stringify(parsedResults, null, 2));

    return parsedResults;
  } finally {
    await browser.close();
  }
}

function isResultsUrl(url) {
  return url.includes("/football/england/") && url.includes("/results/");
}

async function expandResults(page, resultsUrl, from) {
  let previousLength = 0;
  let stableRounds = 0;

  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(800);

    let clicked = false;

    const showMore = page.locator('text=/Show more matches/i').first();

    try {
      if (await showMore.isVisible({ timeout: 1000 })) {
        await showMore.click({ force: true });
        clicked = true;
        await page.waitForTimeout(1500);
      }
    } catch { }

    if (!isResultsUrl(page.url())) {
      await page.goto(resultsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      continue;
    }

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1000);

    const bodyText = await page.locator("body").innerText();
    const currentLength = bodyText.length;

    // Stop early if we've already loaded dates older than the requested window
    const oldestLoadedDate = findOldestResultsDateInText(bodyText);
    if (oldestLoadedDate && oldestLoadedDate < from) {
      console.log(`Stopping results expansion: oldest loaded date ${oldestLoadedDate} is older than from=${from}`);
      break;
    }

    if (currentLength <= previousLength + 20) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    previousLength = currentLength;

    if (!clicked && stableRounds >= 3) {
      break;
    }
  }
}

async function processSingleFile({
  file,
  from,
  to,
  dryRun,
  headful,
  opsFile
}) {
  const cfg = FILE_CONFIG[file];
  const filePath = path.resolve(PROJECT_ROOT, file);
  const localData = await readJson(filePath);

  const scrapedResults = await scrapeFlashscoreResults({
    url: cfg.url,
    from,
    to,
    headful,
  });

  const operations = buildResultSyncPlan({
    localData,
    scrapedResults,
    from,
    to,
    file
  });

  let selectedOperationIds = operations.map(op => op.id);

  if (opsFile) {
    const rawOps = await fs.readFile(path.resolve(PROJECT_ROOT, opsFile), "utf8");
    const parsedOps = JSON.parse(rawOps);

    selectedOperationIds = Array.isArray(parsedOps.selectedOperationIds)
      ? parsedOps.selectedOperationIds
      : [];
  }

  const updatedData = applyResultSyncPlan({
    localData,
    operations,
    selectedOperationIds
  });

  const selectedSet = new Set(selectedOperationIds);

  const changed = operations
    .filter(op => op.type === "result-update" && selectedSet.has(op.id));

  console.log(`${cfg.label}:`);

  if (!changed.length) {
    console.log("No changes");
    console.log("");
  } else {
    console.log("Changed:");
    for (const op of changed) {
      console.log(
        `- [${op.id}] ${op.after.team1} v ${op.after.team2}: score ${op.before.homeScore ?? "null"}-${op.before.awayScore ?? "null"} -> ${op.after.homeScore}-${op.after.awayScore}`
      );
    }
    console.log("");
  }

  if (!dryRun) {
    if (changed.length) {
      await writeJson(filePath, updatedData);
      console.log("Written");
      console.log("");
    } else {
      console.log("No file changes to write");
      console.log("");
    }
  } else {
    console.log("Dry run only");
    console.log("");
  }

  return {
    label: cfg.label,
    updated: changed.length
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file || null;
  const runAll = Boolean(args.all);
  const useTestFiles = Boolean(args.test);
  const from = args.from;
  const to = args.to;
  const dryRun = Boolean(args["dry-run"]);
  const headful = Boolean(args.headful);
  const opsFile = args["ops-file"] || null;

  if (!from || !to) {
    throw new Error("You must provide --from=YYYY-MM-DD and --to=YYYY-MM-DD");
  }

  let filesToProcess = [];

  if (runAll) {
    filesToProcess = Object.keys(FILE_CONFIG).filter((name) => {
      if (useTestFiles) return name.endsWith("-test.json");
      return !name.endsWith("-test.json");
    });
  } else if (file) {
    if (!FILE_CONFIG[file]) {
      throw new Error(`Unsupported file for this result script: ${file}`);
    }
    filesToProcess = [file];
  } else {
    throw new Error("Provide either --file=... or --all");
  }

  console.log(`Window: ${from} -> ${to}`);
  console.log(`Dry run: ${dryRun ? "yes" : "no"}`);
  console.log(`Run all: ${runAll ? "yes" : "no"}`);
  console.log(`Use test files: ${useTestFiles ? "yes" : "no"}`);
  console.log("");

  const summaries = [];

  for (const currentFile of filesToProcess) {
    const summary = await processSingleFile({
      file: currentFile,
      from,
      to,
      dryRun,
      headful,
      opsFile,
    });
    summaries.push(summary);
  }

  console.log("Summary:");
  console.log("");

  for (const item of summaries) {
    if (item.updated === 0) {
      console.log(`${item.label}: No changes`);
    } else {
      console.log(`${item.label}: Changed ${item.updated}`);
    }
  }

  console.log("");
}

async function gotoWithRetry(page, url, attempts = 3) {
  let lastError;

  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      return;
    } catch (err) {
      lastError = err;
      console.log(`Goto attempt ${i} failed: ${err.message}`);
      if (i < attempts) {
        await page.waitForTimeout(3000);
      }
    }
  }

  throw lastError;
}

function findOldestResultsDateInText(bodyText) {
  const text = String(bodyText || "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  let oldest = null;

  for (const line of lines) {
    let m = line.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) {
      const iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (!oldest || iso < oldest) oldest = iso;
      continue;
    }

    m = line.match(/^(\d{2})\.(\d{2})\.$/);
    if (m) {
      // ignore yearless dates here, because they are less reliable
      continue;
    }
  }

  return oldest;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [k, v] = arg.slice(2).split("=");
    out[k] = v === undefined ? true : v;
  }
  return out;
}

function isWithinWindow(dateStr, from, to) {
  if (!dateStr) return false;
  return dateStr >= from && dateStr <= to;
}

function inferYear(dd, mm, from, to) {
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  for (let year = fromYear; year <= toYear; year++) {
    const iso = `${year}-${mm}-${dd}`;
    if (iso >= from && iso <= to) return String(year);
  }

  return String(fromYear);
}

function parseFlashscoreDateTime(line, from, to) {
  const text = String(line || "").trim();

  // Format: 02.04. 19:45
  let m = text.match(/^(\d{2})\.(\d{2})\.\s+(\d{2}):(\d{2})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const hh = m[3];
    const min = m[4];
    const year = inferYear(dd, mm, from, to);

    const date = `${year}-${mm}-${dd}`;
    return { date, time: `${hh}:${min}` };
  }

  // Format: 02.04.2026 19:45
  m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    const hh = m[4];
    const min = m[5];

    const date = `${yyyy}-${mm}-${dd}`;
    return { date, time: `${hh}:${min}` };
  }

  // Format: 02.04.2026
  m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];

    const date = `${yyyy}-${mm}-${dd}`;
    return { date, time: null };
  }

  // Format: 02.04.
  m = text.match(/^(\d{2})\.(\d{2})\.$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const year = inferYear(dd, mm, from, to);

    const date = `${year}-${mm}-${dd}`;
    return { date, time: null };
  }

  return null;
}

function looksLikeTeamName(value) {
  if (!value) return false;
  if (/^\d{2}\.\d{2}\./.test(value)) return false;
  if (/^\d{2}:\d{2}$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  if (value === "-") return false;
  if (/^MATCH$/i.test(value)) return false;
  if (/^H2H$/i.test(value)) return false;
  if (/^STANDINGS$/i.test(value)) return false;
  if (/^LIVE$/i.test(value)) return false;
  if (/^Advertisement$/i.test(value)) return false;
  if (/^FT$/i.test(value)) return false;
  if (/^AET$/i.test(value)) return false;
  if (/^PEN$/i.test(value)) return false;
  return true;
}

function cleanTeamName(name) {
  return String(getCanonicalTeamName(name) || name || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeamName(name) {
  return String(getCanonicalTeamName(name) || name || "")
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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");

  if (!raw.trim()) {
    throw new Error(`JSON file is empty: ${filePath}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
  }
}

async function writeJson(filePath, data) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, json, "utf8");
}

main().catch((err) => {
  console.error("❌ Result sync failed");
  console.error(err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});