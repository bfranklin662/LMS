const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "site", "data", "fixtures", "premier-league.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const shift = (gw) => {
  const num = parseFloat(String(gw).replace("GW", ""));

  // Leave GW1–GW6 unchanged
  if (num <= 6) return gw;

  return `GW${num + 1}`;
};

data.matches = data.matches.map(match => ({
  ...match,
  gwId: shift(match.gwId)
}));

fs.writeFileSync("premier-league-updated.json", JSON.stringify(data, null, 2));

console.log("Premier League gameweeks shifted (GW1–GW6 unchanged).");