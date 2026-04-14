// admin.js

const API_URL = "https://lms-api.nick-horne123.workers.dev";
const FIXTURE_SYNC_API_URL =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "";
const LS_ADMIN_KEY = "lms_admin_key";
const AUTOMATION_STATUS_URL = "../site/data/automation-status.json";


/*******************************
 * API
 *******************************/
async function api(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    mode: "cors",
    redirect: "follow",
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`); }

  if (!data.ok) throw new Error(data.error || "API error");
  return data;
}

async function fixtureApi(path, payload) {
  if (!FIXTURE_SYNC_API_URL) {
    throw new Error("Fixture sync is only available in local admin for now.");
  }

  const res = await fetch(`${FIXTURE_SYNC_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Fixture API non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Fixture API error (${res.status})`);
  }

  return data;
}

async function loadAdminGames() {
  const data = await api({ action: "getGames" });
  adminGames = Array.isArray(data.games) ? data.games : [];

  if (!adminGameSelect) return;

  adminGameSelect.innerHTML = "";

  if (!adminGames.length) {
    adminGameSelect.innerHTML = `<option value="">No games found</option>`;
    selectedGameId = "";
    return;
  }

  for (const g of adminGames) {
    const opt = document.createElement("option");
    opt.value = String(g.id || "");
    opt.textContent = g.title
      ? String(g.title)
      : String(g.id || "");
    adminGameSelect.appendChild(opt);
  }

  if (!selectedGameId || !adminGames.some(g => String(g.id) === String(selectedGameId))) {
    selectedGameId = String(adminGames[0].id || "");
  }

  adminGameSelect.value = selectedGameId;
}

/*******************************
 * UI helpers
 *******************************/
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[m]));
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.classList.add("btn-loading");
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-text">${btn.textContent}</span>`;
  } else {
    btn.classList.remove("btn-loading");
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });

  await Promise.all(runners);
  return results;
}



const splash = document.getElementById("splash");
function showSplash(on) {
  if (!splash) return;
  splash.classList.toggle("hidden", !on);
}

const adminMsg = document.getElementById("adminMsg");
function showMsg(text, good = true) {
  if (!adminMsg) return;
  adminMsg.textContent = text;
  adminMsg.classList.remove("hidden", "good", "bad");
  adminMsg.classList.add(good ? "good" : "bad");
}
function hideMsg() { adminMsg?.classList.add("hidden"); }

/*******************************
 * DOM
 *******************************/
const adminKeyEl = document.getElementById("adminKey");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");

const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const tabButtons = document.querySelectorAll(".tab2");
const approvalsPanel = document.getElementById("panel-approvals");
const subsPanel = document.getElementById("panel-submissions");
const subsContainer = document.getElementById("subsContainer");

const refreshApprovalsBtn = document.getElementById("refreshApprovalsBtn");
const pendingMeta = document.getElementById("pendingMeta");

const pendingList = document.getElementById("pendingList");
const pendingCount = document.getElementById("pendingCount");
const approvedList = document.getElementById("approvedList");
const approvedCount = document.getElementById("approvedCount");

const refreshSubsBtn = document.getElementById("refreshSubsBtn");
const subsMeta = document.getElementById("subsMeta");

const adminGameSelect = document.getElementById("adminGameSelect");
const subsPendingCount = document.getElementById("subsPendingCount");
const subsResolvedCount = document.getElementById("subsResolvedCount");

const bulkResolveModal = document.getElementById("bulkResolveModal");
const bulkResolveModalTitle = document.getElementById("bulkResolveModalTitle");
const bulkResolveModalBody = document.getElementById("bulkResolveModalBody");

const bulkResolveCancelBtn = document.getElementById("bulkResolveCancelBtn");
const bulkResolveConfirmBtn = document.getElementById("bulkResolveConfirmBtn");

const adminFixtureGwSelect = document.getElementById("adminFixtureGwSelect");
const adminFixturesList = document.getElementById("adminFixturesList");
const fixturesMeta = document.getElementById("fixturesMeta");

const commitFixturesBtn = document.getElementById("commitFixturesBtn");
const fixturesPanel = document.getElementById("panel-fixtures");
const refreshFixturesBtn = document.getElementById("refreshFixturesBtn");

const fixtureScanFromDate = document.getElementById("fixtureScanFromDate");
const fixtureScanToDate = document.getElementById("fixtureScanToDate");

const fixtureChangesSummary = document.getElementById("fixtureChangesSummary");

const fixtureScanStatusWrap = document.getElementById("fixtureScanStatusWrap");
const fixtureScanStatusText = document.getElementById("fixtureScanStatusText");
const fixtureScanBar = document.getElementById("fixtureScanBar");

const fixtureFirstDeadlineText = document.getElementById("fixtureFirstDeadlineText");
const fixtureLateDeadlineText = document.getElementById("fixtureLateDeadlineText");

const updateResultsBtn = document.getElementById("updateResultsBtn");

const automationStatusBody = document.getElementById("automationStatusBody");


let TEAM_NAME_MAP_ROWS = [];
let TEAM_NAME_MAP_BY_ANY = new Map();


let bulkResolveOnConfirm = null;

function openBulkResolveModal({ title, html, onConfirm }) {
  if (!bulkResolveModal) return;

  if (bulkResolveModalTitle) bulkResolveModalTitle.textContent = title || "Confirm";
  if (bulkResolveModalBody) bulkResolveModalBody.innerHTML = html || "";
  bulkResolveOnConfirm = onConfirm || null;

  if (bulkResolveConfirmBtn) {
    bulkResolveConfirmBtn.textContent = "Confirm";
    bulkResolveConfirmBtn.classList.remove("hidden");
  }

  if (bulkResolveCancelBtn) {
    bulkResolveCancelBtn.textContent = "Cancel";
    bulkResolveCancelBtn.classList.remove("hidden");
  }

  bulkResolveModal.classList.remove("hidden");
  bulkResolveModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeBulkResolveModal() {
  if (!bulkResolveModal) return;

  bulkResolveModal.classList.add("hidden");
  bulkResolveModal.setAttribute("aria-hidden", "true");
  bulkResolveOnConfirm = null;
  document.body.style.overflow = "";
}

function normalizeFixtureOpTeam_(name) {
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


bulkResolveCancelBtn?.addEventListener("click", closeBulkResolveModal);

bulkResolveConfirmBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  const fn = bulkResolveOnConfirm;
  if (!fn) return;

  closeBulkResolveModal(); // close confirm modal first

  try {
    await fn(); // commit button spinner stays visible on the page
  } catch (err) {
    showMsg(String(err.message || err), false);
  }
});

bulkResolveModal?.addEventListener("click", (e) => {
  if (e.target === bulkResolveModal) closeBulkResolveModal();
});



function renderFixtureChangesSummary_() {
  if (!fixtureChangesSummary) return;
  fixtureChangesSummary.innerHTML = buildFixtureChangesSummaryHtml_();
}



function getSelectedFixtureGwObj_() {
  return (adminFixtureGameweeks || []).find(
    gw => String(gw.gwId) === String(adminFixtureSelectedGw)
  ) || null;
}

function setFixtureScanDatesFromSelectedGw_() {
  const gw = getSelectedFixtureGwObj_();
  if (!gw) return;

  const days = (gw.days || [])
    .map(d => String(d.dayKey || ""))
    .filter(Boolean)
    .sort();

  if (!days.length) return;

  if (fixtureScanFromDate) fixtureScanFromDate.value = days[0];
  if (fixtureScanToDate) fixtureScanToDate.value = days[days.length - 1];

  if (refreshFixturesBtn) {
    refreshFixturesBtn.textContent = `Rescan ${gw.displayGwId || gw.gwId} fixtures`;
  }
}

