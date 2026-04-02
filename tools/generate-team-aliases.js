#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const LEAGUES = [
  {
    file: "site/data/fixtures/fa-cup.json",
    label: "FA Cup",
    url: "https://www.flashscore.co.uk/football/england/fa-cup/fixtures/",
  },
  {
    file: "site/data/fixtures/premier-league.json",
    label: "Premier League",
    url: "https://www.flashscore.co.uk/football/england/premier-league/fixtures/",
  },
  {
    file: "site/data/fixtures/championship.json",
    label: "Championship",
    url: "https://www.flashscore.co.uk/football/england/championship/fixtures/",
  },
  {
    file: "site/data/fixtures/league-one.json",
    label: "League One",
    url: "https://www.flashscore.co.uk/football/england/league-one/fixtures/",
  },
  {
    file: "site/data/fixtures/league-two.json",
    label: "League Two",
    url: "https://www.flashscore.co.uk/football/england/league-two/fixtures/",
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseDir = path.resolve(process.cwd(), args.dir || ".");
  const headful = Boolean(args.headful);

  const localTeams = await collectLocalTeams(baseDir);
  const logoTeams = await collectLogoTeams(baseDir);
  const rawFlashscoreTeams = await collectFlashscoreTeams(headful);
  const flashscoreTeams = filterFlashscoreTeamsToRelevantOnes(
    rawFlashscoreTeams,
    localTeams,
    logoTeams
  );

  const comparison = buildComparison({
    localTeams,
    logoTeams,
    flashscoreTeams
  });

  const output = {
    generatedAt: new Date().toISOString(),
    localTeams: sortStrings([...localTeams]),
    logoTeams: sortStrings([...logoTeams]),
    flashscoreTeams: sortStrings([...flashscoreTeams]),
    exactMatches: comparison.exactMatches,
    fixtureAliasSuggestions: comparison.fixtureAliasSuggestions,
    logoAliasSuggestions: comparison.logoAliasSuggestions,
    localTeamsMissingFromFlashscore: comparison.localTeamsMissingFromFlashscore,
    flashscoreTeamsMissingFromLocal: comparison.flashscoreTeamsMissingFromLocal,
    localTeamsMissingFromLogos: comparison.localTeamsMissingFromLogos,
    flashscoreTeamsMissingFromLogos: comparison.flashscoreTeamsMissingFromLogos,
    review: comparison.review,
  };

  const outputPath = path.join(baseDir, "team-alias-report.json");
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`Local fixture teams found: ${localTeams.size}`);
  console.log(`Logo teams found: ${logoTeams.size}`);
  console.log(`Flashscore teams found: ${flashscoreTeams.size}`);
  console.log(`Fixture alias suggestions: ${Object.keys(comparison.fixtureAliasSuggestions).length}`);
  console.log(`Logo alias suggestions: ${Object.keys(comparison.logoAliasSuggestions).length}`);
  console.log(`Review items: ${comparison.review.length}`);
  console.log(`Wrote: ${outputPath}`);
  console.log("");

  console.log("Suggested TEAM_NAME_ALIASES:");
  console.log("const TEAM_NAME_ALIASES = " + JSON.stringify(comparison.fixtureAliasSuggestions, null, 2));
  console.log("");

  console.log("Suggested LOGO_NAME_ALIASES:");
  console.log("const LOGO_NAME_ALIASES = " + JSON.stringify(comparison.logoAliasSuggestions, null, 2));
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

async function collectLocalTeams(baseDir) {
  const teams = new Set();

  for (const league of LEAGUES) {
    const filePath = path.join(baseDir, league.file);
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data.matches)) continue;

    for (const match of data.matches) {
      if (match.team1) teams.add(cleanTeamName(match.team1));
      if (match.team2) teams.add(cleanTeamName(match.team2));
    }
  }

  return teams;
}

async function collectLogoTeams(baseDir) {
  const teams = new Set();
  const filePath = path.join(baseDir, "site/data/team-logos.json");
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw);

  const arr = Array.isArray(data) ? data : (Array.isArray(data.teams) ? data.teams : []);

  for (const item of arr) {
    if (item?.team) teams.add(cleanTeamName(item.team));
  }

  return teams;
}

