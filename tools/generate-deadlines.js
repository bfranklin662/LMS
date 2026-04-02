const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const FIXTURE_SOURCES = [
  { league: "Premier League", file: "site/data/fixtures/premier-league.json" },
  { league: "Championship", file: "site/data/fixtures/championship.json" },
  { league: "League One", file: "site/data/fixtures/league-one.json" },
  { league: "League Two", file: "site/data/fixtures/league-two.json" },
  { league: "FA Cup", file: "site/data/fixtures/fa-cup.json" },
];

const SOURCE_TIMEZONE = "Europe/London";
const DEADLINE_HOURS_BEFORE_FIRST_FIXTURE = 0;

function detectGwId(raw) {
  const direct = String(raw.gwId || "").trim();
  if (direct) return direct.toUpperCase();

  const round = String(raw.round || "").trim();
  const m = round.match(/GW\s*([0-9]+)/i) || round.match(/Gameweek\s*([0-9]+)/i);
  if (m) return `GW${Number(m[1])}`;

  return null;
}

function parseKickoffLocalUK(dateStr, timeStr) {
  const t = (timeStr && String(timeStr).trim()) ? String(timeStr).trim() : "12:00";

  const dt = DateTime.fromISO(`${dateStr}T${t}`, { zone: SOURCE_TIMEZONE });
  if (!dt.isValid) return null;

  return dt.toUTC().toJSDate();
}

function normalizeFixture(raw, leagueName) {
  const gwId = detectGwId(raw);
  if (!gwId) return null;

  const dateStr = String(raw.date || "").trim();
  if (!dateStr) return null;

  const home = String(raw.team1 || "").trim();
  const away = String(raw.team2 || "").trim();
  if (!home || !away) return null;

  const kickoff = parseKickoffLocalUK(dateStr, raw.time);
  if (!kickoff) return null;

  return {
    gwId,
    league: leagueName,
    home,
    away,
    kickoff
  };
}

function loadAllFixtures() {
  const fixtures = [];

  for (const source of FIXTURE_SOURCES) {
    const fullPath = path.resolve(PROJECT_ROOT, source.file);
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const matches = Array.isArray(raw.matches) ? raw.matches : [];

    for (const m of matches) {
      const fx = normalizeFixture(m, source.league);
      if (fx) fixtures.push(fx);
    }
  }

  return fixtures.sort((a, b) => a.kickoff - b.kickoff);
}

function buildDeadlines(fixtures) {
  const byGw = new Map();

  for (const fx of fixtures) {
    if (!byGw.has(fx.gwId)) byGw.set(fx.gwId, []);
    byGw.get(fx.gwId).push(fx);
  }

  const deadlines = Array.from(byGw.entries())
    .map(([gwId, gwFixtures]) => {
      gwFixtures.sort((a, b) => a.kickoff - b.kickoff);

      const firstKickoff = gwFixtures[0].kickoff;
      const lastKickoff = gwFixtures[gwFixtures.length - 1].kickoff;

      const normalDeadline = new Date(
        firstKickoff.getTime() - DEADLINE_HOURS_BEFORE_FIRST_FIXTURE * 60 * 60 * 1000
      );

      const lateDeadline = new Date(lastKickoff.getTime());

      return {
        gwId,
        normalDeadlineIso: normalDeadline.toISOString(),
        lateDeadlineIso: lateDeadline.toISOString(),
        firstKickoffIso: firstKickoff.toISOString(),
        lastKickoffIso: lastKickoff.toISOString()
      };
    })
    .sort((a, b) => {
      const an = Number(String(a.gwId).replace("GW", ""));
      const bn = Number(String(b.gwId).replace("GW", ""));
      return an - bn;
    });

  return { deadlines };
}

function main() {
  const fixtures = loadAllFixtures();
  const output = buildDeadlines(fixtures);

  const outPath = path.resolve(PROJECT_ROOT, "site/data/gameweek-deadlines.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log(`Generated ${outPath}`);
}

main();