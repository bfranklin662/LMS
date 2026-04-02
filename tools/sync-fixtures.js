#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const FLASHSCORE_URL =
  "https://www.flashscore.co.uk/football/england/league-one/fixtures/";

// Local file names mapped to Flashscore URLs.
// For now we only test League One.
const FILE_CONFIG = {
  "site/data/fixtures/league-one-test.json": {
    url: "https://www.flashscore.co.uk/football/england/league-one/fixtures/",
    label: "League One",
  },
  "site/data/fixtures/league-one.json": {
    url: "https://www.flashscore.co.uk/football/england/league-one/fixtures/",
    label: "League One",
  },
  "site/data/fixtures/league-two-test.json": {
    url: "https://www.flashscore.co.uk/football/england/league-two/fixtures/",
    label: "League Two",
  },
  "site/data/fixtures/league-two.json": {
    url: "https://www.flashscore.co.uk/football/england/league-two/fixtures/",
    label: "League Two",
  },
  "site/data/fixtures/championship-test.json": {
    url: "https://www.flashscore.co.uk/football/england/championship/fixtures/",
    label: "Championship",
  },
  "site/data/fixtures/championship.json": {
    url: "https://www.flashscore.co.uk/football/england/championship/fixtures/",
    label: "Championship",
  },
  "site/data/fixtures/premier-league-test.json": {
    url: "https://www.flashscore.co.uk/football/england/premier-league/fixtures/",
    label: "Premier League",
  },
  "site/data/fixtures/premier-league.json": {
    url: "https://www.flashscore.co.uk/football/england/premier-league/fixtures/",
    label: "Premier League",
  },
  "site/data/fixtures/fa-cup-test.json": {
    url: "https://www.flashscore.co.uk/football/england/fa-cup/fixtures/",
    label: "FA Cup",
  },
  "site/data/fixtures/fa-cup.json": {
    url: "https://www.flashscore.co.uk/football/england/fa-cup/fixtures/",
    label: "FA Cup",
  },
};

const {
  getCanonicalTeamName,
  areTeamsEquivalent
} = require("./team-name-utils");