async function collectFlashscoreTeams(headful) {
  const browser = await chromium.launch({ headless: !headful });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 2200 }
  });

  const teams = new Set();

  try {
    for (const league of LEAGUES) {
      console.log(`Scraping ${league.label}...`);
      await gotoWithRetry(page, league.url);
      await acceptCookies(page);
      await expandFixtures(page, league.url);

      const bodyText = await page.locator("body").innerText();
      const extracted = extractTeamsFromText(bodyText);

      for (const team of extracted) {
        teams.add(team);
      }
    }
  } finally {
    await browser.close();
  }

  return teams;
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
      if (i < attempts) {
        await page.waitForTimeout(2500);
      }
    }
  }

  throw lastError;
}

async function acceptCookies(page) {
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
        return;
      }
    } catch {
      // ignore
    }
  }
}

function isFixturesUrl(url) {
  return url.includes("/football/england/") && url.includes("/fixtures/");
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

    if (!isFixturesUrl(page.url())) {
      await page.goto(fixturesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      continue;
    }

    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1000);

    const bodyText = await page.locator("body").innerText();
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

function looksLikeRealTeamName(value) {
  if (!looksLikeTeamName(value)) return false;

  const badExact = new Set([
    "England",
    "Scotland",
    "Wales",
    "Ireland",
    "Australia W",
    "Great Britain W",
    "MATCH",
    "H2H",
    "LIVE",
    "STANDINGS",
    "Advertisement"
  ]);

  if (badExact.has(value)) return false;

  // Filter obvious non-football names like darts/snooker players
  if (!/\s/.test(value) && value.length < 5) return false;

  return true;
}

function filterFlashscoreTeamsToRelevantOnes(flashscoreTeams, localTeams, logoTeams) {
  const relevant = new Set();
  const candidatePool = [...new Set([...localTeams, ...logoTeams])];

  for (const flashTeam of flashscoreTeams) {
    const best = findBestMatch(flashTeam, candidatePool);
    if (best && best.score >= 0.55) {
      relevant.add(flashTeam);
    }
  }

  return relevant;
}

function extractTeamsFromText(bodyText) {
  const text = (bodyText || "").replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const teams = new Set();

  // Format A: dated summary lines only
  // Example: 12/04 Team A v Team B, Team C v Team D
  const summaryLines = lines.filter(line => /^\d{2}\/\d{2}\s+/.test(line));

  for (const line of summaryLines) {
    const fixtures = parseFixtureSummaryLine(line);
    for (const fixture of fixtures) {
      if (looksLikeRealTeamName(fixture.team1)) teams.add(fixture.team1);
      if (looksLikeRealTeamName(fixture.team2)) teams.add(fixture.team2);
    }
  }

  // Format B: row-block fixture layout only
  // Example:
  // 12.04. 15:00
  // Team A
  // Team B
  for (let i = 0; i < lines.length - 2; i++) {
    if (!parseFlashscoreDateTimeLoose(lines[i])) continue;

    const team1 = cleanTeamName(lines[i + 1]);
    const team2 = cleanTeamName(lines[i + 2]);

    if (!looksLikeRealTeamName(team1) || !looksLikeRealTeamName(team2)) continue;

    teams.add(team1);
    teams.add(team2);
  }

  return teams;
}

function parseFixtureSummaryLine(line) {
  const results = [];
  const tokens = line.split(/,\s*/);

  for (const token of tokens) {
    const trimmed = token.trim();

    const dated = trimmed.match(/^(\d{2})\/(\d{2})\s+(.+)$/);
    if (dated) {
      const fixture = parseTeamPair(dated[3].trim());
      if (fixture) results.push(fixture);
      continue;
    }

    const fixture = parseTeamPair(trimmed);
    if (fixture) results.push(fixture);
  }

  return results;
}

function parseFlashscoreDateTimeLoose(line) {
  const text = String(line || "").trim();

  if (/^\d{2}\.\d{2}\.\s+\d{2}:\d{2}$/.test(text)) return true;
  if (/^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}$/.test(text)) return true;

  return false;
}

