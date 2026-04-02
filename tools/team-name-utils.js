const fs = require("fs");
const path = require("path");

const TEAM_MAP_PATH = path.join(__dirname, "..", "site", "data", "team-name-map.json");
const TEAM_MAP_JSON = JSON.parse(fs.readFileSync(TEAM_MAP_PATH, "utf8"));
const TEAM_ROWS = Array.isArray(TEAM_MAP_JSON.teams) ? TEAM_MAP_JSON.teams : [];

const byCanonical = new Map();
const byFlashscore = new Map();
const byLogo = new Map();
const bySearch = new Map();

for (const row of TEAM_ROWS) {
  if (!row || !row.canonical) continue;

  const canonical = String(row.canonical).trim();
  const flashscore = String(row.flashscore || canonical).trim();
  const logo = String(row.logo || canonical).trim();
  const searchTerms = Array.isArray(row.search) ? row.search : [canonical, flashscore, logo];

  byCanonical.set(normalizeTeamLookupKey(canonical), row);
  byFlashscore.set(normalizeTeamLookupKey(flashscore), row);
  byLogo.set(normalizeTeamLookupKey(logo), row);

  for (const term of searchTerms) {
    bySearch.set(normalizeTeamLookupKey(term), row);
  }
}

function normalizeTeamLookupKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCanonicalTeamName(name) {
  const key = normalizeTeamLookupKey(name);
  const row =
    byCanonical.get(key) ||
    byFlashscore.get(key) ||
    byLogo.get(key) ||
    bySearch.get(key);

  return row ? row.canonical : String(name || "").trim();
}

function getFlashscoreTeamName(name) {
  const key = normalizeTeamLookupKey(name);
  const row =
    byCanonical.get(key) ||
    byFlashscore.get(key) ||
    byLogo.get(key) ||
    bySearch.get(key);

  return row ? row.flashscore : String(name || "").trim();
}

function getLogoTeamName(name) {
  const key = normalizeTeamLookupKey(name);
  const row =
    byCanonical.get(key) ||
    byFlashscore.get(key) ||
    byLogo.get(key) ||
    bySearch.get(key);

  return row ? row.logo : String(name || "").trim();
}

function areTeamsEquivalent(a, b) {
  return normalizeTeamLookupKey(getCanonicalTeamName(a)) === normalizeTeamLookupKey(getCanonicalTeamName(b));
}

module.exports = {
  TEAM_ROWS,
  normalizeTeamLookupKey,
  getCanonicalTeamName,
  getFlashscoreTeamName,
  getLogoTeamName,
  areTeamsEquivalent
};