function buildSyncPlan({ localData, scrapedFixtures, from, to, file, forceGwId = null }) {
  if (!localData || !Array.isArray(localData.matches)) {
    throw new Error("JSON does not contain a valid { matches: [] } structure.");
  }

  const operations = [];
  const localBuckets = new Map();
  const scrapedBuckets = new Map();

  for (let i = 0; i < localData.matches.length; i++) {
    const match = localData.matches[i];
    if (!isWithinWindow(match.date, from, to)) continue;

    const key = makeFixtureKey(match.team1, match.team2);
    if (!localBuckets.has(key)) localBuckets.set(key, []);
    localBuckets.get(key).push({ match, index: i });
  }

  for (const fixture of scrapedFixtures) {
    const key = makeFixtureKey(fixture.team1, fixture.team2);
    if (!scrapedBuckets.has(key)) scrapedBuckets.set(key, []);
    scrapedBuckets.get(key).push(fixture);
  }

  const allKeys = new Set([
    ...localBuckets.keys(),
    ...scrapedBuckets.keys()
  ]);

  function buildUpdatedMatch(localMatch, scraped) {
    return {
      ...localMatch,
      team1: toLocalTeamName(scraped.team1 || localMatch.team1),
      team2: toLocalTeamName(scraped.team2 || localMatch.team2),
      date: scraped.date || localMatch.date,
      time: scraped.time ? normalizeTime(scraped.time) : localMatch.time,
    };
  }

  function isRealFixtureChange(localMatch, updatedMatch) {
    return (
      String(localMatch.date || "") !== String(updatedMatch.date || "") ||
      String(normalizeTime(localMatch.time || "") || "") !== String(normalizeTime(updatedMatch.time || "") || "")
    );
  }

  function sameDateAndTime(localItem, scraped) {
    const localTime = normalizeTime(localItem.match.time || "");
    const scrapedTime = normalizeTime(scraped.time || localItem.match.time || "");

    return (
      String(localItem.match.date || "") === String(scraped.date || "") &&
      String(localTime || "") === String(scrapedTime || "")
    );
  }

  function sameDate(localItem, scraped) {
    return String(localItem.match.date || "") === String(scraped.date || "");
  }

  for (const key of allKeys) {
    let localItems = [...(localBuckets.get(key) || [])];
    let scrapedItems = [...(scrapedBuckets.get(key) || [])];

    const unmatchedLocal = [];

    // Pass 1: exact date+time match
    for (const localItem of localItems) {
      const idx = scrapedItems.findIndex(scraped => sameDateAndTime(localItem, scraped));
      if (idx === -1) {
        unmatchedLocal.push(localItem);
        continue;
      }

      const scraped = scrapedItems[idx];
      scrapedItems.splice(idx, 1);

      const updatedMatch = buildUpdatedMatch(localItem.match, scraped);
      if (isRealFixtureChange(localItem.match, updatedMatch)) {
        operations.push({
          id: `${file}::update::${localItem.match.date}::${normalizeTeamName(localItem.match.team1)}::${normalizeTeamName(localItem.match.team2)}`,
          type: "update",
          index: localItem.index,
          before: localItem.match,
          after: updatedMatch
        });
      }
    }

    localItems = unmatchedLocal.splice(0, unmatchedLocal.length);

    // Pass 2: same date only
    const stillUnmatchedLocal = [];
    for (const localItem of localItems) {
      const idx = scrapedItems.findIndex(scraped => sameDate(localItem, scraped));
      if (idx === -1) {
        stillUnmatchedLocal.push(localItem);
        continue;
      }

      const scraped = scrapedItems[idx];
      scrapedItems.splice(idx, 1);

      const updatedMatch = buildUpdatedMatch(localItem.match, scraped);
      if (isRealFixtureChange(localItem.match, updatedMatch)) {
        operations.push({
          id: `${file}::update::${localItem.match.date}::${normalizeTeamName(localItem.match.team1)}::${normalizeTeamName(localItem.match.team2)}`,
          type: "update",
          index: localItem.index,
          before: localItem.match,
          after: updatedMatch
        });
      }
    }

    localItems = stillUnmatchedLocal;

    // Pass 3: pair remaining locals with remaining scraped fixtures once only
    while (localItems.length && scrapedItems.length) {
      const localItem = localItems.shift();
      const scraped = scrapedItems.shift();

      const updatedMatch = buildUpdatedMatch(localItem.match, scraped);
      if (isRealFixtureChange(localItem.match, updatedMatch)) {
        operations.push({
          id: `${file}::update::${localItem.match.date}::${normalizeTeamName(localItem.match.team1)}::${normalizeTeamName(localItem.match.team2)}`,
          type: "update",
          index: localItem.index,
          before: localItem.match,
          after: updatedMatch
        });
      }
    }

    // Leftover locals should be removed
    for (const localItem of localItems) {
      operations.push({
        id: `${file}::remove::${localItem.match.date}::${normalizeTeamName(localItem.match.team1)}::${normalizeTeamName(localItem.match.team2)}`,
        type: "remove",
        index: localItem.index,
        fixture: localItem.match
      });
    }

    // Leftover scraped fixtures should be added
    for (const fixture of scrapedItems) {
      operations.push({
        id: `${file}::add::${fixture.date}::${normalizeTeamName(toLocalTeamName(fixture.team1))}::${normalizeTeamName(toLocalTeamName(fixture.team2))}`,
        type: "add",
        fixture: {
          gwId: forceGwId || inferGwIdForFixture(fixture, localData.matches),
          date: fixture.date,
          team1: toLocalTeamName(fixture.team1),
          team2: toLocalTeamName(fixture.team2),
          time: fixture.time ? normalizeTime(fixture.time) : "15:00"
        }
      });
    }
  }

  return operations;
}