async function loadDeadlinesFile_() {
  const res = await fetch(`../site/data/gameweek-deadlines.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load gameweek deadlines");
  return res.json();
}

function formatDeadlineForInputishDisplay_(iso) {
  if (!iso) return "—";

  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function getAdminLeagueKeysForSelectedGame_() {
  const leagues = getAdminGameCompetitions_(getSelectedGame_());

  const map = {
    "premier league": "premier-league",
    "championship": "championship",
    "league one": "league-one",
    "league two": "league-two",
    "fa cup": "fa-cup"
  };

  return leagues
    .map(name => map[String(name || "").trim().toLowerCase()])
    .filter(Boolean);
}

async function updateFixtureDeadlineInfo_() {
  if (!fixtureFirstDeadlineText || !fixtureLateDeadlineText) return;

  const gw = getSelectedFixtureGwObj_();
  if (!gw) {
    fixtureFirstDeadlineText.textContent = "—";
    fixtureLateDeadlineText.textContent = "—";
    return;
  }

  const fixtures = [];

  for (const day of gw.days || []) {
    for (const league of day.leagues || []) {
      for (const fx of league.fixtures || []) {
        const date = String(fx.date || "").trim();
        const time = String(fx.time || "").trim() || "12:00";
        const kickoff = new Date(`${date}T${time}:00`);

        if (!isNaN(kickoff.getTime())) {
          fixtures.push(kickoff);
        }
      }
    }
  }

  fixtures.sort((a, b) => a - b);

  if (!fixtures.length) {
    fixtureFirstDeadlineText.textContent = "—";
    fixtureLateDeadlineText.textContent = "—";
    return;
  }

  const firstKickoff = fixtures[0];
  const lastKickoff = fixtures[fixtures.length - 1];

  const normalDeadline = new Date(firstKickoff.getTime() - 60 * 60 * 1000);
  const lateDeadline = lastKickoff;

  fixtureFirstDeadlineText.textContent = formatDeadlineForInputishDisplay_(normalDeadline.toISOString());
  fixtureLateDeadlineText.textContent = formatDeadlineForInputishDisplay_(lateDeadline.toISOString());
}

function getAdminGameCompetitions_(game = getSelectedGame_()) {
  const raw = String(game?.competitions || "").trim();

  if (!raw) {
    return ["Premier League", "Championship", "League One", "League Two"];
  }

  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function adminGameIncludesLeague_(leagueName, game = getSelectedGame_()) {
  const allowed = getAdminGameCompetitions_(game).map(x => x.toLowerCase());
  return allowed.includes(String(leagueName || "").trim().toLowerCase());
}

/*******************************
 * STATE
 *******************************/
let adminKey = "";
let fixturePreviewData = null;

let adminFixtureGameweeks = [];
let adminFixtureSelectedGw = "ALL";
let adminFixtureSelectedDay = "ALL";

let fixtureEditorData = null;
const fixtureEdits = new Map(); // fixtureId => { include: boolean, remove: boolean, applyUpdate: boolean }

const seenSubs = new Map();   // key -> { outcome, el, gwId, isResolved }

let selectedGameId = "";
let adminGames = [];

let adminPickCountsByFixture = new Map();

let fixtureAdminServerAvailable = false;

const FIXTURE_SOURCES = [
  { league: "Premier League", url: "../site/data/fixtures/premier-league.json" },
  { league: "Championship", url: "../site/data/fixtures/championship.json" },
  { league: "League One", url: "../site/data/fixtures/league-one.json" },
  { league: "League Two", url: "../site/data/fixtures/league-two.json" },
  { league: "FA Cup", url: "../site/data/fixtures/fa-cup.json" },
];

let adminFixtures = [];


let fixtureScanStatusTimer = null;
let fixtureScanStatusIndex = 0;

function startFixtureScanLoading_() {
  const leagueNames = getAdminGameCompetitions_(getSelectedGame_());

  const messages = [
    "Scraping data from Flashscore",
    ...leagueNames.map(name => `Checking ${name} fixtures`)
  ];

  fixtureScanStatusIndex = 0;

  if (fixtureScanStatusWrap) fixtureScanStatusWrap.classList.remove("hidden");
  if (fixtureScanStatusText) fixtureScanStatusText.textContent = messages[0];
  fixtureScanBar?.classList.add("is-animating");

  if (fixtureScanStatusTimer) clearInterval(fixtureScanStatusTimer);

  fixtureScanStatusTimer = setInterval(() => {
    fixtureScanStatusIndex = (fixtureScanStatusIndex + 1) % messages.length;
    if (fixtureScanStatusText) {
      fixtureScanStatusText.textContent = messages[fixtureScanStatusIndex];
    }
  }, 1100);
}

async function updateResultsForSelectedGw_() {
  const selectedGw = (adminFixtureGameweeks || []).find(
    gw => String(gw.gwId) === String(adminFixtureSelectedGw)
  );

  if (!selectedGw) {
    throw new Error("No gameweek selected.");
  }

  const from = fixtureScanFromDate?.value || "";
  const to = fixtureScanToDate?.value || "";

  if (!from || !to) {
    throw new Error("Choose both result dates.");
  }

  const actualGwId = selectedGw.actualGwId || getActualGwIdForSelectedGame_(selectedGw.gwId);

  setBtnLoading(updateResultsBtn, true);

  try {
    const leagueKeys = getAdminLeagueKeysForSelectedGame_();

    const data = await fixtureApi("/results/update-gw", {
      adminKey,
      actualGwId,
      from,
      to,
      league: leagueKeys.length === 1 ? leagueKeys[0] : "all",
      allowedLeagueKeys: leagueKeys,
      useTestFiles: false
    });

    await loadGroupedFixturesView();

    const lines = [];

    for (const r of data.results || []) {
      const changedCount = Array.isArray(r.updated) ? r.updated.length : 0;
      if (changedCount) {
        lines.push(`${r.label}: ${changedCount} result${changedCount === 1 ? "" : "s"} updated`);
      }
    }

    if (!lines.length) {
      showMsg(`No new results found for ${adminFixtureSelectedGw}.`, true);
      return;
    }

    openBulkResolveModal({
      title: "Results updated",
      html: `<div style="line-height:1.6;">${lines.map(line => `<div>${escapeHtml(line)}</div>`).join("")}</div>`,
      onConfirm: async () => { }
    });

    const confirmBtn = document.getElementById("bulkResolveConfirmBtn");
    const cancelBtn = document.getElementById("bulkResolveCancelBtn");
    if (confirmBtn) confirmBtn.textContent = "OK";
    if (cancelBtn) cancelBtn.classList.add("hidden");

    showMsg(`Results updated for ${adminFixtureSelectedGw}.`, true);
  } finally {
    setBtnLoading(updateResultsBtn, false);
  }
}

function stopFixtureScanLoading_(finalLines = []) {
  if (fixtureScanStatusTimer) {
    clearInterval(fixtureScanStatusTimer);
    fixtureScanStatusTimer = null;
  }

  fixtureScanBar?.classList.remove("is-animating");

  if (!fixtureScanStatusWrap || !fixtureScanStatusText) return;

  if (finalLines.length) {
    fixtureScanStatusText.innerHTML = finalLines.map(line => `<div>${escapeHtml(line)}</div>`).join("");
    setTimeout(() => {
      fixtureScanStatusWrap.classList.add("hidden");
      fixtureScanStatusText.textContent = "";
    }, 3500);
  } else {
    fixtureScanStatusWrap.classList.add("hidden");
    fixtureScanStatusText.textContent = "";
  }
}

async function loadAutomationStatus_() {
  const res = await fetch(`${AUTOMATION_STATUS_URL}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load automation status");
  return res.json();
}

function formatAutomationIso_(iso) {
  if (!iso) return "—";

  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

async function renderAutomationStatus_() {
  if (!automationStatusBody) return;

  automationStatusBody.textContent = "Loading automation status…";

  try {
    const data = await loadAutomationStatus_();

    const status = String(data.status || "unknown").toLowerCase();
    const statusLabel =
      status === "ok" ? "✅ Running" :
        status === "error" ? "❌ Error" :
          "⚪ Unknown";

    automationStatusBody.innerHTML = `
      <div style="line-height:1.7;">
        <div><strong>Automation:</strong> ${escapeHtml(statusLabel)}</div>
        <div><strong>Last run:</strong> ${escapeHtml(formatAutomationIso_(data.lastRunIso))}</div>
      </div>
    `;
  } catch (err) {
    automationStatusBody.innerHTML = `
      <div style="line-height:1.7;">
        <div><strong>Automation:</strong> ⚠️ Unavailable</div>
        <div class="muted">Could not load automation status file.</div>
      </div>
    `;
  }
}

/*******************************
 * Tabs
 *******************************/
const LEAGUE_DISPLAY_ORDER = {
  "FA Cup": 1,
  "Premier League": 2,
  "Championship": 3,
  "League One": 4,
  "League Two": 5
};

function compareLeagueDisplayOrder_(a, b) {
  const aRank = LEAGUE_DISPLAY_ORDER[a?.leagueLabel] ?? 999;
  const bRank = LEAGUE_DISPLAY_ORDER[b?.leagueLabel] ?? 999;

  if (aRank !== bRank) return aRank - bRank;
  return String(a?.leagueLabel || "").localeCompare(String(b?.leagueLabel || ""));
}

function formatAdminFixtureDayLabel_(dayKey) {
  const d = new Date(`${dayKey}T12:00:00`);
  if (isNaN(d.getTime())) return dayKey || "Unknown day";

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "Europe/London"
  }).format(d);
}

function updateFixtureServerDependentButtons_() {
  const noServer = !fixtureAdminServerAvailable;
  const gwComplete = isSelectedGwComplete_();

  if (refreshFixturesBtn) {
    refreshFixturesBtn.disabled = noServer || gwComplete;
  }

  if (updateResultsBtn) {
    updateResultsBtn.disabled = noServer || gwComplete;
  }

  if (commitFixturesBtn) {
    commitFixturesBtn.disabled = noServer || gwComplete;
  }
}

function bindFixtureEditorEvents_() {
  document.querySelectorAll(".fixture-include-toggle").forEach(cb => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();

      const states = captureOpenLeagueStates_();

      const id = cb.getAttribute("data-fixture-id");
      if (!id) return;
      const current = fixtureEdits.get(id) || {};
      current.include = cb.checked;
      fixtureEdits.set(id, current);

      renderAdminFixturesTabView_();
      restoreOpenLeagueStates_(states);
      updateCommitVisibility_();
    });
  });

  document.querySelectorAll(".fixture-update-toggle").forEach(cb => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();

      const states = captureOpenLeagueStates_();

      const id = cb.getAttribute("data-fixture-id");
      if (!id) return;

      const current = fixtureEdits.get(id) || {};
      current.applyUpdate = cb.checked;
      fixtureEdits.set(id, current);

      renderAdminFixturesTabView_();
      restoreOpenLeagueStates_(states);
      updateCommitVisibility_();
    });
  });

  document.querySelectorAll(".fixture-remove-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const states = captureOpenLeagueStates_();

      const id = btn.getAttribute("data-fixture-id");
      if (!id) return;
      const current = fixtureEdits.get(id) || {};
      current.remove = !current.remove;
      fixtureEdits.set(id, current);

      renderAdminFixturesTabView_();
      restoreOpenLeagueStates_(states);
      updateCommitVisibility_();
    });
  });
}