function parseTeamPair(text) {
  if (!text) return null;
  const match = text.match(/^(.+?)\s+v\s+(.+?)$/i);
  if (!match) return null;

  return {
    team1: cleanTeamName(match[1]),
    team2: cleanTeamName(match[2]),
  };
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

function cleanTeamName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function buildComparison({ localTeams, logoTeams, flashscoreTeams }) {
  const localList = sortStrings([...localTeams]);
  const logoList = sortStrings([...logoTeams]);
  const flashList = sortStrings([...flashscoreTeams]);

  const exactMatches = [];
  const fixtureAliasSuggestions = {};
  const logoAliasSuggestions = {};
  const localTeamsMissingFromFlashscore = [];
  const flashscoreTeamsMissingFromLocal = [];
  const localTeamsMissingFromLogos = [];
  const flashscoreTeamsMissingFromLogos = [];
  const review = [];

  const localNormMap = buildNormalizedIndex(localList);
  const logoNormMap = buildNormalizedIndex(logoList);
  const flashNormMap = buildNormalizedIndex(flashList);

  for (const localTeam of localList) {
    if (flashscoreTeams.has(localTeam)) {
      exactMatches.push({ local: localTeam, flashscore: localTeam });
      continue;
    }

    const bestFlash = findBestMatch(localTeam, flashList);
    if (bestFlash && bestFlash.score >= 0.78) {
      fixtureAliasSuggestions[localTeam] = bestFlash.value;
    } else {
      localTeamsMissingFromFlashscore.push(localTeam);
      review.push({
        type: "local_missing_from_flashscore",
        localTeam,
        candidates: bestFlash ? [bestFlash] : []
      });
    }
  }

  for (const flashTeam of flashList) {
    if (localTeams.has(flashTeam)) continue;

    const bestLocal = findBestMatch(flashTeam, localList);
    if (!bestLocal || bestLocal.score < 0.78) {
      flashscoreTeamsMissingFromLocal.push(flashTeam);
      review.push({
        type: "flashscore_missing_from_local",
        flashscoreTeam: flashTeam,
        candidates: bestLocal ? [bestLocal] : []
      });
    }
  }

  for (const localTeam of localList) {
    if (logoTeams.has(localTeam)) continue;

    const bestLogo = findBestMatch(localTeam, logoList);
    if (bestLogo && bestLogo.score >= 0.78) {
      logoAliasSuggestions[localTeam] = bestLogo.value;
    } else {
      localTeamsMissingFromLogos.push(localTeam);
      review.push({
        type: "local_missing_from_logos",
        localTeam,
        candidates: bestLogo ? [bestLogo] : []
      });
    }
  }

  for (const flashTeam of flashList) {
    const bestLogo = findBestMatch(flashTeam, logoList);
    if (!bestLogo || bestLogo.score < 0.78) {
      flashscoreTeamsMissingFromLogos.push(flashTeam);
      review.push({
        type: "flashscore_missing_from_logos",
        flashscoreTeam: flashTeam,
        candidates: bestLogo ? [bestLogo] : []
      });
    }
  }

  return {
    exactMatches,
    fixtureAliasSuggestions: sortObjectKeys(fixtureAliasSuggestions),
    logoAliasSuggestions: sortObjectKeys(logoAliasSuggestions),
    localTeamsMissingFromFlashscore: sortStrings(localTeamsMissingFromFlashscore),
    flashscoreTeamsMissingFromLocal: sortStrings(flashscoreTeamsMissingFromLocal),
    localTeamsMissingFromLogos: sortStrings(localTeamsMissingFromLogos),
    flashscoreTeamsMissingFromLogos: sortStrings(flashscoreTeamsMissingFromLogos),
    review,
    localNormMap,
    logoNormMap,
    flashNormMap,
  };
}

function buildNormalizedIndex(list) {
  const out = {};
  for (const item of list) {
    out[item] = normalizeTeamName(item);
  }
  return out;
}

function findBestMatch(source, candidates) {
  const sourceNorm = normalizeTeamName(source);
  let best = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const candidateNorm = normalizeTeamName(candidate);

    if (!isSafeAliasCandidate(sourceNorm, candidateNorm)) continue;

    const score = similarityScore(sourceNorm, candidateNorm);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best) return null;

  return {
    value: best,
    score: Number(bestScore.toFixed(4))
  };
}

function isSafeAliasCandidate(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  const aWords = a.split(" ").filter(Boolean);
  const bWords = b.split(" ").filter(Boolean);

  const sharedWords = aWords.filter(word => bWords.includes(word));
  if (sharedWords.length >= 1) return true;

  return a.includes(b) || b.includes(a);
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\bfootball club\b/g, "")
    .replace(/\bafc\b/g, "")
    .replace(/\bfc\b/g, "")
    .replace(/\butd\b/g, "united")
    .replace(/\bathletic\b/g, "")
    .replace(/\btown\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/\brovers\b/g, "")
    .replace(/\bwanderers\b/g, "")
    .replace(/\balbion\b/g, "")
    .replace(/\bcounty\b/g, "")
    .replace(/\bhotspur\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function sortStrings(arr) {
  return [...arr].sort((a, b) => a.localeCompare(b));
}

function sortObjectKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

main().catch((err) => {
  console.error("❌ Failed to generate alias report");
  console.error(err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});