function applySyncPlan({ localData, operations, selectedOperationIds }) {
  const selected = new Set(selectedOperationIds || []);
  let matches = [...localData.matches];

  const updates = operations.filter(op => op.type === "update" && selected.has(op.id));
  const removes = operations.filter(op => op.type === "remove" && selected.has(op.id));
  const adds = operations.filter(op => op.type === "add" && selected.has(op.id));

  for (const op of updates) {
    matches[op.index] = op.after;
  }

  const removeIndexes = new Set(removes.map(op => op.index));
  matches = matches.filter((_, idx) => !removeIndexes.has(idx));

  for (const op of adds) {
    matches.push(op.fixture);
  }

  matches.sort(compareMatchesByDateTime);

  return {
    ...localData,
    matches
  };
}

function parseFixtureEditorId(fixtureId) {
  const parts = String(fixtureId || "").split("::");
  if (parts.length < 2) return null;

  const file = parts[0];
  const idx = Number(parts[1]);

  if (!Number.isInteger(idx)) return null;

  return { file, index: idx };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file || null;
  const runAll = Boolean(args.all);
  const useTestFiles = Boolean(args.test);
  const from = args.from;
  const to = args.to;
  const dryRun = Boolean(args["dry-run"]);
  const removeMissing = Boolean(args["remove-missing"]);
  const addMissing = Boolean(args["add-missing"]);
  const headful = Boolean(args.headful);
  const verbose = Boolean(args.verbose);
  const opsFile = args["ops-file"] || null;
  const forceGwId = args["force-gw-id"] || null;

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
      throw new Error(`Unsupported file for this test script: ${file}`);
    }
    filesToProcess = [file];
  } else {
    throw new Error("Provide either --file=... or --all");
  }

  console.log(`Window: ${from} -> ${to}`);
  console.log(`Dry run: ${dryRun ? "yes" : "no"}`);
  console.log(`Remove missing: ${removeMissing ? "yes" : "no"}`);
  console.log(`Add missing: ${addMissing ? "yes" : "no"}`);
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
      removeMissing,
      addMissing,
      headful,
      opsFile,
      forceGwId,
    });
    summaries.push(summary);
  }

  console.log("Summary:");
  console.log("");

  for (const item of summaries) {
    if (item.updated === 0 && item.removed === 0 && item.added === 0) {
      console.log(`${item.label}: No changes`);
    } else {
      console.log(
        `${item.label}: Removed ${item.removed}, Added ${item.added}, Changed ${item.updated}`
      );
    }
  }

  console.log("");
}