async function loadGroupedFixturesViewFallback_() {
  const allFixtures = [];

  const game = getSelectedGame_();

  for (const source of FIXTURE_SOURCES) {
    if (!adminGameIncludesLeague_(source.league, game)) continue;

    try {
      const res = await fetch(`${source.url}?ts=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) continue;

      const json = await res.json();
      const matches = Array.isArray(json.matches) ? json.matches : [];

      matches.forEach((m, idx) => {
        allFixtures.push({
          fixtureId: `${source.url}::${idx}`,
          file: source.url,
          leagueKey: String(source.league || "")
            .toLowerCase()
            .replace(/\s+/g, "-"),
          leagueLabel: source.league,
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
    } catch {
      // ignore individual file failures
    }
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
        label: formatAdminFixtureDayLabel_(dayKey),
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

  return {
    gameweeks: Array.from(gwMap.values())
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
              .sort(compareLeagueDisplayOrder_)
              .map(league => ({
                ...league,
                fixtures: (league.fixtures || []).sort((a, b) => {
                  const dtDiff = fixtureSortKey(a).localeCompare(fixtureSortKey(b));
                  if (dtDiff !== 0) return dtDiff;
                  return `${a.team1} ${a.team2}`.localeCompare(`${b.team1} ${b.team2}`);
                })
              }))
          }))
      }))
  };
}

function updateCommitVisibility_() {
  const selectedGwObj =
    adminFixtureSelectedGw === "ALL"
      ? null
      : (adminFixtureGameweeks || []).find(
        gw => String(gw.gwId) === String(adminFixtureSelectedGw)
      ) || null;

  const gw = selectedGwObj || (adminFixtureGameweeks || [])[0];

  let hasFixtureChanges = false;

  if (gw) {
    for (const day of gw.days || []) {
      for (const league of day.leagues || []) {
        for (const fx of league.fixtures || []) {
          const edit = fixtureEdits.get(fx.fixtureId) || {};

          if (fx.status === "updated" && edit.applyUpdate !== false) hasFixtureChanges = true;
          if (fx.status === "scraped-only" && edit.include !== false) hasFixtureChanges = true;
          if (fx.status === "removed" && edit.remove !== false) hasFixtureChanges = true;

          if (
            fx.status !== "removed" &&
            fx.status !== "scraped-only" &&
            edit.remove
          ) {
            hasFixtureChanges = true;
          }
        }
      }
    }
  }

  if (commitFixturesBtn) {
    commitFixturesBtn.disabled =
      !fixtureAdminServerAvailable ||
      isSelectedGwComplete_() ||
      !hasFixtureChanges;
  }
}

function getGwDropdownLabel_(gw) {
  const days = (gw.days || [])
    .map(d => String(d.dayKey || ""))
    .filter(Boolean)
    .sort();

  if (!days.length) return gw.displayGwId || gw.gwId || "GW";

  const first = formatAdminFixtureDayLabel_(days[0]);
  const last = formatAdminFixtureDayLabel_(days[days.length - 1]);

  if (days.length === 1) {
    return `${gw.displayGwId || gw.gwId} (${first})`;
  }

  return `${gw.displayGwId || gw.gwId} (${first} - ${last})`;
}

function buildFixtureChangesSummaryHtml_() {
  const selectedGwObj =
    adminFixtureSelectedGw === "ALL"
      ? null
      : (adminFixtureGameweeks || []).find(gw => String(gw.gwId) === String(adminFixtureSelectedGw)) || null;

  const gw = selectedGwObj || (adminFixtureGameweeks || [])[0];
  if (!gw) return "";

  const summary = new Map();

  function ensureLeague(leagueName) {
    if (!summary.has(leagueName)) {
      summary.set(leagueName, { updated: 0, removed: 0, added: 0 });
    }
    return summary.get(leagueName);
  }

  for (const day of gw.days || []) {
    for (const league of day.leagues || []) {
      for (const fx of league.fixtures || []) {
        const row = ensureLeague(league.leagueLabel);
        const edit = fixtureEdits.get(fx.fixtureId) || {};

        if (fx.status === "updated" && edit.applyUpdate !== false) {
          row.updated += 1;
          continue;
        }

        if (fx.status === "scraped-only" && edit.include !== false) {
          row.added += 1;
          continue;
        }

        if (
          (fx.status === "removed" && edit.remove !== false) ||
          (fx.status !== "scraped-only" && fx.status !== "removed" && edit.remove)
        ) {
          row.removed += 1;
          continue;
        }
      }
    }
  }

  const lines = Array.from(summary.entries())
    .map(([leagueName, counts]) => {
      const parts = [];
      if (counts.updated) parts.push(`${counts.updated} date/time change${counts.updated === 1 ? "" : "s"}`);
      if (counts.removed) parts.push(`${counts.removed} removed`);
      if (counts.added) parts.push(`${counts.added} added`);
      if (!parts.length) return "";
      return `<div>${escapeHtml(leagueName)}: ${escapeHtml(parts.join(", "))}.</div>`;
    })
    .filter(Boolean);

  if (!lines.length) return "";

  return `
    <div class="muted small" style="margin-top:18px;line-height:1.7;">
      ${lines.join("")}
    </div>
  `;
}

function getSelectedGwLastDayTs_() {
  const gw = getSelectedFixtureGwObj_();
  if (!gw) return null;

  const days = (gw.days || [])
    .map(d => String(d.dayKey || ""))
    .filter(Boolean)
    .sort();

  if (!days.length) return null;

  return new Date(`${days[days.length - 1]}T23:59:59`).getTime();
}

function isFixtureLocked_(fx) {
  const hasScore =
    Number.isInteger(fx.homeScore) &&
    Number.isInteger(fx.awayScore);

  if (hasScore) return true;

  const kickoffTs = fx.date
    ? new Date(`${fx.date}T${String(fx.time || "12:00")}:00`).getTime()
    : null;

  return Number.isFinite(kickoffTs) ? Date.now() >= kickoffTs : false;
}

function canLeagueBeEdited_(league) {
  return (league.fixtures || []).some(fx => !isFixtureLocked_(fx));
}

function getDayScanState_(day) {
  let scanned = false;
  let count = 0;

  for (const league of day.leagues || []) {
    for (const fx of league.fixtures || []) {
      const edit = fixtureEdits.get(fx.fixtureId) || {};

      const isScanChange =
        fx.status === "updated" ||
        fx.status === "scraped-only" ||
        fx.status === "removed";

      const isManualRemove =
        fx.status === "existing" && edit.remove === true;

      if (fx.scanStatus) scanned = true;

      if (isScanChange || isManualRemove) {
        count += 1;
      }
    }
  }

  if (count > 0) scanned = true;

  return { scanned, count };
}

function resetSelectedGwScanState_() {
  const selectedGw = (adminFixtureGameweeks || []).find(
    gw => String(gw.gwId) === String(adminFixtureSelectedGw)
  );

  if (!selectedGw) return;

  adminFixtureGameweeks = adminFixtureGameweeks.map(gw => {
    if (String(gw.gwId) !== String(adminFixtureSelectedGw)) return gw;

    return {
      ...gw,
      days: (gw.days || []).map(day => ({
        ...day,
        leagues: (day.leagues || []).map(league => ({
          ...league,
          fixtures: (league.fixtures || [])
            .filter(fx => !String(fx.fixtureId || "").includes("::SCRAPED::"))
            .map(fx => ({
              ...fx,
              status: "existing",
              change: null,
              scanStatus: null
            }))
        }))
      }))
    };
  });
}

function bindLeagueRemoveAllEvents_() {
  document.querySelectorAll(".league-remove-all-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const dayKey = btn.getAttribute("data-day-key");
      const leagueKey = btn.getAttribute("data-league-key");
      if (!dayKey || !leagueKey) return;

      const states = captureOpenLeagueStates_();
      const shouldUndo = isLeagueMarkedRemoved_(dayKey, leagueKey);

      for (const gw of adminFixtureGameweeks || []) {
        if (String(gw.gwId) !== String(adminFixtureSelectedGw)) continue;

        for (const day of gw.days || []) {
          if (String(day.dayKey) !== String(dayKey)) continue;

          for (const league of day.leagues || []) {
            if (String(league.leagueKey) !== String(leagueKey)) continue;

            // 👇 ADD THE LOG RIGHT HERE
            console.log("REMOVE ALL", {
              dayKey,
              leagueKey,
              fixtures: (league.fixtures || []).map(fx => ({
                fixtureId: fx.fixtureId,
                status: fx.status,
                date: fx.date,
                team1: fx.team1,
                team2: fx.team2
              }))
            });

            for (const fx of league.fixtures || []) {
              const current = fixtureEdits.get(fx.fixtureId) || {};

              if (fx.status === "scraped-only") {
                current.include = shouldUndo ? true : false;
              } else if (fx.status === "updated") {
                current.remove = shouldUndo ? false : true;
                current.applyUpdate = shouldUndo ? true : false;
              } else if (fx.status === "removed") {
                current.remove = shouldUndo ? false : true;
              } else {
                current.remove = shouldUndo ? false : true;
              }

              fixtureEdits.set(fx.fixtureId, current);
            }
          }
        }
      }

      renderAdminFixturesTabView_();
      restoreOpenLeagueStates_(states);
      updateCommitVisibility_();
    });
  });
}

function renderDayScanLabel_(day) {
  const { scanned, count } = getDayScanState_(day);

  if (!scanned) {
    return `<div></div>`;
  }

  if (!count) {
    return `<div class="muted" style="font-size:18px;font-weight:800;white-space:nowrap;">No changes</div>`;
  }

  return `<div style="font-size:18px;font-weight:800;white-space:nowrap;color:#8bc34a;">${count} change${count === 1 ? "" : "s"}</div>`;
}

function getLeagueScanState_(league) {
  let scanned = false;
  let count = 0;

  for (const fx of league.fixtures || []) {
    const edit = fixtureEdits.get(fx.fixtureId) || {};

    const hasManualAdd = fx.status === "scraped-only" && edit.include !== false;
    const hasManualUpdate = fx.status === "updated" && edit.applyUpdate !== false;
    const hasManualRemove =
      (fx.status === "removed" && edit.remove !== false) ||
      (fx.status !== "scraped-only" && fx.status !== "removed" && !!edit.remove);

    if (fx.scanStatus) scanned = true;

    if (hasManualAdd || hasManualUpdate || hasManualRemove) {
      count += 1;
    }
  }

  if (count > 0) scanned = true;

  return { scanned, count };
}

function renderLeagueScanLabel_(league) {
  const { scanned, count } = getLeagueScanState_(league);

  if (!scanned) return "";
  if (!count) return `<span class="muted">No changes</span>`;

  return `${count} change${count === 1 ? "" : "s"}`;
}

function isLeagueMarkedRemoved_(dayKey, leagueKey) {
  const gw = (adminFixtureGameweeks || []).find(
    g => String(g.gwId) === String(adminFixtureSelectedGw)
  );
  if (!gw) return false;

  const day = (gw.days || []).find(d => String(d.dayKey) === String(dayKey));
  if (!day) return false;

  const league = (day.leagues || []).find(l => String(l.leagueKey) === String(leagueKey));
  if (!league || !(league.fixtures || []).length) return false;

  return (league.fixtures || []).every(fx => {
    const edit = fixtureEdits.get(fx.fixtureId) || {};

    if (fx.status === "scraped-only") return edit.include === false;
    if (fx.status === "updated") return edit.applyUpdate === false;
    if (fx.status === "removed") return edit.remove !== false;

    return !!edit.remove;
  });
}

function renderAdminFixturesTabView_() {
  if (!adminFixturesList) return;

  const gameweeks = Array.isArray(adminFixtureGameweeks) ? adminFixtureGameweeks : [];
  if (!gameweeks.length) {
    adminFixturesList.innerHTML = `<div class="muted">No fixtures found.</div>`;
    return;
  }

  const selectedGwObj =
    adminFixtureSelectedGw === "ALL"
      ? null
      : gameweeks.find(gw => String(gw.gwId) === String(adminFixtureSelectedGw)) || null;

  const gwList = selectedGwObj ? [selectedGwObj] : gameweeks;
  const gw = gwList[0];

  if (!gw) {
    adminFixturesList.innerHTML = `<div class="muted">No fixtures found.</div>`;
    return;
  }

  const days = gw.days || [];

  adminFixturesList.innerHTML = `
    ${days.length ? days.map(day => `
      <div class="day-group">
        <div class="day-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div>
            <div class="day-title">${escapeHtml(day.label || formatAdminFixtureDayLabel_(day.dayKey))}</div>
            <div class="day-sub">Fixtures</div>
          </div>

          ${(() => {
      const dayToggle = getDayAddToggleState_(day);
      if (!dayToggle.show) return "";
      return `
              <label style="display:flex;align-items:center;gap:8px;white-space:nowrap;cursor:pointer;">
                <input
                  type="checkbox"
                  class="day-include-toggle"
                  data-day-key="${escapeHtml(day.dayKey)}"
                  ${dayToggle.checked ? "checked" : ""}
                >
                <span class="muted small">Apply all changes</span> 
              </label>
            `;
    })()}
        </div>

        ${(day.leagues || []).slice().sort(compareLeagueDisplayOrder_).map(league => `
          <details class="league-details ${isLeagueMarkedRemoved_(day.dayKey, league.leagueKey) ? 'is-league-removed' : ''}">
            <summary class="league-summary">
              <span class="league-left" style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                <span>${escapeHtml(league.leagueLabel)} (${(league.fixtures || []).length})</span>
                <span style="margin-left:auto;">
                  ${renderLeaguePickBadge_(league)}
                </span>
              </span>

              <span class="league-summary-right">
                <span class="league-change">
                  ${renderLeagueScanLabel_(league)}
                </span>

                ${canLeagueBeEdited_(league) ? `
                <button
                  type="button"
                  class="league-remove-all-btn ${isLeagueMarkedRemoved_(day.dayKey, league.leagueKey) ? "is-undo" : ""}"
                  data-day-key="${escapeHtml(day.dayKey)}"
                  data-league-key="${escapeHtml(league.leagueKey)}"
                >
                  ${isLeagueMarkedRemoved_(day.dayKey, league.leagueKey) ? "↺" : "−"}
                </button>
              ` : ""}
              </span>
            </summary>

            <div class="league-group">
              ${(league.fixtures || []).map(renderFixtureEditorRow_).join("")}
            </div>
          </details>
        `).join("")}
      </div>
    `).join("") : `<div class="muted">No fixtures for this gameweek.</div>`}
  `;

  bindFixtureEditorEvents_();
  bindDayToggleEvents_();
  bindLeagueRemoveAllEvents_();
  renderFixtureChangesSummary_();
  bindPickBadgeEvents_();
}

function populateAdminFixtureFilters_() {
  if (!adminFixtureGwSelect) return;

  const gameweeks = Array.isArray(adminFixtureGameweeks) ? adminFixtureGameweeks : [];

  adminFixtureGwSelect.innerHTML = `<option value="ALL">All gameweeks</option>`;

  gameweeks.forEach(gw => {
    const opt = document.createElement("option");
    opt.value = gw.gwId;
    opt.textContent = getGwDropdownLabel_(gw);
    adminFixtureGwSelect.appendChild(opt);
  });

  if (
    adminFixtureSelectedGw !== "ALL" &&
    !gameweeks.some(gw => String(gw.gwId) === String(adminFixtureSelectedGw))
  ) {
    adminFixtureSelectedGw = "ALL";
  }

  adminFixtureGwSelect.value = adminFixtureSelectedGw;
}

function formatDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function updateFixturesMeta_() {
  if (!fixturesMeta) return;
  fixturesMeta.textContent = `Showing ${adminFixtureSelectedGw} fixtures for ${getSelectedGame_()?.title || selectedGameId}.`;
}


async function setTab(name) {
  tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));

  approvalsPanel?.classList.toggle("hidden", name !== "approvals");
  subsPanel?.classList.toggle("hidden", name !== "submissions");
  fixturesPanel?.classList.toggle("hidden", name !== "fixtures");

  if (name === "approvals") {
    try {
      await loadApprovals();
    } catch (e) {
      showMsg(String(e.message || e), false);
    }
  }

  if (name === "submissions") {
    try {
      await Promise.all([
        refreshSubmissionsIncremental({ full: true }),
        renderAutomationStatus_()
      ]);
    } catch (e) {
      showMsg(String(e.message || e), false);
    }
  }

  if (name === "fixtures") {
    try {
      if (fixturesMeta) fixturesMeta.textContent = "Loading fixtures…";

      await Promise.all([
        loadGroupedFixturesView(),
        refreshSubmissionsIncremental({ full: true })
      ]);
    } catch (e) {
      console.error("loadGroupedFixturesView failed:", e);
      if (fixturesMeta) fixturesMeta.textContent = "Failed to load fixtures.";
      showMsg(String(e.message || e), false);
    }
  }
}

tabButtons.forEach(b => b.addEventListener("click", async () => {
  await setTab(b.dataset.tab);
}));

function enterPanel() {
  loginView?.classList.add("hidden");
  panelView?.classList.remove("hidden");
  adminLogoutBtn?.classList.remove("hidden");
}
function exitPanel() {
  loginView?.classList.remove("hidden");
  panelView?.classList.add("hidden");
  adminLogoutBtn?.classList.add("hidden");
}

/*******************************
 * Approvals
 *******************************/


async function loadApprovals() {
  if (!pendingList || !approvedList) return;
  if (!selectedGameId) {
    pendingList.innerHTML = `<div class="muted">Select a game first.</div>`;
    approvedList.innerHTML = `<div class="muted">Select a game first.</div>`;
    if (pendingCount) pendingCount.textContent = `(0)`;
    if (approvedCount) approvedCount.textContent = `(0)`;
    if (pendingMeta) pendingMeta.textContent = "No game selected.";
    return;
  }

  if (pendingMeta) pendingMeta.textContent = "Refreshing…";

  const data = await api({
    action: "adminListUsers",
    adminKey,
    gameId: selectedGameId
  });

  const users = data.users || [];

  const pending = users.filter(u => !u.approved);
  const approved = users.filter(u => !!u.approved);

  pendingList.innerHTML = "";
  approvedList.innerHTML = "";

  if (pendingCount) pendingCount.textContent = `(${pending.length})`;
  if (approvedCount) approvedCount.textContent = `(${approved.length})`;

  if (!pending.length) pendingList.innerHTML = `<div class="muted">No pending users.</div>`;
  if (!approved.length) approvedList.innerHTML = `<div class="muted">No approved users.</div>`;

  for (const u of pending) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="list-left">
        <div class="list-title">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
        <div class="list-sub">
          ${escapeHtml(u.clubTeam || "—")}
          ${u.gameTitle ? `• ${escapeHtml(u.gameTitle)}` : u.gameId ? `• ${escapeHtml(u.gameId)}` : ``}
        </div>
      </div>
      <button class="btn btn-primary" type="button">Approve</button>
    `;

    const btn = row.querySelector("button");
    btn.addEventListener("click", async () => {
      setBtnLoading(btn, true);
      try {
        await api({
          action: "adminApprove",
          adminKey,
          email: u.email,
          gameId: selectedGameId
        });
        showMsg(`Approved ${u.firstName} ${u.lastName}`, true);
        await loadApprovals();
      } catch (e) {
        showMsg(String(e.message || e), false);
      } finally {
        setBtnLoading(btn, false);
      }
    });

    pendingList.appendChild(row);
  }

  for (const u of approved) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="list-left">
        <div class="list-title">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
        <div class="list-sub">
          ${escapeHtml(u.clubTeam || "—")}
          ${u.gameTitle ? `• ${escapeHtml(u.gameTitle)}` : u.gameId ? `• ${escapeHtml(u.gameId)}` : ``}
        </div>
      </div>
      <span class="state good">✓</span>
    `;
    approvedList.appendChild(row);
  }

  const game = adminGames.find(g => String(g.id) === String(selectedGameId));
  const gameLabel = game?.title || selectedGameId;

  if (pendingMeta) {
    pendingMeta.textContent = `${gameLabel} • Pending: ${pending.length} • Approved: ${approved.length}`;
  }
}

function isSelectedGwComplete_() {
  const gw = getSelectedFixtureGwObj_();
  if (!gw) return false;

  const days = (gw.days || [])
    .map(d => String(d.dayKey || ""))
    .filter(Boolean)
    .sort();

  if (!days.length) return false;

  const lastDay = days[days.length - 1];
  const endOfLastDay = new Date(`${lastDay}T23:59:59`).getTime();

  return Date.now() > endOfLastDay;
}

/*******************************
 * Submissions helpers
 *******************************/


const DEFAULT_TEAM_LOGO = "../site/images/team-default.png";
const TEAM_LOGOS_URL = "../site/data/team-logos.json";
const TEAM_NAME_MAP_URL = "../site/data/team-name-map.json";

function resolveAdminAssetPath_(value) {
  const s = String(value || "").trim();
  if (!s) return DEFAULT_TEAM_LOGO;

  if (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("/") ||
    s.startsWith("../")
  ) {
    return s;
  }

  if (s.startsWith("site/")) {
    return `../${s}`;
  }

  return `../site/${s.replace(/^\.?\//, "")}`;
}

let TEAM_LOGO_MAP = new Map();

function normTeamKeyLogo_(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadTeamLogosOnce_() {
  if (TEAM_LOGO_MAP.size) return;

  const res = await fetch(TEAM_LOGOS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load team logos`);

  const data = await res.json();
  const arr = Array.isArray(data) ? data : (Array.isArray(data.teams) ? data.teams : []);

  TEAM_LOGO_MAP = new Map(
    arr
      .filter(x => x && x.team && x.logo)
      .map(x => [normTeamKeyLogo_(x.team), resolveAdminAssetPath_(x.logo)])
  );
}

async function loadTeamNameMapOnce_() {
  if (TEAM_NAME_MAP_ROWS.length) return;

  const res = await fetch(TEAM_NAME_MAP_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load team name map");

  const data = await res.json();
  TEAM_NAME_MAP_ROWS = Array.isArray(data.teams) ? data.teams : [];
  TEAM_NAME_MAP_BY_ANY = new Map();

  for (const row of TEAM_NAME_MAP_ROWS) {
    const terms = [
      row.canonical,
      row.flashscore,
      row.logo,
      ...(Array.isArray(row.search) ? row.search : [])
    ];

    for (const term of terms) {
      const key = normTeamKeyLogo_(term);
      if (key) TEAM_NAME_MAP_BY_ANY.set(key, row);
    }
  }
}

function getTeamLogo_(teamName) {
  const key = normTeamKeyLogo_(teamName);
  const row = TEAM_NAME_MAP_BY_ANY.get(key);

  const lookupName = row?.canonical || teamName;
  const logoKey = normTeamKeyLogo_(lookupName);

  return TEAM_LOGO_MAP.get(logoKey) || DEFAULT_TEAM_LOGO;
}

function getCanonicalTeamNameLocal_(name) {
  const key = normTeamKeyLogo_(name);
  const row = TEAM_NAME_MAP_BY_ANY.get(key);
  return row?.canonical || String(name || "").trim();
}

function normTeamKey_(s) {
  return String(getCanonicalTeamNameLocal_(s) || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\butd\b/g, "united")
    .replace(/\s+/g, " ")
    .trim();
}

function parseKickoffUK(dateStr, timeStr) {
  const t = (timeStr && String(timeStr).trim()) ? String(timeStr).trim() : null;
  const iso = t ? `${dateStr}T${t}:00` : `${dateStr}T12:00:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function detectGwId(raw) {
  const direct = String(raw.gwId || "").trim();
  if (direct) return direct.toUpperCase();

  const round = String(raw.round || "").trim();
  const m = round.match(/GW\s*([0-9]+)/i) || round.match(/Gameweek\s*([0-9]+)/i);
  if (m) return `GW${Number(m[1])}`;

  return null;
}

function normalizeFixture(raw, leagueName) {
  const gwId = detectGwId(raw);
  if (!gwId) return null;

  const dateStr = raw.date;
  if (!dateStr) return null;

  const home = raw.team1;
  const away = raw.team2;
  if (!home || !away) return null;

  const hasTime = raw.time && String(raw.time).trim();
  const timeStr = hasTime ? String(raw.time).trim() : null;

  const kickoff = parseKickoffUK(dateStr, timeStr);
  if (!kickoff) return null;

  return {
    gwId,
    league: leagueName,
    kickoff,
    home: String(home),
    away: String(away),
    homeScore: Number.isInteger(raw.homeScore) ? raw.homeScore : null,
    awayScore: Number.isInteger(raw.awayScore) ? raw.awayScore : null,
    resultStatus: String(raw.resultStatus || "pending").trim().toLowerCase()
  };
}

function formatFixtureResultDisplay_(fixture) {
  if (!fixture) return "";

  const hasScore =
    Number.isInteger(fixture.homeScore) &&
    Number.isInteger(fixture.awayScore);

  if (!hasScore) return "";

  let suffix = "";
  if (fixture.resultStatus === "aet") suffix = " AET";
  else if (fixture.resultStatus === "pens") suffix = " PENS";
  else if (String(fixture.resultStatus || "").startsWith("pens ")) {
    suffix = ` PENS ${String(fixture.resultStatus).slice(5)}`;
  }

  return `${fixture.homeScore}-${fixture.awayScore}${suffix}`;
}

async function loadAdminFixtures_() {
  const loaded = [];

  const game = getSelectedGame_();

  for (const source of FIXTURE_SOURCES) {
    if (!adminGameIncludesLeague_(source.league, game)) continue;

    try {
      const res = await fetch(source.url, { cache: "no-store" });
      if (!res.ok) continue;

      const data = await res.json();
      const arr = Array.isArray(data.matches) ? data.matches : [];

      for (const item of arr) {
        const f = normalizeFixture(item, source.league);
        if (f) loaded.push(f);
      }
    } catch {
      // ignore individual source failure
    }
  }

  adminFixtures = loaded.sort((a, b) => a.kickoff - b.kickoff);
}

function getSelectedGame_() {
  return (adminGames || []).find(g => String(g.id || "") === String(selectedGameId || "")) || null;
}

function getActualGwIdForSelectedGame_(displayGwId) {
  const game = getSelectedGame_();
  const startGw = String(game?.startGw || "GW1").toUpperCase();

  const startNum = gwNum(startGw);
  const displayNum = gwNum(displayGwId);

  if (!startNum || !displayNum) return String(displayGwId || "").toUpperCase();

  return `GW${startNum + displayNum - 1}`;
}

function findFixtureForPick_(gwId, team) {
  const pickKey = normTeamKey_(team);
  const actualGwKey = getActualGwIdForSelectedGame_(gwId);

  return (adminFixtures || []).find(f => {
    if (String(f.gwId || "").toUpperCase() !== actualGwKey) return false;
    return normTeamKey_(f.home) === pickKey || normTeamKey_(f.away) === pickKey;
  }) || null;
}

function formatAdminFixtureDay_(d) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).formatToParts(d);

  const weekday = parts.find(p => p.type === "weekday")?.value || "";
  const dayNum = Number(parts.find(p => p.type === "day")?.value || "0");
  const month = parts.find(p => p.type === "month")?.value || "";

  const suffix =
    (dayNum % 100 >= 11 && dayNum % 100 <= 13) ? "th" :
      (dayNum % 10 === 1) ? "st" :
        (dayNum % 10 === 2) ? "nd" :
          (dayNum % 10 === 3) ? "rd" : "th";

  return `${weekday} ${dayNum}${suffix} ${month}`;
}

function formatAdminFixtureMeta_(d) {
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(d);

  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(d).toLowerCase();

  return `(${datePart}) - ${timePart}`;
}

function fixtureDayKey_(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString();
}


function gwNum(gwId) {
  const m = String(gwId || "").match(/^GW(\d+)$/i);
  return m ? Number(m[1]) : -1;
}

async function loadGwListFromDeadlines() {
  const res = await fetch("../site/data/gameweek-deadlines.json", { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  const gwIds = (data.deadlines || [])
    .map(d => String(d.gwId || "").trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(gwIds));
}

function makeSubKey(row, gwIdFallback) {
  const gw = String(gwIdFallback || row.gwId || "").trim().toUpperCase();
  const email = String(row.email || "").trim().toLowerCase();
  return `${selectedGameId}::${gw}::${email}`;
}


function applyOutcomeStyles(rowEl, outcome) {
  rowEl.classList.remove("row-win", "row-loss");
  if (outcome === "WIN") rowEl.classList.add("row-win");
  if (outcome === "LOSS") rowEl.classList.add("row-loss");
}

function fixtureSortKey(f) {
  return `${f.date || ""}T${String(f.time || "99:99")}`;
}


function isResolved(outcome) {
  const o = String(outcome || "PENDING").toUpperCase();
  return o === "WIN" || o === "LOSS";
}

function formatFixtureDateDisplay(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-");
  if (!y || !m || !d) return String(dateStr);
  return `${d}/${m}/${String(y).slice(-2)}`;
}

function formatFixtureDateTimeDisplay(dateStr, timeStr) {
  const d = formatFixtureDateDisplay(dateStr);
  return [d, timeStr].filter(Boolean).join(" ");
}

function formatAdminDateShort_(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr || "Unknown date";

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "Europe/London"
  }).format(d);
}



function getLeaguePickCount_(league) {
  let total = 0;

  for (const fx of league.fixtures || []) {
    const counts = getAdminFixturePickCounts_(fx);
    if (!counts) continue;

    total += Number(counts.home?.count || 0);
    total += Number(counts.away?.count || 0);
  }

  return total;
}

function renderLeaguePickBadge_(league) {
  const total = getLeaguePickCount_(league);
  if (!total) return "";

  return `
    <span
      class="pick-badge pick-badge-pending"
      title="${escapeHtml(`${total} total pick${total === 1 ? "" : "s"} in this league`)}"
      aria-label="${escapeHtml(`${total} total pick${total === 1 ? "" : "s"} in this league`)}"
    >
      ${total}
    </span>
  `;
}

function getFixturePickCountKey_(gwId, homeTeam, awayTeam) {
  return [
    String(gwId || "").trim().toUpperCase(),
    normTeamKey_(homeTeam),
    normTeamKey_(awayTeam)
  ].join("::");
}

function buildAdminPickCounts_(rows) {
  const counts = new Map();

  for (const row of rows || []) {
    const fixture = findFixtureForPick_(row.gwId, row.pick);
    if (!fixture) continue;

    const fixtureKey = getFixturePickCountKey_(fixture.gwId, fixture.home, fixture.away);
    const pickKey = normTeamKey_(row.pick);

    if (!counts.has(fixtureKey)) {
      counts.set(fixtureKey, {
        home: {
          team: fixture.home,
          count: 0,
          pending: 0,
          win: 0,
          loss: 0
        },
        away: {
          team: fixture.away,
          count: 0,
          pending: 0,
          win: 0,
          loss: 0
        }
      });
    }

    const bucket = counts.get(fixtureKey);
    const target =
      normTeamKey_(fixture.home) === pickKey ? bucket.home :
        normTeamKey_(fixture.away) === pickKey ? bucket.away :
          null;

    if (!target) continue;

    target.count += 1;

    const outcome = String(row.outcome || "PENDING").trim().toUpperCase();
    if (outcome === "WIN") target.win += 1;
    else if (outcome === "LOSS") target.loss += 1;
    else target.pending += 1;
  }

  return counts;
}

function getAdminFixturePickCounts_(fx) {
  const key = getFixturePickCountKey_(fx.gwId, fx.team1, fx.team2);
  return adminPickCountsByFixture.get(key) || null;
}

function getPickBadgeClass_(sideStats) {
  if (!sideStats || !sideStats.count) return "pick-badge pick-badge-none";
  if (sideStats.pending > 0) return "pick-badge pick-badge-pending";
  if (sideStats.win > 0) return "pick-badge pick-badge-win";
  if (sideStats.loss > 0) return "pick-badge pick-badge-loss";
  return "pick-badge pick-badge-none";
}

function renderPickBadge_(sideStats, fx, side) {
  if (!sideStats || !sideStats.count) return "";

  const title =
    sideStats.pending > 0
      ? `${sideStats.count} pick${sideStats.count === 1 ? "" : "s"} pending`
      : sideStats.win > 0
        ? `${sideStats.count} pick${sideStats.count === 1 ? "" : "s"} won`
        : `${sideStats.count} pick${sideStats.count === 1 ? "" : "s"} lost`;

  return `
    <button
      type="button"
      class="${getPickBadgeClass_(sideStats)} admin-pick-badge-btn"
      data-pick-badge="1"
      data-gw-id="${escapeHtml(fx.gwId || "")}"
      data-home="${escapeHtml(fx.team1 || "")}"
      data-away="${escapeHtml(fx.team2 || "")}"
      data-side="${escapeHtml(side || "")}"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
      style="
        width:22px;
        height:22px;
        min-width:22px;
        border-radius:999px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:0;
      "
    >
      ${sideStats.count}
    </button>
  `;
}

function getRowsForFixtureSide_(gwId, homeTeam, awayTeam, side) {
  const wantedGw = String(gwId || "").trim().toUpperCase();
  const wantedHome = normTeamKey_(homeTeam);
  const wantedAway = normTeamKey_(awayTeam);
  const wantedSide = String(side || "").trim().toLowerCase();

  const rows = (window.__adminSubmissionRows || []).filter(row => {
    const fixture = row.fixture;
    if (!fixture) return false;

    const sameGw = String(fixture.gwId || "").trim().toUpperCase() === wantedGw;
    const sameHome = normTeamKey_(fixture.home) === wantedHome;
    const sameAway = normTeamKey_(fixture.away) === wantedAway;

    if (!sameGw || !sameHome || !sameAway) return false;

    const pickedHome = normTeamKey_(row.pick) === wantedHome;
    const pickedAway = normTeamKey_(row.pick) === wantedAway;

    return wantedSide === "home" ? pickedHome : pickedAway;
  });

  return rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function openPickBadgeModal_(gwId, homeTeam, awayTeam, side) {
  const rows = getRowsForFixtureSide_(gwId, homeTeam, awayTeam, side);
  const pickedTeam = side === "home" ? homeTeam : awayTeam;

  openBulkResolveModal({
    title: `${pickedTeam} picks`,
    html: rows.length
      ? `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${rows.map(row => `
            <div style="padding:10px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
              <div style="font-weight:700;">${escapeHtml(row.name || "")}</div>
              <div class="muted small">${escapeHtml(row.gwId || "")} • ${escapeHtml(row.pick || "")}</div>
            </div>
          `).join("")}
        </div>
      `
      : `<div class="muted">No picks found.</div>`,
    onConfirm: async () => { }
  });

  if (bulkResolveConfirmBtn) bulkResolveConfirmBtn.textContent = "Close";
  if (bulkResolveCancelBtn) bulkResolveCancelBtn.classList.add("hidden");
}

function bindPickBadgeEvents_() {
  document.querySelectorAll('[data-pick-badge="1"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      openPickBadgeModal_(
        btn.getAttribute("data-gw-id") || "",
        btn.getAttribute("data-home") || "",
        btn.getAttribute("data-away") || "",
        btn.getAttribute("data-side") || ""
      );
    });
  });
}

function getDayAddToggleState_(day) {
  const changeFixtures = [];

  for (const league of day.leagues || []) {
    for (const fx of league.fixtures || []) {
      const edit = fixtureEdits.get(fx.fixtureId) || {};

      const isScanChange =
        fx.status === "scraped-only" ||
        fx.status === "updated" ||
        fx.status === "removed";

      const isManualRemove =
        fx.status === "existing" && edit.remove === true;

      if (isScanChange || isManualRemove) {
        changeFixtures.push(fx);
      }
    }
  }

  if (!changeFixtures.length) {
    return { show: false, checked: false, total: 0 };
  }

  const checkedCount = changeFixtures.filter(fx => {
    const edit = fixtureEdits.get(fx.fixtureId) || {};

    if (fx.status === "scraped-only") return edit.include !== false;
    if (fx.status === "updated") return edit.applyUpdate !== false && edit.remove !== true;
    if (fx.status === "removed") return edit.remove !== false;
    if (fx.status === "existing") return edit.remove === true;

    return false;
  }).length;

  return {
    show: true,
    checked: checkedCount === changeFixtures.length,
    total: changeFixtures.length
  };
}

function bindDayToggleEvents_() {
  document.querySelectorAll(".day-include-toggle").forEach(cb => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      e.stopPropagation();

      const dayKey = cb.getAttribute("data-day-key");
      if (!dayKey) return;

      const states = captureOpenLeagueStates_();

      for (const gw of adminFixtureGameweeks || []) {
        if (String(gw.gwId) !== String(adminFixtureSelectedGw)) continue;

        for (const day of gw.days || []) {
          if (String(day.dayKey) !== String(dayKey)) continue;

          for (const league of day.leagues || []) {
            for (const fx of league.fixtures || []) {
              const current = fixtureEdits.get(fx.fixtureId) || {};

              if (fx.status === "scraped-only") {
                current.include = cb.checked;
              } else if (fx.status === "updated") {
                current.applyUpdate = cb.checked;
                if (cb.checked) current.remove = false;
              } else if (fx.status === "removed") {
                current.remove = cb.checked;
              } else if (fx.status === "existing" && current.remove === true) {
                current.remove = cb.checked;
              } else {
                continue;
              }

              fixtureEdits.set(fx.fixtureId, current);
            }
          }
        }
      }

      renderAdminFixturesTabView_();
      restoreOpenLeagueStates_(states);
      updateCommitVisibility_();
    });
  });
}

function formatResultStatusLabel_(status) {
  const s = String(status || "").trim().toLowerCase();

  if (!s || s === "final") return "FT";
  if (s === "aet") return "AET";
  if (s.startsWith("pens ")) return `PENS ${s.slice(5)}`;

  return s.toUpperCase();
}

function renderFixtureMiddleBox_(fx) {
  if (Number.isInteger(fx.homeScore) && Number.isInteger(fx.awayScore)) {
    return `<span class="score-box" style="display:inline-flex;align-items:center;justify-content:center;min-width:45px;height:28px;">${fx.homeScore}-${fx.awayScore}</span>`;
  }

  return `<span class="score-box" style="display:inline-flex;align-items:center;justify-content:center;min-width:45px;height:28px;">${escapeHtml(String(fx.time || "").trim() || "TBD")}</span>`;
}

function renderFixtureEditorRow_(fx) {
  const edit = fixtureEdits.get(fx.fixtureId) || {};
  const isScrapedOnly = fx.status === "scraped-only";
  const isUpdated = fx.status === "updated";

  const hasScore =
    Number.isInteger(fx.homeScore) &&
    Number.isInteger(fx.awayScore);

  const isLocked = isFixtureLocked_(fx);
  const allowRemoveButton = !isLocked;
  const showRemoveButton = allowRemoveButton && !isScrapedOnly && !isUpdated;

  const isRemoved = allowRemoveButton && (fx.status === "removed" || edit.remove === true);

  const isIncluded = isScrapedOnly
    ? edit.include !== false
    : !isRemoved;

  const leftLogo = getTeamLogo_(fx.team1);
  const rightLogo = getTeamLogo_(fx.team2);

  const pickCounts = getAdminFixturePickCounts_(fx);
  const homePickStats = pickCounts?.home || null;
  const awayPickStats = pickCounts?.away || null;

  let changeLine = "";
  if (fx.change?.type === "update") {
    const beforeLine = formatFixtureDateTimeDisplay(fx.change.beforeDate, fx.change.beforeTime);
    const afterLine = formatFixtureDateTimeDisplay(fx.change.afterDate, fx.change.afterTime);

    changeLine = `
      <div class="fixture-change-line" style="margin-top:6px;">
        <span>${escapeHtml(beforeLine)}</span>
        <span class="fixture-change-arrow">→</span>
        <span class="fixture-change-new">${escapeHtml(afterLine)}</span>
      </div>
    `;
  }

  const statusLine = `
    ${fx.status === "scraped-only" ? `<div class="fixture-status fixture-status-add">New fixture found in scan</div>` : ""}
    ${fx.status === "updated" ? `<div class="fixture-status fixture-status-update">Fixture details changed</div>` : ""}
    ${isRemoved ? `<div class="fixture-status fixture-status-remove">Fixture will be removed</div>` : ""}
  `;

  let actionHtml = "";

  if (isScrapedOnly) {
    actionHtml = `
      <label style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;cursor:pointer;">
        <input
          type="checkbox"
          class="fixture-include-toggle"
          data-fixture-id="${escapeHtml(fx.fixtureId)}"
          ${edit.include !== false ? "checked" : ""}
        >
      </label>
    `;
  } else if (isUpdated) {
    actionHtml = `
      <label style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;cursor:pointer;">
        <input
          type="checkbox"
          class="fixture-update-toggle"
          data-fixture-id="${escapeHtml(fx.fixtureId)}"
          ${edit.applyUpdate !== false ? "checked" : ""}
        >
      </label>
    `;
  } else if (showRemoveButton) {
    actionHtml = `
      <button
        class="fixture-remove-btn"
        type="button"
        data-fixture-id="${escapeHtml(fx.fixtureId)}"
        style="
          width:28px;
          height:28px;
          border:none;
          border-radius:999px;
          background:rgba(255,255,255,0.08);
          color:#fff;
          font-size:18px;
          line-height:1;
          display:flex;
          align-items:center;
          justify-content:center;
          cursor:pointer;
        "
      >
        ${edit.remove ? "↺" : "−"}
      </button>
    `;
  }

  return `
    <div
      class="fixture-row ${isRemoved ? "is-removed" : ""} ${!isIncluded ? "is-faded" : ""}"
      data-fixture-id="${escapeHtml(fx.fixtureId)}"
      style="position:relative;"
    >
      <div style="width:100%;min-width:0;">
        <div class="fixture-row-main" style="min-width:0;">

          <div
            class="fixture-teams"
            style="
              display:grid;
              grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
              align-items:center;
              gap:10px;
              width:100%;
              min-width:0;
            "
          >
            <div
              style="
                position:relative;
                display:grid;
                grid-template-columns:minmax(0,1fr) 22px;
                align-items:center;
                gap:8px;
                min-width:0;
                text-align:right;
                padding-left:${homePickStats ? "30px" : "0"};
              "
            >
              ${homePickStats ? `
                <div
                  style="
                    position:absolute;
                    left:0;
                    top:50%;
                    transform:translateY(-50%);
                    width:22px;
                    height:22px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    z-index:2;
                  "
                >
                  ${renderPickBadge_(homePickStats, fx, "home")}
                </div>
              ` : ""}

              <div
                class="team-name"
                style="
                  min-width:0;
                  line-height:1.15;
                  text-align:right;
                  white-space:normal;
                  word-break:normal;
                  overflow-wrap:normal;
                "
              >
                ${escapeHtml(fx.team1)}
              </div>

              <img
                src="${escapeHtml(leftLogo)}"
                alt="${escapeHtml(fx.team1)}"
                class="team-logo"
                style="display:block;width:22px;height:22px;object-fit:contain;"
                onerror="this.onerror=null;this.src='../site/images/team-default.png';"
              />
            </div>

            <div style="display:flex;justify-content:center;align-items:center;">
              ${renderFixtureMiddleBox_(fx)}
            </div>

            <div
              style="
                position:relative;
                display:grid;
                grid-template-columns:22px minmax(0,1fr);
                align-items:center;
                gap:8px;
                min-width:0;
                text-align:left;
                padding-right:${awayPickStats ? "30px" : "0"};
              "
            >
              <img
                src="${escapeHtml(rightLogo)}"
                alt="${escapeHtml(fx.team2)}"
                class="team-logo"
                style="display:block;width:22px;height:22px;object-fit:contain;"
                onerror="this.onerror=null;this.src='../site/images/team-default.png';"
              />

              <div
                class="team-name"
                style="
                  min-width:0;
                  line-height:1.15;
                  text-align:left;
                  white-space:normal;
                  word-break:normal;
                  overflow-wrap:normal;
                "
              >
                ${escapeHtml(fx.team2)}
              </div>

              ${awayPickStats ? `
                <div
                  style="
                    position:absolute;
                    right:0;
                    top:50%;
                    transform:translateY(-50%);
                    width:22px;
                    height:22px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    z-index:2;
                  "
                >
                  ${renderPickBadge_(awayPickStats, fx, "away")}
                </div>
              ` : ""}
            </div>
          </div>

          <div class="fixture-datetime muted" style="text-align:center;margin-top:4px;line-height:1.1;">
            ${hasScore ? formatResultStatusLabel_(fx.resultStatus) : ""}
          </div>

          ${changeLine}
        </div>
      </div>

      ${actionHtml ? `
        <div style="position:absolute;top:12px;right:12px;z-index:2;">
          ${actionHtml}
        </div>
      ` : ""}

      ${statusLine}
    </div>
  `;
}