async function processSingleFile({
  file,
  from,
  to,
  dryRun,
  removeMissing,
  addMissing,
  headful,
  opsFile,
  forceGwId,
}) {
  const cfg = FILE_CONFIG[file];
  const filePath = path.resolve(PROJECT_ROOT, file);
  const localData = await readJson(filePath);

  const scrapedFixtures = await scrapeFlashscoreFixtures({
    url: cfg.url,
    from,
    to,
    headful,
  });

  const operations = buildSyncPlan({
    localData,
    scrapedFixtures,
    from,
    to,
    file,
    forceGwId,
  });

  let selectedOperationIds = operations
    .filter(op => !op.manual)
    .map(op => op.id);
  let manualRemoveFixtureIds = [];

  if (opsFile) {
    const rawOps = await fs.readFile(path.resolve(PROJECT_ROOT, opsFile), "utf8");
    const parsedOps = JSON.parse(rawOps);

    selectedOperationIds = Array.isArray(parsedOps.selectedOperationIds)
      ? parsedOps.selectedOperationIds
      : [];

    manualRemoveFixtureIds = Array.isArray(parsedOps.manualRemoveFixtureIds)
      ? parsedOps.manualRemoveFixtureIds
      : [];
  }

  for (const fixtureId of manualRemoveFixtureIds) {
    const parsed = parseFixtureEditorId(fixtureId);
    if (!parsed) continue;
    if (parsed.file !== file) continue;

    const match = localData.matches[parsed.index];
    if (!match) continue;

    const opId = `${file}::manual-remove::${parsed.index}`;

    if (!operations.some(op => op.id === opId)) {
      operations.push({
        id: opId,
        type: "remove",
        index: parsed.index,
        fixture: match
      });
    }

    if (!selectedOperationIds.includes(opId)) {
      selectedOperationIds.push(opId);
    }
  }

  const updatedData = applySyncPlan({
    localData,
    operations,
    selectedOperationIds
  });

  const selectedSet = new Set(selectedOperationIds);

  const result = {
    updatedData,
    updated: operations
      .filter(op => op.type === "update" && selectedSet.has(op.id))
      .map(op => ({
        id: op.id,
        gwId: op.before.gwId,
        before: op.before,
        after: op.after
      })),
    removed: operations
      .filter(op => op.type === "remove" && selectedSet.has(op.id))
      .map(op => op.fixture),
    added: operations
      .filter(op => op.type === "add" && selectedSet.has(op.id))
      .map(op => op.fixture),
  };

  console.log(`${cfg.label}:`);

  if (
    result.updated.length === 0 &&
    result.removed.length === 0 &&
    result.added.length === 0
  ) {
    console.log("No changes");
    console.log("");
  } else {
    if (result.added.length) {
      console.log("Added:");
      for (const item of result.added) {
        const op = operations.find(x => x.type === "add" && selectedSet.has(x.id) &&
          x.fixture.team1 === item.team1 &&
          x.fixture.team2 === item.team2 &&
          x.fixture.date === item.date
        );
        console.log(`- [${op?.id || ""}] ${item.team1} v ${item.team2} (${item.date} ${item.time})`);
      }
    }

    if (result.updated.length) {
      console.log("Changed:");
      for (const item of result.updated) {
        const changedBits = [];
        if (item.before.date !== item.after.date) {
          changedBits.push(`date ${item.before.date} -> ${item.after.date}`);
        }
        if (item.before.time !== item.after.time) {
          changedBits.push(`time ${item.before.time} -> ${item.after.time}`);
        }
        if (
          item.before.team1 !== item.after.team1 ||
          item.before.team2 !== item.after.team2
        ) {
          changedBits.push(
            `teams ${item.before.team1} v ${item.before.team2} -> ${item.after.team1} v ${item.after.team2}`
          );
        }

        const op = operations.find(x =>
          x.type === "update" &&
          selectedSet.has(x.id) &&
          x.before.team1 === item.before.team1 &&
          x.before.team2 === item.before.team2 &&
          x.before.date === item.before.date
        );

        console.log(`- [${op?.id || ""}] ${item.after.team1} v ${item.after.team2}: ${changedBits.join(", ")}`);
      }
    }

    if (result.removed.length) {
      console.log("Removed:");
      for (const item of result.removed) {
        const op = operations.find(x =>
          x.type === "remove" &&
          selectedSet.has(x.id) &&
          x.fixture.team1 === item.team1 &&
          x.fixture.team2 === item.team2 &&
          x.fixture.date === item.date
        );

        console.log(`- [${op?.id || ""}] ${item.team1} v ${item.team2} (${item.date} ${item.time})`);
      }
    }

    console.log("");
  }

  if (!dryRun) {
    const hasRealChanges =
      result.updated.length > 0 ||
      result.removed.length > 0 ||
      result.added.length > 0;

    if (hasRealChanges) {
      await writeJson(filePath, result.updatedData);
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
    updated: result.updated.length,
    removed: result.removed.length,
    added: result.added.length,
  };
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

async function scrapeFlashscoreFixtures({ url, from, to, headful }) {
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
      } catch {
        // ignore
      }
    }

    await page.waitForTimeout(1500);
    await expandFixtures(page, url);

    const bodyText = await page.locator("body").innerText();

    const scrapedFixtures = dedupeFixtures(
      parseFixturesFromPageText(bodyText, from, to)
    );

    return scrapedFixtures;
  } finally {
    await browser.close();
  }
}

function isFixturesUrl(url) {
  return url.includes("/football/england/") && url.includes("/fixtures/");
}