function getDisplayGwIdForSelectedGame_(actualGwId) {
  const game = getSelectedGame_();
  const startGw = String(game?.startGw || "GW1").toUpperCase();

  const startNum = gwNum(startGw);
  const actualNum = gwNum(actualGwId);

  if (startNum < 1 || actualNum < 1) return String(actualGwId || "").toUpperCase();

  return `GW${actualNum - startNum + 1}`;
}

function getCurrentDisplayGwFromFixtures_(gameweeks) {
  const now = Date.now();
  const game = getSelectedGame_();
  const startGw = String(game?.startGw || "GW1").toUpperCase();
  const startNum = gwNum(startGw);

  const candidates = (gameweeks || [])
    .filter(gw => gwNum(gw.gwId) >= startNum)
    .map(gw => {
      const dayKeys = (gw.days || [])
        .map(d => String(d.dayKey || ""))
        .filter(Boolean)
        .sort();

      const firstDay = dayKeys[0] ? new Date(`${dayKeys[0]}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
      const lastDay = dayKeys.length
        ? new Date(`${dayKeys[dayKeys.length - 1]}T23:59:59`).getTime()
        : Number.MAX_SAFE_INTEGER;

      return { gw, firstDay, lastDay };
    })
    .sort((a, b) => gwNum(a.gw.gwId) - gwNum(b.gw.gwId));

  const liveOrUpcoming = candidates.find(x => x.lastDay >= now);
  if (liveOrUpcoming) {
    return getDisplayGwIdForSelectedGame_(liveOrUpcoming.gw.gwId);
  }

  if (candidates.length) {
    return getDisplayGwIdForSelectedGame_(candidates[candidates.length - 1].gw.gwId);
  }

  return "GW1";
}

async function loadGroupedFixturesView() {
  if (!adminFixturesList) return;

  adminFixturesList.innerHTML = `<div class="muted">Loading fixtures…</div>`;
  fixtureEdits.clear();

  let data;
  let usedFallback = false;

  try {
    const leagueKeys = getAdminLeagueKeysForSelectedGame_();

    data = await fixtureApi("/fixtures/editor-view", {
      adminKey,
      league: leagueKeys.length === 1 ? leagueKeys[0] : "all",
      allowedLeagueKeys: leagueKeys,
      useTestFiles: false
    });

    fixtureAdminServerAvailable = true;
  } catch (err) {
    console.warn("Fixture admin server unavailable, using JSON fallback view.", err);
    data = await loadGroupedFixturesViewFallback_();
    usedFallback = true;
    fixtureAdminServerAvailable = false;
  }

  fixtureEditorData = data;

  const rawGameweeks = Array.isArray(data.gameweeks) ? data.gameweeks : [];

  adminFixtureGameweeks = rawGameweeks
    .map(gw => ({
      ...gw,
      actualGwId: gw.gwId,
      gwId: getDisplayGwIdForSelectedGame_(gw.gwId),
      displayGwId: getDisplayGwIdForSelectedGame_(gw.gwId),
    }))
    .filter(gw => gwNum(gw.gwId) >= 1);

  if (adminFixtureGameweeks.length) {
    adminFixtureSelectedGw = getCurrentDisplayGwFromFixtures_(rawGameweeks);
  } else {
    adminFixtureSelectedGw = "ALL";
  }

  adminFixtureSelectedDay = "ALL";

  populateAdminFixtureFilters_();
  renderAdminFixturesTabView_();
  setFixtureScanDatesFromSelectedGw_();
  await updateFixtureDeadlineInfo_();

  if (fixturesMeta) {
    const baseText = `Showing ${adminFixtureSelectedGw} fixtures for ${getSelectedGame_()?.title || selectedGameId}.`;
    fixturesMeta.textContent = usedFallback
      ? `${baseText} View-only mode. Start fixture-admin-server.js to scan or commit changes.`
      : baseText;
  }
  updateFixtureServerDependentButtons_();
  updateCommitVisibility_();
}


function fixtureStatusClasses_(fx) {
  const edit = fixtureEdits.get(fx.fixtureId) || {};

  const isScrapedOnly = fx.status === "scraped-only";
  const isRemoved = edit.remove === true;
  const isIncluded = isScrapedOnly ? !!edit.include : !isRemoved;

  return [
    "admin-edit-fixture",
    isIncluded ? "is-included" : "is-faded",
    fx.status === "updated" ? "is-updated" : "",
    fx.status === "removed" ? "is-marked-remove" : "",
  ].filter(Boolean).join(" ");
}

async function commitFixtureSync() {
  const selectedOperationIdsByFile = {};
  const manualRemoveFixtureIdsByFile = {};

  const selectedGwObj =
    adminFixtureSelectedGw === "ALL"
      ? null
      : (adminFixtureGameweeks || []).find(
        gw => String(gw.gwId) === String(adminFixtureSelectedGw)
      ) || null;

  const gwsToProcess = selectedGwObj ? [selectedGwObj] : [];

  for (const gw of gwsToProcess) {
    for (const day of gw.days || []) {
      for (const league of day.leagues || []) {
        for (const fx of league.fixtures || []) {
          const edit = fixtureEdits.get(fx.fixtureId) || {};

          if (fx.status === "scraped-only" && edit.include !== false) {
            if (!selectedOperationIdsByFile[fx.file]) selectedOperationIdsByFile[fx.file] = [];
            selectedOperationIdsByFile[fx.file].push(
              fx.change?.operationId ||
              `${fx.file}::add::${fx.date}::${normalizeFixtureOpTeam_(fx.team1)}::${normalizeFixtureOpTeam_(fx.team2)}`
            );
          }

          if (fx.status === "updated" && edit.applyUpdate !== false) {
            if (!selectedOperationIdsByFile[fx.file]) selectedOperationIdsByFile[fx.file] = [];
            selectedOperationIdsByFile[fx.file].push(
              fx.change?.operationId ||
              `${fx.file}::update::${fx.date}::${normalizeFixtureOpTeam_(fx.team1)}::${normalizeFixtureOpTeam_(fx.team2)}`
            );
          }

          if (
            (fx.status === "removed" && edit.remove !== false) ||
            (fx.status !== "scraped-only" && !!edit.remove)
          ) {
            if (!manualRemoveFixtureIdsByFile[fx.file]) manualRemoveFixtureIdsByFile[fx.file] = [];
            manualRemoveFixtureIdsByFile[fx.file].push(fx.fixtureId);
          }
        }
      }
    }
  }

  console.log("COMMIT selectedOperationIdsByFile", selectedOperationIdsByFile);
  console.log("COMMIT manualRemoveFixtureIdsByFile", manualRemoveFixtureIdsByFile);

  setBtnLoading(commitFixturesBtn, true);
  if (fixturesMeta) fixturesMeta.textContent = "Applying fixture changes…";

  try {
    const from = fixtureScanFromDate?.value || "";
    const to = fixtureScanToDate?.value || "";

    if (!from || !to) {
      throw new Error("Choose both commit dates.");
    }

    const leagueKeys = getAdminLeagueKeysForSelectedGame_();

    const data = await fixtureApi("/commit", {
      adminKey,
      league: leagueKeys.length === 1 ? leagueKeys[0] : "all",
      allowedLeagueKeys: leagueKeys,
      from,
      to,
      actualGwId: selectedGwObj?.actualGwId || null,
      selectedOperationIdsByFile,
      manualRemoveFixtureIdsByFile,
      useTestFiles: false
    });

    fixtureEdits.clear();
    await loadGroupedFixturesView();
    await updateFixtureDeadlineInfo_();

    if (fixturesMeta) fixturesMeta.textContent = "Fixture changes applied.";

    const lines = [];

    for (const r of data.results || []) {
      const changes = [];

      if ((r.updated || []).length) {
        changes.push(`${r.updated.length} date/time change${r.updated.length > 1 ? "s" : ""}`);
      }

      if ((r.added || []).length) {
        changes.push(`${r.added.length} added`);
      }

      if ((r.removed || []).length) {
        changes.push(`${r.removed.length} removed`);
      }

      if (changes.length) {
        lines.push(`${r.label}: ${changes.join(", ")}`);
      }
    }

    openBulkResolveModal({
      title: "Fixture changes applied",
      html: `<div style="line-height:1.6;">${lines.map(line => `<div>${escapeHtml(line)}</div>`).join("")}</div>`,
      onConfirm: async () => { }
    });

    const confirmBtn = document.getElementById("bulkResolveConfirmBtn");
    const cancelBtn = document.getElementById("bulkResolveCancelBtn");
    if (confirmBtn) confirmBtn.textContent = "OK";
    if (cancelBtn) cancelBtn.classList.add("hidden");

    showMsg("Fixture changes committed.", true);
  } catch (e) {
    if (fixturesMeta) fixturesMeta.textContent = "Commit failed.";
    showMsg(String(e.message || e), false);
  } finally {
    setBtnLoading(commitFixturesBtn, false);
  }
}

async function setPickOutcomeDirect_(row, newOutcome) {
  return api({
    action: "adminSetPickOutcome",
    adminKey,
    email: row.email,
    gameId: selectedGameId,
    gwId: row.gwId,
    outcome: newOutcome
  });
}

/*******************************
 * Submissions load
 *******************************/
function getPendingFixtureGroupKey_(row) {
  const gw = String(row.gwId || "").toUpperCase();
  const pick = normTeamKey_(row.pick || "");
  const fixture = row.fixture
    ? `${normTeamKey_(row.fixture.home)}__${normTeamKey_(row.fixture.away)}`
    : "fixture_not_found";

  return `${gw}::${pick}::${fixture}`;
}

function captureOpenLeagueStates_() {
  return Array.from(document.querySelectorAll(".league-details")).map((el, idx) => ({
    idx,
    open: el.open
  }));
}

function restoreOpenLeagueStates_(states) {
  if (!Array.isArray(states)) return;

  const details = Array.from(document.querySelectorAll(".league-details"));
  states.forEach(state => {
    if (details[state.idx]) {
      details[state.idx].open = state.open;
    }
  });
}

function formatSubmissionMetaLine_(fixture) {
  if (!fixture?.kickoff) return "";

  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(fixture.kickoff);

  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(fixture.kickoff);

  return `${datePart} ${timePart}`;
}

function getPendingStatusText_(fixture) {
  if (!fixture) {
    return {
      top: "Fixture not found",
      bottom: "Check fixture data"
    };
  }

  const hasScore =
    Number.isInteger(fixture.homeScore) &&
    Number.isInteger(fixture.awayScore);

  if (!hasScore) {
    return {
      top: "Awaiting result",
      bottom: "Not ready yet"
    };
  }

  return {
    top: formatFixtureResultDisplay_(fixture),
    bottom: "Waiting for auto-resolve"
  };
}

function renderPendingFixtureBlock_(rows) {
  const first = rows[0];
  const fixture = first?.fixture || null;

  const wrap = document.createElement("div");
  wrap.className = "fixtures-card";
  wrap.style.marginBottom = "10px";
  wrap.setAttribute("data-fixture-group-key", getPendingFixtureGroupKey_(first));

  const pickedTeam = String(first?.pick || "").trim();
  const pickedTeamKey = normTeamKey_(pickedTeam);

  let opponent = "Opponent unknown";
  let dateTimeLine = "";
  const status = getPendingStatusText_(fixture);

  if (fixture) {
    const isHomePick = normTeamKey_(fixture.home) === pickedTeamKey;
    const isAwayPick = normTeamKey_(fixture.away) === pickedTeamKey;

    if (isHomePick) opponent = fixture.away;
    else if (isAwayPick) opponent = fixture.home;

    dateTimeLine = formatSubmissionMetaLine_(fixture);
  }

  wrap.innerHTML = `
    <div class="admin-fixture-resolve-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <img
            src="${escapeHtml(getTeamLogo_(pickedTeam))}"
            alt="${escapeHtml(pickedTeam)} logo"
            style="width:22px;height:22px;object-fit:contain;flex:0 0 auto;"
            onerror="this.onerror=null;this.src='../site/images/team-default.png';"
          />
          <div style="font-weight:800;line-height:1.15;min-width:0;">
            ${escapeHtml(pickedTeam || "Unknown team")}
          </div>
        </div>

        <div class="muted" style="margin-top:6px;">
          vs ${escapeHtml(opponent)}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;gap:4px;flex:0 0 auto;">
        <div class="muted small" style="white-space:nowrap;">
          ${escapeHtml(dateTimeLine)}
        </div>
        <div style="font-weight:800;white-space:nowrap;">
          ${escapeHtml(status.top)}
        </div>
        <div class="muted small" style="white-space:nowrap;">
          ${escapeHtml(status.bottom)}
        </div>
      </div>
    </div>
  `;

  const playersList = document.createElement("div");
  playersList.className = "list";
  playersList.style.marginTop = "10px";

  rows.forEach(row => {
    const playerRow = document.createElement("div");
    playerRow.className = "list-item";
    playerRow.style.padding = "10px 12px";
    playerRow.style.minHeight = "unset";

    playerRow.innerHTML = `
      <div class="list-left">
        <div class="list-title" style="font-weight:700;">
          ${escapeHtml(row.name || "")} - ${escapeHtml(row.gwId || "")}
        </div>
      </div>
    `;

    playersList.appendChild(playerRow);

    const key = makeSubKey(row, row.gwId);
    seenSubs.set(key, {
      outcome: String(row.outcome || "PENDING").toUpperCase(),
      el: playerRow,
      gwId: row.gwId,
      isResolved: false,
      rowData: row
    });
  });

  wrap.appendChild(playersList);
  return wrap;
}

function buildRecentActivityGroups_(rows) {
  const groups = new Map();

  for (const row of rows) {
    const fixture = row.fixture || null;
    const outcome = String(row.outcome || "").toUpperCase();

    const key = fixture
      ? `${String(row.gwId || "").toUpperCase()}::${normTeamKey_(fixture.home)}::${normTeamKey_(fixture.away)}::${outcome}`
      : `${String(row.gwId || "").toUpperCase()}::${normTeamKey_(row.pick || "")}::no_fixture::${outcome}`;

    if (!groups.has(key)) {
      groups.set(key, {
        gwId: row.gwId,
        outcome,
        fixture,
        rows: []
      });
    }

    groups.get(key).rows.push(row);
  }

  return Array.from(groups.values()).sort((a, b) => {
    const at = a.fixture?.kickoff ? a.fixture.kickoff.getTime() : 0;
    const bt = b.fixture?.kickoff ? b.fixture.kickoff.getTime() : 0;
    return bt - at;
  });
}

function renderRecentActivityCard_(group) {
  const firstRow = group.rows[0];
  const fixture = group.fixture;
  const count = group.rows.length;
  const outcome = String(group.outcome || "").toUpperCase();

  const wrap = document.createElement("div");
  wrap.className = `list-item admin-submission-row ${outcome === "WIN" ? "row-win" : "row-loss"}`;

  let title = "Resolved activity";
  let subtitle = "";
  let resultLine = "";
  let pickedTeam = "";

  if (fixture) {
    title = `${fixture.home} vs ${fixture.away}`;
    subtitle = formatSubmissionMetaLine_(fixture);
    resultLine = formatFixtureResultDisplay_(fixture);
    pickedTeam = firstRow.pick || "";
  } else {
    title = firstRow.pick || "Unknown team";
    subtitle = firstRow.gwId || "";
  }

  wrap.innerHTML = `
    <div class="admin-submission-main">
      <div class="admin-submission-head">
        <div class="admin-submission-name">
          ${escapeHtml(title)}
        </div>
        <div class="admin-controls">
          <button class="btn btn-ghost" data-unresolve-group="1" type="button">Unresolve</button>
        </div>
      </div>

      <div class="admin-submission-fixtureline">
        <span class="admin-submission-fixture">
          ${escapeHtml(`${count} pick${count === 1 ? "" : "s"} resolved • ${outcome}`)}
        </span>
        <span class="admin-submission-time">${escapeHtml(subtitle)}</span>
      </div>

      ${resultLine ? `
        <div class="admin-submission-fixtureline" style="margin-top:4px;">
          <span style="font-weight:800;">${escapeHtml(resultLine)}</span>
          ${pickedTeam ? `<span class="muted">• ${escapeHtml(pickedTeam)}</span>` : ``}
        </div>
      ` : ``}
    </div>
  `;

  const btn = wrap.querySelector('button[data-unresolve-group="1"]');
  if (btn) {
    btn.addEventListener("click", () => {
      openBulkResolveModal({
        title: "Confirm unresolve",
        html: `
          <p style="margin:0;line-height:1.5;">
            Are you sure you want to unresolve this fixture group?
          </p>
        `,
        onConfirm: async () => {
          try {
            setBtnLoading(btn, true);

            await Promise.all(
              group.rows.map(row => setPickOutcomeDirect_(row, "PENDING"))
            );

            await refreshSubmissionsIncremental({ full: true });
            showMsg(`${group.rows.length} pick(s) unresolved`, true);
          } catch (e) {
            showMsg(String(e.message || e), false);
          } finally {
            setBtnLoading(btn, false);
          }
        }
      });
    });
  }

  return wrap;
}

function clearFixtureEditsForSelectedGw_() {
  const selectedGw = (adminFixtureGameweeks || []).find(
    gw => String(gw.gwId) === String(adminFixtureSelectedGw)
  );
  if (!selectedGw) return;

  for (const day of selectedGw.days || []) {
    for (const league of day.leagues || []) {
      for (const fx of league.fixtures || []) {
        fixtureEdits.delete(fx.fixtureId);
      }
    }
  }
}

async function refreshSubmissionsIncremental({ full = false } = {}) {
  if (!subsContainer) return;

  if (!selectedGameId) {
    subsContainer.innerHTML = `<div class="muted">Select a game first.</div>`;
    if (subsMeta) subsMeta.textContent = "No game selected.";
    return;
  }

  hideMsg();
  if (subsMeta) subsMeta.textContent = "Refreshing…";
  setBtnLoading(refreshSubsBtn, true);

  try {
    if (full) {
      seenSubs.clear();
      subsContainer.innerHTML = `<div class="muted">Loading submissions…</div>`;
    }

    const data = await api({
      action: "adminGetAllPicks",
      adminKey,
      gameId: selectedGameId
    });

    const allRows = (Array.isArray(data.rows) ? data.rows : []).map(r => ({
      ...r,
      gameId: selectedGameId,
      gwId: String(r.gwId || "").trim().toUpperCase()
    }));

    const enriched = allRows.map(row => {
      const fixture = findFixtureForPick_(row.gwId, row.pick);
      return {
        ...row,
        fixture,
        kickoff: fixture?.kickoff || null,
        dayKey: fixture?.kickoff ? fixtureDayKey_(fixture.kickoff) : "unknown",
        dayLabel: fixture?.kickoff ? formatAdminFixtureDay_(fixture.kickoff) : "Fixture not found",
        resolved: isResolved(row.outcome)
      };
    });

    adminPickCountsByFixture = buildAdminPickCounts_(enriched);

    window.__adminSubmissionRows = enriched;

    const pendingRows = enriched
      .filter(r => !r.resolved)
      .sort((a, b) => {
        const at = a.kickoff ? a.kickoff.getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.kickoff ? b.kickoff.getTime() : Number.MAX_SAFE_INTEGER;
        if (at !== bt) return at - bt;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    const resolvedRows = enriched.filter(r => r.resolved);
    const recentActivityGroups = buildRecentActivityGroups_(resolvedRows);

    const pendingGrouped = new Map();
    for (const row of pendingRows) {
      if (!pendingGrouped.has(row.dayKey)) {
        pendingGrouped.set(row.dayKey, {
          label: row.dayLabel,
          rows: []
        });
      }
      pendingGrouped.get(row.dayKey).rows.push(row);
    }

    subsContainer.innerHTML = "";

    const pendingWrap = document.createElement("div");
    pendingWrap.className = "fixtures-card";
    pendingWrap.style.marginBottom = "12px";
    pendingWrap.id = "pendingSubmissionsWrap";

    const pendingTitle = document.createElement("h3");
    pendingTitle.style.marginTop = "0";
    pendingTitle.textContent = "Pending submissions";
    pendingWrap.appendChild(pendingTitle);

    if (!pendingGrouped.size) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No pending submissions.";
      pendingWrap.appendChild(empty);
    } else {
      for (const [, group] of pendingGrouped) {
        const dayGroup = document.createElement("div");
        dayGroup.setAttribute("data-pending-day-group", "1");

        const dayTitle = document.createElement("div");
        dayTitle.className = "muted small";
        dayTitle.style.margin = "14px 0 8px";
        dayTitle.innerHTML = `<strong>${escapeHtml(group.label)}</strong>`;
        dayGroup.appendChild(dayTitle);

        const fixtureGroups = new Map();

        for (const row of group.rows) {
          const key = getPendingFixtureGroupKey_(row);
          if (!fixtureGroups.has(key)) fixtureGroups.set(key, []);
          fixtureGroups.get(key).push(row);
        }

        for (const [, rows] of fixtureGroups) {
          dayGroup.appendChild(renderPendingFixtureBlock_(rows));
        }

        pendingWrap.appendChild(dayGroup);
      }
    }

    subsContainer.appendChild(pendingWrap);

    const activityWrap = document.createElement("div");
    activityWrap.className = "fixtures-card";

    const activityTitle = document.createElement("h3");
    activityTitle.style.marginTop = "0";
    activityTitle.textContent = "Recent activity";
    activityWrap.appendChild(activityTitle);

    if (!recentActivityGroups.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No recent activity.";
      activityWrap.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "list";
      list.id = "recentActivityList";

      recentActivityGroups.slice(0, 12).forEach(group => {
        list.appendChild(renderRecentActivityCard_(group));
      });

      activityWrap.appendChild(list);
    }

    subsContainer.appendChild(activityWrap);

    const pending = pendingRows.length;
    const game = adminGames.find(g => String(g.id) === String(selectedGameId));
    const gameLabel = game?.title || selectedGameId;

    if (subsPendingCount) subsPendingCount.textContent = `(${pending})`;
    if (subsResolvedCount) subsResolvedCount.textContent = "";
    if (subsMeta) {
      subsMeta.textContent = `${gameLabel} • Pending: ${pending}`;
    }
    if (!fixturesPanel?.classList.contains("hidden")) {
      renderAdminFixturesTabView_();
    }
  } catch (e) {
    console.error("refreshSubmissionsIncremental failed:", e);
    subsContainer.innerHTML = `<div class="muted">Failed to load submissions.</div>`;
    if (subsMeta) subsMeta.textContent = "Failed to load submissions.";
    showMsg(String(e.message || e), false);
  } finally {
    setBtnLoading(refreshSubsBtn, false);
  }
}

async function rescanFixturesForSelectedGw_(from, to) {
  const selectedGw = (adminFixtureGameweeks || []).find(
    gw => String(gw.gwId) === String(adminFixtureSelectedGw)
  );

  if (!selectedGw) {
    throw new Error("No gameweek selected.");
  }

  resetSelectedGwScanState_();
  clearFixtureEditsForSelectedGw_();
  renderAdminFixturesTabView_();
  updateCommitVisibility_();

  const actualGwId = selectedGw.actualGwId || getActualGwIdForSelectedGame_(selectedGw.gwId);

  const leagueKeys = getAdminLeagueKeysForSelectedGame_();

  const data = await fixtureApi("/fixtures/rescan-gw", {
    adminKey,
    actualGwId,
    from,
    to,
    league: leagueKeys.length === 1 ? leagueKeys[0] : "all",
    allowedLeagueKeys: leagueKeys,
    useTestFiles: false
  });

  const scannedFixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
  const scanByFixtureId = new Map(
    scannedFixtures.map(fx => [fx.fixtureId, fx])
  );

  adminFixtureGameweeks = adminFixtureGameweeks.map(gw => {
    if (String(gw.gwId) !== String(adminFixtureSelectedGw)) return gw;

    const updatedDays = (gw.days || []).map(day => {
      const updatedLeagues = (day.leagues || []).map(league => {
        const existingFixtures = (league.fixtures || []).map(fx => {
          const scanned = scanByFixtureId.get(fx.fixtureId);
          return scanned
            ? { ...fx, ...scanned, scanStatus: "scanned" }
            : fx;
        });

        const existingIds = new Set(existingFixtures.map(fx => fx.fixtureId));

        const addedFixtures = scannedFixtures.filter(fx =>
          fx.status === "scraped-only" &&
          String(fx.leagueKey) === String(league.leagueKey) &&
          String(fx.date) === String(day.dayKey) &&
          !existingIds.has(fx.fixtureId)
        );

        const mergedFixtures = [...existingFixtures, ...addedFixtures].sort((a, b) => {
          const dtDiff = fixtureSortKey(a).localeCompare(fixtureSortKey(b));
          if (dtDiff !== 0) return dtDiff;
          return `${a.team1} ${a.team2}`.localeCompare(`${b.team1} ${b.team2}`);
        });

        return {
          ...league,
          fixtures: mergedFixtures
        };
      });

      const leagueKeys = new Set(updatedLeagues.map(l => l.leagueKey));

      const newLeaguesFromScan = scannedFixtures
        .filter(fx =>
          fx.status === "scraped-only" &&
          String(fx.date) === String(day.dayKey) &&
          !leagueKeys.has(fx.leagueKey)
        )
        .reduce((acc, fx) => {
          if (!acc.has(fx.leagueKey)) {
            acc.set(fx.leagueKey, {
              leagueKey: fx.leagueKey,
              leagueLabel: fx.leagueLabel,
              fixtures: []
            });
          }
          acc.get(fx.leagueKey).fixtures.push(fx);
          return acc;
        }, new Map());

      const mergedLeagues = [
        ...updatedLeagues,
        ...Array.from(newLeaguesFromScan.values()).map(league => ({
          ...league,
          fixtures: league.fixtures.sort((a, b) => {
            const dtDiff = fixtureSortKey(a).localeCompare(fixtureSortKey(b));
            if (dtDiff !== 0) return dtDiff;
            return `${a.team1} ${a.team2}`.localeCompare(`${b.team1} ${b.team2}`);
          })
        }))
      ].sort(compareLeagueDisplayOrder_);

      return {
        ...day,
        leagues: mergedLeagues
      };
    });

    const existingDayKeys = new Set(updatedDays.map(d => d.dayKey));

    const newDaysFromScan = scannedFixtures
      .filter(fx => fx.status === "scraped-only" && !existingDayKeys.has(fx.date))
      .reduce((acc, fx) => {
        if (!acc.has(fx.date)) {
          acc.set(fx.date, {
            dayKey: fx.date,
            label: formatAdminFixtureDayLabel_(fx.date),
            leagues: []
          });
        }

        const day = acc.get(fx.date);
        let league = day.leagues.find(l => l.leagueKey === fx.leagueKey);
        if (!league) {
          league = {
            leagueKey: fx.leagueKey,
            leagueLabel: fx.leagueLabel,
            fixtures: []
          };
          day.leagues.push(league);
        }

        league.fixtures.push(fx);
        return acc;
      }, new Map());

    const mergedDays = [
      ...updatedDays,
      ...Array.from(newDaysFromScan.values()).map(day => ({
        ...day,
        leagues: day.leagues
          .map(league => ({
            ...league,
            fixtures: league.fixtures.sort((a, b) => {
              const dtDiff = fixtureSortKey(a).localeCompare(fixtureSortKey(b));
              if (dtDiff !== 0) return dtDiff;
              return `${a.team1} ${a.team2}`.localeCompare(`${b.team1} ${b.team2}`);
            })
          }))
          .sort((a, b) => a.leagueLabel.localeCompare(b.leagueLabel))
      }))
    ].sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey)));

    return {
      ...gw,
      days: mergedDays
    };
  });

  renderAdminFixturesTabView_();
  updateCommitVisibility_();
}


/*******************************
 * LOGIN / LOGOUT
 *******************************/
async function loginWithKey(key) {
  adminKey = key;
  showSplash(false);
  document.body.classList.remove("splashing");
  setBtnLoading(adminLoginBtn, true);

  try {
    await api({ action: "adminListUsers", adminKey });

    localStorage.setItem(LS_ADMIN_KEY, adminKey);

    seenSubs.clear();
    if (subsContainer) subsContainer.innerHTML = "";

    await loadTeamNameMapOnce_();
    await Promise.all([
      loadAdminGames(),
      loadAdminFixtures_(),
      loadTeamLogosOnce_()
    ]);

    enterPanel();
    await setTab("approvals");

    showMsg("Logged in.", true);
  } finally {
    setBtnLoading(adminLoginBtn, false);
    showSplash(false);
  }
}

function logout() {
  adminKey = "";
  selectedGameId = "";
  adminGames = [];
  localStorage.removeItem(LS_ADMIN_KEY);

  pendingList && (pendingList.innerHTML = "");
  approvedList && (approvedList.innerHTML = "");
  pendingCount && (pendingCount.textContent = "");
  approvedCount && (approvedCount.textContent = "");

  subsContainer && (subsContainer.innerHTML = "");
  subsMeta && (subsMeta.textContent = "");

  seenSubs.clear();

  exitPanel();
  showMsg("Logged out.", true);
}

/*******************************
 * Events
 *******************************/

adminGameSelect?.addEventListener("change", async () => {
  selectedGameId = adminGameSelect.value || "";
  seenSubs.clear();
  subsContainer && (subsContainer.innerHTML = "");

  try {
    await loadAdminFixtures_();
    await loadApprovals();

    if (!subsPanel?.classList.contains("hidden")) {
      await refreshSubmissionsIncremental({ full: true });
    }

    if (!fixturesPanel?.classList.contains("hidden")) {
      await loadGroupedFixturesView();
    }
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

refreshFixturesBtn?.addEventListener("click", async () => {
  try {
    const from = fixtureScanFromDate?.value || "";
    const to = fixtureScanToDate?.value || "";

    if (!from || !to) {
      showMsg("Choose both scan dates.", false);
      return;
    }

    setBtnLoading(refreshFixturesBtn, true);

    await rescanFixturesForSelectedGw_(from, to);
    showMsg(`Rescanned ${adminFixtureSelectedGw} fixtures.`, true);
  } catch (e) {
    showMsg(String(e.message || e), false);
  } finally {
    setBtnLoading(refreshFixturesBtn, false);
  }
});

commitFixturesBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  openBulkResolveModal({
    title: "Confirm fixture update",
    html: `<p style="margin:0;line-height:1.5;">Apply these fixture changes now?</p>`,
    onConfirm: async () => {
      await commitFixtureSync();
    }
  });
});

updateResultsBtn?.addEventListener("click", async () => {
  try {
    await updateResultsForSelectedGw_();
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

adminFixtureGwSelect?.addEventListener("change", async () => {
  adminFixtureSelectedGw = adminFixtureGwSelect.value || "ALL";
  populateAdminFixtureFilters_();
  renderAdminFixturesTabView_();
  setFixtureScanDatesFromSelectedGw_();
  updateFixturesMeta_();
  await updateFixtureDeadlineInfo_();
});


adminLoginBtn?.addEventListener("click", async () => {
  const key = (adminKeyEl?.value || "").trim();
  if (!key) return showMsg("Enter admin password.", false);

  try {
    await loginWithKey(key);
  } catch (e) {
    showSplash(false);
    setBtnLoading(adminLoginBtn, false);
    showMsg(String(e.message || e), false);
  }
});

adminKeyEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") adminLoginBtn?.click();
});

adminLogoutBtn?.addEventListener("click", logout);

refreshApprovalsBtn?.addEventListener("click", async () => {
  try {
    setBtnLoading(refreshApprovalsBtn, true);
    await loadApprovals();
  } catch (e) {
    showMsg(String(e.message || e), false);
  } finally {
    setBtnLoading(refreshApprovalsBtn, false);
  }
});

refreshSubsBtn?.addEventListener("click", async () => {
  try {
    await refreshSubmissionsIncremental();
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

/*******************************
 * BOOT
 *******************************/
(async function bootAdmin() {
  showSplash(false);

  const savedKey = localStorage.getItem(LS_ADMIN_KEY);
  if (!savedKey) {
    exitPanel();
    return;
  }

  try {
    await loginWithKey(savedKey);
  } catch (e) {
    console.error(e);
    exitPanel();
    showMsg(String(e.message || e), false);
  }
})();