function parseFixturesFromPageText(bodyText, from, to) {
  const text = (bodyText || "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const results = [];

  // ---- Format A: compact summary line ----
  // Example:
  // 28/03 Harrogate v Notts County, Barnet v Cambridge Utd, ...
  const fixtureLines = lines.filter((line) => /^\d{2}\/\d{2}\s+/.test(line));

  for (const line of fixtureLines) {
    const parsed = parseFixtureSummaryLine(line, from, to);
    for (const fixture of parsed) {
      if (fixture.date >= from && fixture.date <= to) {
        results.push(fixture);
      }
    }
  }

  // ---- Format B: visible row blocks ----
  // Example from screenshot/body text:
  // 28.03. 12:30
  // Harrogate
  // Notts Co
  // 28.03. 15:00
  // Barnet
  // Cambridge Utd
  for (let i = 0; i < lines.length - 2; i++) {
    const dt = parseFlashscoreDateTime(lines[i], from, to);
    if (!dt) continue;

    const team1 = cleanTeamName(lines[i + 1]);
    const team2 = cleanTeamName(lines[i + 2]);

    if (!looksLikeTeamName(team1) || !looksLikeTeamName(team2)) {
      continue;
    }

    results.push({
      date: dt.date,
      time: dt.time,
      team1,
      team2,
    });
  }

  return results;
}

async function expandFixtures(page, fixturesUrl) {
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
    } catch {
      // ignore
    }

    // If we got navigated away from fixtures, go back immediately.
    if (!isFixturesUrl(page.url())) {
      console.log(`⚠ Navigated away to ${page.url()}, going back to fixtures page`);
      await page.goto(fixturesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      continue;
    }

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1000);

    const bodyText = await page.locator("body").innerText();
    console.log(`Expand round ${i + 1}: body text length ${bodyText.length}`);

    const currentLength = bodyText.length;

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

function parseFixtureSummaryLine(line, from, to) {
  const results = [];

  // Example line:
  // 28/03 Blackpool v Burton, Exeter v Leyton Orient, Reading v Wigan, Stockport County v Wimbledon, Wycombe v Port Vale, 02/04 Wigan v Leyton Orient, 03/04 Doncaster v Mansfield, ...
  const tokens = line.split(/,\s*/);

  let currentDate = null;

  for (const token of tokens) {
    const trimmed = token.trim();

    const dateMatch = trimmed.match(/^(\d{2})\/(\d{2})\s+(.+)$/);
    if (dateMatch) {
      currentDate = toIsoDate(dateMatch[1], dateMatch[2], from, to);
      const fixturePart = dateMatch[3].trim();

      const fixture = parseTeamPair(fixturePart, currentDate);
      if (fixture) results.push(fixture);
      continue;
    }

    if (!currentDate) continue;

    const fixture = parseTeamPair(trimmed, currentDate);
    if (fixture) results.push(fixture);
  }

  return results;
}

function parseFlashscoreDateTime(line, from, to) {
  const text = (line || "").trim();

  // Example: 28.03. 12:30
  let m = text.match(/^(\d{2})\.(\d{2})\.\s+(\d{2}):(\d{2})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const hh = m[3];
    const min = m[4];
    const year = inferYear(dd, mm, from, to);

    const date = `${year}-${mm}-${dd}`;
    if (date < from || date > to) return null;

    return { date, time: `${hh}:${min}` };
  }

  // Example: 28.03.2026 12:30
  m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (m) {
    const dd = m[1];
    const mm = m[2];
    const yyyy = m[3];
    const hh = m[4];
    const min = m[5];

    const date = `${yyyy}-${mm}-${dd}`;
    if (date < from || date > to) return null;

    return { date, time: `${hh}:${min}` };
  }

  return null;
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

function looksLikeTeamName(value) {
  if (!value) return false;
  if (/^\d{2}\.\d{2}\./.test(value)) return false;
  if (/^\d{2}:\d{2}$/.test(value)) return false;
  if (value === "-") return false;
  if (/^MATCH$/i.test(value)) return false;
  if (/^H2H$/i.test(value)) return false;
  if (/^STANDINGS$/i.test(value)) return false;
  if (/^LIVE$/i.test(value)) return false;
  if (/^Advertisement$/i.test(value)) return false;
  return true;
}

function toIsoDate(dd, mm, from, to) {
  const day = dd.padStart(2, "0");
  const month = mm.padStart(2, "0");

  // Infer year from requested window.
  // For your current use case this will resolve to 2026.
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  for (let year = fromYear; year <= toYear; year++) {
    const iso = `${year}-${month}-${day}`;
    if (iso >= from && iso <= to) return iso;
  }

  // fallback to from-year
  return `${fromYear}-${month}-${day}`;
}

function parseTeamPair(text, date) {
  if (!text || !date) return null;

  const match = text.match(/^(.+?)\s+v\s+(.+?)$/i);
  if (!match) return null;

  return {
    date,
    time: null,
    team1: cleanTeamName(match[1]),
    team2: cleanTeamName(match[2]),
  };
}

function cleanTeamName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

function dedupeFixtures(fixtures) {
  const map = new Map();

  for (const fixture of fixtures) {
    const key = `${normalizeTeamName(fixture.team1)}__${normalizeTeamName(fixture.team2)}__${fixture.date}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, fixture);
      continue;
    }

    const existingHasTime = Boolean(existing.time);
    const candidateHasTime = Boolean(fixture.time);

    // Prefer the version that has a real kickoff time.
    if (!existingHasTime && candidateHasTime) {
      map.set(key, fixture);
      continue;
    }

    // If both have time or neither has time, keep the existing one.
  }

  return [...map.values()];
}

function syncLeagueFile({ localData, scrapedFixtures, from, to, removeMissing, addMissing }) {
  if (!localData || !Array.isArray(localData.matches)) {
    throw new Error("JSON does not contain a valid { matches: [] } structure.");
  }

  const scrapedMap = new Map();
  for (const fixture of scrapedFixtures) {
    const key = makeFixtureKey(fixture.team1, fixture.team2);
    scrapedMap.set(key, fixture);
  }

  const allowRemoval = removeMissing && scrapedFixtures.length > 0;
  const allowAddMissing = addMissing && scrapedFixtures.length > 0;

  const updated = [];
  const removed = [];
  const unmatchedLocal = [];
  const matchedKeys = new Set();
  let unchangedCount = 0;

  const updatedMatches = [];

  for (const match of localData.matches) {
    const localInWindow = isWithinWindow(match.date, from, to);

    if (!localInWindow) {
      updatedMatches.push(match);
      continue;
    }

    const key = makeFixtureKey(match.team1, match.team2);
    const scraped = scrapedMap.get(key);

    if (!scraped) {
      unmatchedLocal.push(match);

      if (allowRemoval) {
        removed.push(match);
        continue;
      }

      updatedMatches.push(match);
      continue;
    }

    matchedKeys.add(key);

    const updatedMatch = {
      ...match,
      team1: toLocalTeamName(scraped.team1 || match.team1),
      team2: toLocalTeamName(scraped.team2 || match.team2),
      date: scraped.date || match.date,
      time: scraped.time ? normalizeTime(scraped.time) : match.time,
    };

    if (isSameMatchShape(match, updatedMatch)) {
      unchangedCount += 1;
    } else {
      updated.push({
        gwId: match.gwId,
        before: match,
        after: updatedMatch,
      });
    }

    updatedMatches.push(updatedMatch);
  }

  const missingFromLocal = [];
  for (const fixture of scrapedFixtures) {
    const key = makeFixtureKey(fixture.team1, fixture.team2);
    if (!matchedKeys.has(key)) {
      missingFromLocal.push(fixture);
    }
  }

  const added = [];

  if (allowAddMissing) {
    for (const fixture of missingFromLocal) {
      const inferredGwId = inferGwIdForFixture(fixture, updatedMatches);

      const newMatch = {
        gwId: inferredGwId,
        date: fixture.date,
        team1: toLocalTeamName(fixture.team1),
        team2: toLocalTeamName(fixture.team2),
        time: fixture.time ? normalizeTime(fixture.time) : "15:00",
      };

      updatedMatches.push(newMatch);
      added.push(newMatch);
    }
  }

  updatedMatches.sort(compareMatchesByDateTime);

  return {
    updatedData: {
      ...localData,
      matches: updatedMatches,
    },
    updated,
    removed,
    added,
    unchangedCount,
    unmatchedLocal,
    missingFromLocal,
    scrapedFixtures,
  };
}

function detectFixtureConflicts(fixtures) {
  const byTeam = new Map();

  for (const fixture of fixtures) {
    const homeTeam = toLocalTeamName(fixture.team1);
    const awayTeam = toLocalTeamName(fixture.team2);

    if (!byTeam.has(homeTeam)) byTeam.set(homeTeam, []);
    if (!byTeam.has(awayTeam)) byTeam.set(awayTeam, []);

    byTeam.get(homeTeam).push({
      ...fixture,
      team1: toLocalTeamName(fixture.team1),
      team2: toLocalTeamName(fixture.team2),
    });

    byTeam.get(awayTeam).push({
      ...fixture,
      team1: toLocalTeamName(fixture.team1),
      team2: toLocalTeamName(fixture.team2),
    });
  }

  const conflicts = [];

  for (const [team, teamFixtures] of byTeam.entries()) {
    const sorted = [...teamFixtures].sort(compareFixturesByDateTime);

    if (sorted.length > 1) {
      conflicts.push({
        team,
        fixtures: sorted,
      });
    }
  }

  return conflicts.sort((a, b) => a.team.localeCompare(b.team));
}

function compareFixturesByDateTime(a, b) {
  const aKey = `${a.date || ""}T${a.time || "99:99"}`;
  const bKey = `${b.date || ""}T${b.time || "99:99"}`;
  return aKey.localeCompare(bKey);
}

function inferGwIdForFixture(fixture, existingMatches) {
  // First try: use the gwId of other matches on the same date
  const sameDateMatches = existingMatches.filter((m) => m.date === fixture.date && m.gwId);

  if (sameDateMatches.length > 0) {
    const counts = new Map();
    for (const match of sameDateMatches) {
      counts.set(match.gwId, (counts.get(match.gwId) || 0) + 1);
    }

    let bestGwId = null;
    let bestCount = -1;
    for (const [gwId, count] of counts.entries()) {
      if (count > bestCount) {
        bestGwId = gwId;
        bestCount = count;
      }
    }

    if (bestGwId) return bestGwId;
  }

  // Fallback: auto-generated gwId based on date
  return `GW_AUTO_${fixture.date}`;
}

function compareMatchesByDateTime(a, b) {
  const aKey = `${a.date || ""}T${a.time || "99:99"}`;
  const bKey = `${b.date || ""}T${b.time || "99:99"}`;

  if (aKey < bKey) return -1;
  if (aKey > bKey) return 1;

  const aTeams = `${a.team1 || ""} ${a.team2 || ""}`;
  const bTeams = `${b.team1 || ""} ${b.team2 || ""}`;
  return aTeams.localeCompare(bTeams);
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

function normalizeTime(value) {
  if (!value) return value;
  return value.slice(0, 5);
}

function isWithinWindow(dateStr, from, to) {
  if (!dateStr) return false;
  return dateStr >= from && dateStr <= to;
}

function makeFixtureKey(home, away) {
  return `${normalizeTeamName(home)}__${normalizeTeamName(away)}`;
}

function normalizeTeamName(name) {
  return String(getCanonicalTeamName(name) || "")
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

function toLocalTeamName(scrapedName) {
  return getCanonicalTeamName(scrapedName);
}

function isSameMatchShape(a, b) {
  return (
    areTeamsEquivalent(a.team1, b.team1) &&
    areTeamsEquivalent(a.team2, b.team2) &&
    a.date === b.date &&
    a.time === b.time
  );
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
  console.error("❌ Sync failed");
  console.error(err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});