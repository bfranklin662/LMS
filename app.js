/*******************************
 * CONFIG
 *******************************/
const API_URL = "https://lms-api.nick-horne123.workers.dev";

const DEBUG_API = false;

const FIXTURE_SOURCES = [
  { league: "Premier League", url: "site/data/fixtures/premier-league.json" },
  { league: "Championship", url: "site/data/fixtures/championship.json" },
  { league: "League One", url: "site/data/fixtures/league-one.json" },
  { league: "League Two", url: "site/data/fixtures/league-two.json" },
  { league: "FA Cup", url: "site/data/fixtures/fa-cup.json" },
  { league: "World Cup", url: "site/data/fixtures/world-cup.json" },
];

const DEADLINE_HOURS_BEFORE_FIRST_FIXTURE = 1;

const LS_SESSION = "cpfc_lms_session";

const TEAM_NAME_MAP_URL = "site/data/team-name-map.json";
const TEAM_LOGOS_URL = "site/data/team-logos.json";
const DEFAULT_TEAM_LOGO = "site/images/team-default.png";

let TEAM_NAME_MAP_ROWS = [];
let TEAM_NAME_MAP_BY_ANY = new Map();

// --- DEBUG: force GW report UI on/off ---
const DEBUG_FORCE_GW_REPORT = false;   // set true to show the card even before deadline
const DEBUG_REPORT_GW_ID = null;       // e.g. "GW2" to force a specific GW, or null to use currentGwId

// ✅ Registration lock
const REGISTRATION_OPEN = true; // set true when you open entries again

const REGISTRATION_CLOSED_HTML = `
  <div style="line-height:1.5;">
    <p style="margin:0 0 10px;"><strong>Thank you for registering.</strong></p>
    <p style="margin:0 0 10px;">However, the game is now closed to new entries.</p>
    <p style="margin:0;">We’ll notify you when the next game opens.</p>
  </div>
`;
// ✅ Report card should follow the current GW by default
const GW_REPORT_GW_ID = null;          // null = use currentGwId

const GAME_ARCHIVES_URL = "site/data/game-archives.json";
let GAME_ARCHIVES = {};

/*******************************
 * API
 *******************************/

async function api(payload, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res, text, ct;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      mode: "cors",
      redirect: "manual",
      signal: controller.signal,
    });

    text = await res.text();
    ct = (res.headers.get("content-type") || "").toLowerCase();
  } catch (e) {
    clearTimeout(t);
    const msg = (e && e.name === "AbortError") ? "Request timed out" : (e.message || String(e));
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  if (DEBUG_API) {
    console.log("API debug:", {
      requestUrl: API_URL,
      status: res.status,
      responseUrl: res.url,
      contentType: ct,
      preview: (text || "").slice(0, 120),
    });
  }

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    throw new Error(`API redirect ${res.status} -> ${loc || "(no location header)"}`);
  }

  if (ct.includes("text/html") || (text || "").trim().startsWith("<!DOCTYPE html")) {
    throw new Error(`API returned HTML. status=${res.status} url=${res.url} preview=${(text || "").slice(0, 120)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`API returned non-JSON. status=${res.status} url=${res.url} preview=${(text || "").slice(0, 120)}`);
  }

  if (!data.ok) throw new Error(data.error || "API error");
  return data;
}




function setBtnLoading(btn, loading) {
  if (!btn) return;

  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("btn-loading");
    btn.innerHTML = `
      <span class="icon-spinner" aria-hidden="true"></span>
      <span class="btn-text">${btn.textContent}</span>
    `;
  } else {
    btn.disabled = false;
    btn.classList.remove("btn-loading");
    btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
  }
}

/*******************************
 * DOM
 *******************************/
const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const logoutBtnOuter = document.getElementById("logoutBtnOuter");
const logoutBtnApp = document.getElementById("logoutBtnApp");
const teamSearch = document.getElementById("teamSearch");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const showLoginBtn = document.getElementById("showLoginBtn");
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const registerBtn = registerForm?.querySelector('button[type="submit"]');
const loginBtn = loginForm?.querySelector('button[type="submit"]');
const authMsg = document.getElementById("authMsg");
const teamsDatalist = document.getElementById("teamsDatalist");
const gwLabel = document.getElementById("gwLabel");
const clearPickBtn = document.getElementById("clearPickBtn");

const clubTeamEl = document.getElementById("clubTeam"); // or whatever your select id is
const connectionWrap = document.getElementById("connectionWrap");
const connectionInput = document.getElementById("connectionInput");
const lobbyView = document.getElementById("lobbyView");

let entriesReqId = 0;
let remainingReqId = 0;
let activeTab2 = "fixtures";

let entriesLoading = false;
let lastEntriesSig = "";

let activeGameId = null;   // which game the user is currently in
let gamesList = [];        // from API

let myEntries = [];          // entries for this account across games
let activeEntry = null;

const tabButtons = document.querySelectorAll(".tab2");
const fixturesPanel = document.getElementById("panel-fixtures");
const entriesPanel = document.getElementById("panel-entries");

const panelSelection = document.getElementById("panel-selection");

const rolloverBadgeEl = document.getElementById("gameTitleRolloverBadge");


function setTab2(name) {
  activeTab2 = name;

  tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));

  panelSelection?.classList.toggle("hidden", name !== "selection");
  fixturesPanel?.classList.toggle("hidden", name !== "fixtures");
  entriesPanel?.classList.toggle("hidden", name !== "entries");

  if (name === "entries") renderEntriesTab();
  if (name === "fixtures") renderFixturesTab();

  // Optional: when going back to selection, refresh top UI
  if (name === "selection") {
    renderCurrentPickBlock();
    renderStatusBox();
    renderPickCardState();
    startDeadlineTimer();

    renderGwReportCard_(); // ✅ add this so it appears immediately
  }
}

tabButtons.forEach(b => b.addEventListener("click", () => setTab2(b.dataset.tab)));

const fixturesList = document.getElementById("fixturesList");
const fixturesMsg = document.getElementById("fixturesMsg");
const gameweekSelect = document.getElementById("gameweekSelect");

const submitPickBtn = document.getElementById("submitPickBtn");
const gwTitleEl = document.getElementById("gwTitle");
const gwRangeEl = document.getElementById("gwRange");

const gwTitle = document.getElementById("gwTitle");

const aliveList = document.getElementById("aliveList");
const outList = document.getElementById("outList");

const profileName = document.getElementById("profileName");
const profileMeta = document.getElementById("profileMeta");
const profileStatus = document.getElementById("profileStatus");
const profileSelections = document.getElementById("profileSelections");

const modalOverlay = document.getElementById("modalOverlay");
const systemModal = document.getElementById("systemModal");
const profileModal = document.getElementById("profileModal");
const infoModal = document.getElementById("infoModal");
const playerModal = document.getElementById("playerModal");
const playerModalBody = document.getElementById("playerModalBody");

const privacyModal = document.getElementById("privacyModal");

const forgotPasswordModal = document.getElementById("forgotPasswordModal");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const forgotPasswordEmail = document.getElementById("forgotPasswordEmail");
const forgotPasswordMsg = document.getElementById("forgotPasswordMsg");
const forgotPasswordSubmitBtn = document.getElementById("forgotPasswordSubmitBtn");

const allModals = [systemModal, profileModal, infoModal, playerModal, privacyModal, forgotPasswordModal].filter(Boolean);


playerModal?.addEventListener("pointerdown", (e) => {
  if (e.target === playerModal) closeModal(playerModal);
});
playerModal?.querySelector(".modal-card")?.addEventListener("pointerdown", (e) => e.stopPropagation());

// ----------------------------
// STORAGE KEYS (NO TRAILING SPACES)
// ----------------------------
const KEY_VERIFIED_SEEN = (email) => `lms_verified_seen::${String(email || "").trim().toLowerCase()}`;
const KEY_SESSION_SEEN_VERIFIED = (email) => `session_seen_verified::${String(email || "").trim().toLowerCase()}`;
const KEY_WINNER_SEEN = (email) => `lms_winner_seen::${String(email || "").trim().toLowerCase()}`;
const KEY_SEEN_OUTCOME_SIG = (email) => `seen_outcome_sig_session::${String(email || "").trim().toLowerCase()}`;

// one-time cleanup of the old buggy keys with trailing spaces
(function cleanupOldTrailingSpaceKeys_() {
  try {
    const sess = (() => {
      try { return JSON.parse(localStorage.getItem(LS_SESSION) || "null"); } catch { return null; }
    })();
    const email = String(sess?.email || "").trim().toLowerCase();
    if (!email) return;

    // remove old forms that accidentally had trailing spaces
    localStorage.removeItem(`lms_verified_seen::${email} `);
    sessionStorage.removeItem(`session_seen_verified::${email} `);
  } catch { }
})();


/*******************************
 * STATE
 *******************************/
let fixtures = [];
let gameweeks = [];
let deadlinesByGw = new Map();

let deadlineInterval = null;

let sessionEmail = null;
let sessionUser = null;      // from API
let sessionPicks = [];       // from getProfile
let usedTeams = new Set();   // derived

let viewingGwId = null;  // dropdown controls this (fixtures view)
let currentGwId = null;  // “default” GW for pick box + eligibility

let isEditingCurrentPick = false;

let lastRemainingPlayers = null; // alive count
let lastTotalPlayers = null;     // total count
let remainingLoading = false;

let lastEntriesFetchAt = 0;

let lastApprovedState = null;

let lastMyPlacing = null;
let lastMyTotalPlayers = null;

let lastGwReportSig = "";
let gwReportLoading = false;
let lastGwReportCount = null;
let lastGwReportCountGwId = null;
let gwReportCountLoading = false;
let lastGwReportCountFetchAt = 0;
let lastGwReportStats = null;
let lastGwReportStatsGwId = null;

let competitionOver = false;
let winnerEmail = null;
let lastRemainingFetchAt = 0; // throttle for polling

let lobbyCountsByGame = {};
let lobbyCountsLoading = {};

let lobbyPoll = null;
let lastEntryApprovedByGame = {};

let lastLobbyRenderSig = "";

let fixturePickCountsByGw = new Map();      // gwId -> Map(fixtureKey => {home, away})
let fixturePickRowsByGw = new Map();        // gwId -> raw gw report rows
let fixturePickLoadPromisesByGw = new Map(); // gwId -> Promise
let enterGameSeq = 0;
let finishedGamesOpen = true;


/*******************************
 * HELPERS
 *******************************/

let TEAM_LOGO_MAP = new Map(); // key: normalized team name -> logo path

function normTeamKey_(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " "); // collapse multiple spaces
}

async function loadTeamLogosOnce_() {
  if (TEAM_LOGO_MAP.size) return;

  const res = await fetch(TEAM_LOGOS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load team logos: ${TEAM_LOGOS_URL} (${res.status})`);

  const data = await res.json();
  const arr = Array.isArray(data) ? data : (Array.isArray(data.teams) ? data.teams : []);

  TEAM_LOGO_MAP = new Map(
    arr
      .filter(x => x && x.team && x.logo)
      .map(x => [normTeamKey_(x.team), String(x.logo)])
  );
}

async function loadTeamNameMapOnce_() {
  if (TEAM_NAME_MAP_ROWS.length) return;

  const res = await fetch(TEAM_NAME_MAP_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load team name map: ${TEAM_NAME_MAP_URL} (${res.status})`);

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
      const key = normTeamKey_(term);
      if (key) TEAM_NAME_MAP_BY_ANY.set(key, row);
    }
  }
}

function getTeamMapRow_(teamName) {
  const key = normTeamKey_(teamName);
  return TEAM_NAME_MAP_BY_ANY.get(key) || null;
}

function getCanonicalTeamName_(teamName) {
  const row = getTeamMapRow_(teamName);
  return row?.canonical || teamName;
}

function getDisplayTeamName_(teamName) {
  const row = getTeamMapRow_(teamName);
  return row?.canonical || teamName;
}

function getTeamSearchTerms_(teamName) {
  const row = getTeamMapRow_(teamName);
  if (!row) return [teamName];

  return Array.from(new Set([
    row.canonical,
    row.flashscore,
    row.logo,
    ...(Array.isArray(row.search) ? row.search : [])
  ].filter(Boolean)));
}

function areTeamsSame_(a, b) {
  return normTeamKey_(getCanonicalTeamName_(a)) === normTeamKey_(getCanonicalTeamName_(b));
}

function getTeamLogo_(teamName) {
  const row = getTeamMapRow_(teamName);
  const lookupName = row?.logo || row?.canonical || teamName;
  const key = normTeamKey_(lookupName);
  return TEAM_LOGO_MAP.get(key) || DEFAULT_TEAM_LOGO;
}

async function fetchGames_(viewerEmail = "") {
  console.log("fetchGames_ viewerEmail =", viewerEmail);

  const data = await api({
    action: "getGames",
    email: viewerEmail || ""
  });

  console.log("getGames response =", data);

  gamesList = Array.isArray(data.games) ? data.games : [];
}

function isPaymentWorkflowGame_(gameId) {
  const game = (gamesList || []).find(g => String(g.id || "") === String(gameId || ""));
  if (!game) return false;

  return String(game.status || "").toUpperCase() === "OPEN";
}

function paymentRefStorageKey_(gameId, email = sessionEmail) {
  return `lms_payment_ref::${String(email || "").trim().toLowerCase()}::${String(gameId || "").trim()}`;
}

function saveStoredPaymentRef_(gameId, paymentRef, email = sessionEmail) {
  if (!paymentRef) return;
  localStorage.setItem(paymentRefStorageKey_(gameId, email), String(paymentRef));
}

function getStoredPaymentRef_(gameId, email = sessionEmail) {
  return localStorage.getItem(paymentRefStorageKey_(gameId, email)) || "";
}

function copyTextSafe_(text) {
  const value = String(text || "");
  if (!value) return Promise.resolve(false);

  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(ta);
  return Promise.resolve(ok);
}

async function fetchMyEntries_() {
  if (!sessionEmail) return;

  const data = await api({
    action: "getMyEntries",
    email: sessionEmail
  });

  console.log(
    "getMyEntries source:",
    data.source,
    "entries:",
    data.entries?.length
  );

  myEntries = Array.isArray(data.entries) ? data.entries : [];
}

function getMyEntryForGame_(gameId) {
  const gid = String(gameId || "");
  return (myEntries || []).find(e => String(e.gameId || "") === gid) || null;
}

function getFixturePickCountKeyApp_(gwId, homeTeam, awayTeam) {
  return [
    String(gwId || "").trim().toUpperCase(),
    normTeam_(homeTeam),
    normTeam_(awayTeam)
  ].join("::");
}

function shouldShowFixturePickDataForGw_(gwId) {
  const gw = gameweeks.find(g => String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase());
  if (!gw) return false;

  const started = Date.now() >= gw.deadline.getTime();
  if (!started) return false;

  const isCurrentGw = String(gwId || "").toUpperCase() === String(currentGwId || "").toUpperCase();

  // replicate the same protection you already use for "View all"
  if (isCurrentGw) {
    const currentPick = getPickForGw(currentGwId);
    const lateSubmittingNow = canLateSubmitCurrentGw_() && !currentPick?.team;
    if (lateSubmittingNow) return false;
  }

  return true;
}

function buildFixturePickCountsForGw_(gwId, rows) {
  const counts = new Map();
  const gw = gameweeks.find(g => String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase());
  if (!gw) return counts;

  for (const row of rows || []) {
    const selection = String(row?.selection || "").trim();
    if (!selection) continue;

    const fixture = findFixtureForTeam(gw, selection);
    if (!fixture) continue;

    const fixtureKey = getFixturePickCountKeyApp_(fixture.gwId, fixture.home, fixture.away);

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
      areTeamsSame_(selection, fixture.home) ? bucket.home :
        areTeamsSame_(selection, fixture.away) ? bucket.away :
          null;

    if (!target) continue;

    target.count += 1;

    const outcome = normalizeOutcome_(row?.outcome);

    if (outcome === "WIN") target.win += 1;
    else if (outcome === "LOSS") target.loss += 1;
    else target.pending += 1;
  }

  return counts;
}

async function ensureFixturePickDataForGw_(gwId) {
  const key = String(gwId || "").trim().toUpperCase();

  if (!shouldShowFixturePickDataForGw_(key)) return;
  if (fixturePickCountsByGw.has(key) && fixturePickRowsByGw.has(key)) return;

  if (fixturePickLoadPromisesByGw.has(key)) {
    return fixturePickLoadPromisesByGw.get(key);
  }

  const p = (async () => {
    let rows = await fetchGwReportRows_(key);
    rows = Array.isArray(rows) ? rows : [];

    // only actual selections count toward fixture badges
    rows = rows.filter(row => {
      const selection = String(row?.selection || "").trim();
      const outcome = normalizeOutcome_(row?.outcome);

      return selection && outcome !== "VOID";
    });

    fixturePickRowsByGw.set(key, rows);
    fixturePickCountsByGw.set(key, buildFixturePickCountsForGw_(key, rows));
  })().finally(() => {
    fixturePickLoadPromisesByGw.delete(key);
  });

  fixturePickLoadPromisesByGw.set(key, p);
  return p;
}

function getFixturePickCountsForApp_(fixture) {
  const gwKey = String(fixture?.gwId || "").trim().toUpperCase();
  const fixtureMap = fixturePickCountsByGw.get(gwKey);
  if (!fixtureMap) return null;

  const key = getFixturePickCountKeyApp_(fixture.gwId, fixture.home, fixture.away);
  return fixtureMap.get(key) || null;
}

function getPickBadgeClassApp_(sideStats) {
  if (!sideStats || !sideStats.count) return "pick-badge pick-badge-none";
  if (sideStats.pending > 0) return "pick-badge pick-badge-pending";
  if (sideStats.win > 0) return "pick-badge pick-badge-win";
  if (sideStats.loss > 0) return "pick-badge pick-badge-loss";
  return "pick-badge pick-badge-none";
}

function renderFixturePickBadgeApp_(sideStats, fixture, side) {
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
      class="${getPickBadgeClassApp_(sideStats)} fixture-pick-badge-btn"
      data-fixture-pick-badge="1"
      data-gw-id="${escapeAttr(fixture.gwId || "")}"
      data-home="${escapeAttr(fixture.home || "")}"
      data-away="${escapeAttr(fixture.away || "")}"
      data-side="${escapeAttr(side || "")}"
      title="${escapeAttr(title)}"
      aria-label="${escapeAttr(title)}"
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

function getRowsForFixtureSideApp_(gwId, homeTeam, awayTeam, side) {
  const key = String(gwId || "").trim().toUpperCase();
  const rows = fixturePickRowsByGw.get(key) || [];
  const wantedSide = String(side || "").trim().toLowerCase();

  return rows
    .filter(row => {
      const selection = String(row?.selection || "").trim();
      if (!selection) return false;

      const sameHome = areTeamsSame_(selection, homeTeam);
      const sameAway = areTeamsSame_(selection, awayTeam);

      return wantedSide === "home" ? sameHome : sameAway;
    })
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
}

function openFixturePickBadgeModal_(gwId, homeTeam, awayTeam, side) {
  if (!shouldShowFixturePickDataForGw_(gwId)) return;

  const rows = getRowsForFixtureSideApp_(gwId, homeTeam, awayTeam, side);
  const pickedTeam = side === "home" ? homeTeam : awayTeam;

  showSystemModal_(
    `${getDisplayTeamName_(pickedTeam)} picks`,
    rows.length
      ? `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${rows.map(row => `
            <div style="padding:10px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
              <div style="font-weight:700;">${escapeHtml(row?.name || "Unknown player")}</div>
              <div class="muted small">
                ${escapeHtml(simplifyClub_(row?.clubTeam || "—"))}
              </div>
            </div>
          `).join("")}
        </div>
      `
      : `<div class="muted">No picks found.</div>`,
    { showActions: false }
  );
}

function bindFixturePickBadgeEvents_() {
  document.querySelectorAll('[data-fixture-pick-badge="1"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      openFixturePickBadgeModal_(
        btn.getAttribute("data-gw-id") || "",
        btn.getAttribute("data-home") || "",
        btn.getAttribute("data-away") || "",
        btn.getAttribute("data-side") || ""
      );
    });
  });
}

function getLeagueFixturePickCountApp_(fixtures) {
  let total = 0;

  for (const f of fixtures || []) {
    const counts = getFixturePickCountsForApp_(f);
    if (!counts) continue;

    total += Number(counts.home?.count || 0);
    total += Number(counts.away?.count || 0);
  }

  return total;
}

function renderLeaguePickBadgeApp_(fixtures) {
  const total = getLeagueFixturePickCountApp_(fixtures);
  if (!total) return "";

  return `
    <span
      class="pick-badge pick-badge-pending"
      title="${escapeAttr(`${total} total pick${total === 1 ? "" : "s"} in this league`)}"
      aria-label="${escapeAttr(`${total} total pick${total === 1 ? "" : "s"} in this league`)}"
    >
      ${total}
    </span>
  `;
}

async function handleLobbyApprovalChanges_() {
  let newlyApprovedEntry = null;

  for (const entry of (myEntries || [])) {
    const gameId = String(entry?.gameId || "");
    if (!gameId) continue;

    const approvedNow = isApproved_(entry);
    const approvedBefore = lastEntryApprovedByGame[gameId];

    if (approvedBefore === false && approvedNow === true) {
      newlyApprovedEntry = entry;
      break;
    }
  }

  if (!newlyApprovedEntry) return false;

  const gameId = String(newlyApprovedEntry.gameId || "");
  const game = (gamesList || []).find(g => String(g.id || "") === gameId);
  const gameTitle = String(game?.title || "this game").trim();

  for (const entry of (myEntries || [])) {
    const gid = String(entry?.gameId || "");
    if (!gid) continue;
    lastEntryApprovedByGame[gid] = isApproved_(entry);
  }

  try {
    await fetchGames_();
    await refreshLobbyCounts_();
    renderLobby_();

    // IMPORTANT: do not auto-enter payment workflow game
    if (false && isPaymentWorkflowGame_(gameId)) {
      const msg = document.getElementById("paymentSheetMsg");
      const statusBtn = document.getElementById("paymentCheckStatusBtn");

      if (msg) {
        msg.innerHTML = `
          <div class="payment-status-card payment-status-card--approved">
            <div class="payment-status-card__icon">✓</div>
            <div class="payment-status-card__content">
              <div class="payment-status-card__title">Approved</div>
              <div class="payment-status-card__text">Your payment has been matched successfully.</div>
            </div>
          </div>
          <button
            id="paymentEnterGameBtn"
            class="btn btn-primary payment-sheet-v3__primary"
            type="button"
            style="margin-top:10px;"
          >
            Enter game
          </button>
        `;
        msg.classList.remove("hidden", "bad");
        msg.classList.add("good");

        document.getElementById("paymentEnterGameBtn")?.addEventListener("click", async () => {
          closeModal(systemModal);
          await enterGame_(gameId);
        }, { once: true });
      }

      if (statusBtn) {
        statusBtn.textContent = "Approved ✓";
        statusBtn.disabled = true;
      }

      return true;
    }

    await enterGame_(gameId);

    showSystemModal_(
      "",
      `
        <div class="payment-sheet-v3">
          <div class="payment-status-card payment-status-card--approved" style="margin-bottom:14px;">
            <div class="payment-status-card__icon">✓</div>
            <div class="payment-status-card__content">
              <div class="payment-status-card__title">Registration approved</div>
              <div class="payment-status-card__text">
                You have been approved for <strong>${escapeHtml(gameTitle)}</strong>.
              </div>
            </div>
          </div>

          <div style="
            padding:14px;
            border-radius:16px;
            background:rgba(255,255,255,0.06);
            border:1px solid rgba(255,255,255,0.08);
            line-height:1.45;
            margin-bottom:14px;
          ">
            You can now make your first selection.
          </div>

          <button
            type="button"
            class="btn btn-primary payment-sheet-v3__primary"
            onclick="closeModal(systemModal)"
            style="width:100%;"
          >
            Continue
          </button>
        </div>
      `,
      { showActions: false, variant: "sheet" }
    );

    return true;
  } catch (err) {
    console.warn("Lobby approval transition failed", err);
    return false;
  }
}

function wasPlayerAliveInGw_(userOrRow, gwId) {
  const approved = isApproved_(userOrRow);
  if (!approved) return false;

  const targetIdx = gwIndexForRank_(gwId);
  const knockedOutGw = String(userOrRow?.knockedOutGw || "").toUpperCase();

  // still alive now, so they were alive for that GW
  if (!knockedOutGw) return true;

  const koIdx = gwIndexForRank_(knockedOutGw);

  // knocked out in this GW = they were alive entering this GW, so include them
  return koIdx >= targetIdx;
}

function getGameStatusRank_(status) {
  const s = String(status || "").toUpperCase();
  if (s === "RUNNING") return 0;
  if (s === "OPEN") return 1;
  if (s === "FINISHED") return 2;
  return 9;
}

function getPreferredGameIdForSession_() {
  if (!sessionEmail || !Array.isArray(myEntries) || !myEntries.length) return null;

  const ranked = myEntries
    .map(entry => {
      const game = (gamesList || []).find(g => String(g.id || "") === String(entry.gameId || ""));
      const statusRank = getGameStatusRank_(game?.status);
      const approved = !!entry?.approved;
      const alive = entry?.alive !== false;

      let priority = 99;

      if (approved && alive && statusRank === 0) priority = 0;       // running + alive
      else if (approved && statusRank === 0) priority = 1;           // running
      else if (approved && statusRank === 1) priority = 2;           // open + approved
      else if (statusRank === 1) priority = 3;                       // open + pending
      else if (statusRank === 2) priority = 4;                       // finished
      else priority = 9;

      return {
        gameId: String(entry.gameId || ""),
        priority,
        sortOrder: Number(game?.sortOrder || 9999)
      };
    })
    .filter(x => x.gameId);

  if (!ranked.length) return null;

  ranked.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sortOrder - b.sortOrder;
  });

  return ranked[0].gameId || null;
}

function startLobbyPolling_() {
  // TEMP: disabled to protect Firebase quota
  return;
}

function stopLobbyPolling_() {
  if (lobbyPoll) {
    clearInterval(lobbyPoll);
    lobbyPoll = null;
  }
}

function parsePrizeInfo_(rawValue) {
  const raw = String(rawValue ?? "").trim();

  if (!raw) {
    return {
      raw,
      amount: 0,
      isRollover: false,
      hasPrize: false,
      displayAmount: "",
      badgeText: "",
      tooltipText: ""
    };
  }

  const cleaned = raw.replace(/£/g, "").trim();
  const isRollover = cleaned.endsWith("+");
  const numericPart = isRollover ? cleaned.slice(0, -1).trim() : cleaned;
  const amount = Number(numericPart);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      raw,
      amount: 0,
      isRollover: false,
      hasPrize: false,
      displayAmount: "",
      badgeText: "",
      tooltipText: ""
    };
  }

  return {
    raw,
    amount,
    isRollover,
    hasPrize: true,
    displayAmount: `£${amount}`,
    badgeText: isRollover ? `£${amount} rollover` : `£${amount}`,
    tooltipText: isRollover ? "Rollover prize" : "1st prize"
  };
}

function getRolloverPillHtml_(game) {
  const prizeInfo = parsePrizeInfo_(game?.prize);

  if (!prizeInfo.isRollover) return "";

  return `
    <span class="hero-pill-tooltip" data-tooltip="${escapeAttr(prizeInfo.tooltipText)}">
      <span class="pill-emoji">💰</span> ${escapeHtml(prizeInfo.badgeText)}
    </span>
  `;
}

function getPrizePillHtml_(game) {
  const prizeInfo = parsePrizeInfo_(game?.prize);

  if (!prizeInfo.hasPrize || prizeInfo.isRollover) return "";

  return `
    <span class="hero-pill-tooltip" data-tooltip="${escapeAttr(prizeInfo.tooltipText)}">
      <span class="pill-emoji">💰</span> ${escapeHtml(prizeInfo.displayAmount)}
    </span>
  `;
}

function getGameEndGwNum_(game = getActiveGame_()) {
  const raw = String(
    game?.endGw || game?.finishedGw || game?.lastGw || ""
  ).trim().toUpperCase();

  const n = gwNumFromId(raw);
  return Number.isFinite(n) ? n : null;
}

function openInfoModalForGame_(gameId) {
  const modal = document.getElementById("infoModal");
  if (!modal) return;

  const titleEl = modal.querySelector(".modal-title");
  const bodyEl = modal.querySelector(".modal-body");

  if (!titleEl || !bodyEl) {
    console.warn("Info modal title/body not found");
    return;
  }

  const game = (gamesList || []).find(g => String(g.id || "") === String(gameId || ""));
  const title = String(game?.title || "Competition").trim();
  const competitions = getGameCompetitions_(game);
  const entryFee = Number(game?.entryFee || 0);

  titleEl.textContent = `${title} - How to play`;

  bodyEl.innerHTML = `
    <div style="line-height:1.55;">
      <p><strong>Competitions included:</strong> ${escapeHtml(competitions.join(", "))}</p>

      <p>Pick <strong>one team</strong> each gameweek.</p>

      <p>If your team <strong>wins</strong>, you go through to the next gameweek.</p>

      <p>If your team <strong>draws or loses</strong>, you are out.</p>

      <p>You can only use each team <strong>once</strong> during the competition.</p>

      <p>Your selection must be submitted before the deadline shown in the app.</p>

      <p><strong>Entry fee:</strong> £${entryFee}</p>

      <p><strong>Prize split:</strong> 50% winner, 40% fundraising, 10% admin.</p>

      <p><strong>Last player remaining wins.</strong></p>
    </div>
  `;

  openModal(modal);
}

function convertFixtureGwToGameGw_(fixtureGwId, game) {
  const startGw = String(game?.startGw || "GW1").toUpperCase();

  const startNum = Number(startGw.replace("GW", ""));
  const fixtureNum = Number(String(fixtureGwId).replace("GW", ""));

  const gameNum = fixtureNum - startNum + 1;

  return `GW${gameNum}`;
}

const GAME_BANNERS = {
  "jan_2026_lms": "site/images/game-banners/jan_2026_lms.png",
  "spring_2026_lms": "site/images/game-banners/spring_2026_lms.png",
  "the_run_in": "site/images/game-banners/the_run_in.png",
  "world_cup_26": "site/images/game-banners/world-cup-26.png",
};

function getGameBannerUrl_(gameId) {
  return GAME_BANNERS[String(gameId || "").trim()] || "site/images/game-banners/default.png";
}

function getGameStartGwNum_(game = getActiveGame_()) {
  const n = gwNumFromId(game?.startGw);
  return Number.isFinite(n) ? n : 1;
}

function getDisplayGwNumForGame_(actualGwId, game = getActiveGame_()) {
  const actualNum = gwNumFromId(actualGwId);
  const startNum = getGameStartGwNum_(game);

  if (!Number.isFinite(actualNum) || !Number.isFinite(startNum)) return actualNum;
  return actualNum - startNum + 1;
}

function getDisplayGwIdForGame_(actualGwId, game = getActiveGame_()) {
  const n = getDisplayGwNumForGame_(actualGwId, game);
  return Number.isFinite(n) && n > 0 ? `GW${n}` : actualGwId;
}

function getActualGwIdForDisplayGw_(displayGwId, game = getActiveGame_()) {
  const displayNum = gwNumFromId(displayGwId);
  const startNum = getGameStartGwNum_(game);

  if (!Number.isFinite(displayNum) || !Number.isFinite(startNum)) return displayGwId;
  return `GW${startNum + displayNum - 1}`;
}

async function refreshLobbyCounts_() {
  const targetGames = (gamesList || []).filter(g => {
    const s = String(g.status || "").toUpperCase();
    return s === "OPEN" || s === "RUNNING" || s === "FINISHED";
  });

  await Promise.all(targetGames.map(async (g) => {
    const gameId = String(g.id || "");
    if (!gameId) return;

    const status = String(g.status || "").toUpperCase();
    const archivedCounts = GAME_ARCHIVES[gameId];

    if (status === "FINISHED" && archivedCounts) {
      lobbyCountsByGame[gameId] = archivedCounts;
      lobbyCountsLoading[gameId] = false;
      renderLobby_();
      return;
    }

    try {
      const fast = await api({ action: "getGameCounts", gameId });

      if (fast?.counts) {
        lobbyCountsByGame[gameId] = fast.counts;
      }
    } catch (firebaseErr) {
      console.warn("Firebase lobby counts failed; skipping fallback to protect quota", gameId, firebaseErr);
    } finally {
      lobbyCountsLoading[gameId] = false;
      renderLobby_();
    }
  }));
}

function getCompetitionLogo_(name) {
  const key = String(name || "").trim().toLowerCase();

  const map = {
    "premier league": "site/images/competitions/premier-league.png",
    "championship": "site/images/competitions/championship.png",
    "league one": "site/images/competitions/league-one.png",
    "league two": "site/images/competitions/league-two.png",
    "fa cup": "site/images/competitions/fa-cup.png",
    "world cup": "site/images/competitions/world-cup.png",
  };

  return map[key] || "site/images/competitions/default.png";
}



function parseCompetitions_(value) {
  return String(value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function getGameCompetitions_(game = getActiveGame_()) {
  const comps = parseCompetitions_(game?.competitions);
  return comps.length
    ? comps
    : ["Premier League", "Championship", "League One", "League Two"];
}

function gameIncludesLeague_(leagueName, game = getActiveGame_()) {
  const comps = getGameCompetitions_(game).map(x => x.toLowerCase());
  return comps.includes(String(leagueName || "").trim().toLowerCase());
}

function getCountryFlagUrl_(teamName) {
  const slug = String(teamName || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `site/images/flags/${slug}.svg`;
}

function teamInlineHtml_(teamName, { size = 18, logoPosition = "before", isSelected = false, displayName = null } = {}) {
  const activeGame = getActiveGame_();
  const useFlags = gameIncludesLeague_("World Cup", activeGame);

  const logo = useFlags ? getCountryFlagUrl_(teamName) : getTeamLogo_(teamName);
  const fallbackLogo = useFlags ? DEFAULT_TEAM_LOGO : DEFAULT_TEAM_LOGO;
  const shown = displayName || teamName;

  const logoImg = `
    <img class="team-logo" src="${escapeAttr(logo)}" alt="${escapeAttr(teamName)} logo"
         width="${size}" height="${size}"
         onerror="this.onerror=null;this.src='${escapeAttr(fallbackLogo)}';" />
  `;

  const nameSpan = `<span class="team-name ${isSelected ? "is-selected" : ""}">${escapeHtml(shown)}</span>`;

  return `
    <span class="team-inline team-inline--${logoPosition}">
      ${logoPosition === "before" ? logoImg : nameSpan}
      ${logoPosition === "before" ? nameSpan : logoImg}
    </span>
  `;
}

let _scrollY = 0;

function lockBodyScroll_() {
  _scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = "fixed";
  document.body.style.top = `-${_scrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockBodyScroll_() {
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, _scrollY);
}


function fixtureTeamsHtml_(home, away, { highlightTeam = null } = {}) {
  const pickKey = normTeam_(highlightTeam);
  const homeSel = pickKey && normTeam_(home) === pickKey;
  const awaySel = pickKey && normTeam_(away) === pickKey;

  return `
    <div class="fixture-teams">
      ${teamInlineHtml_(home, {
    logoPosition: "before",
    isSelected: homeSel,
    displayName: displayTeamNameForFixture_(home)
  })}
      <span class="vs">vs</span>
      ${teamInlineHtml_(away, {
    logoPosition: "after",
    isSelected: awaySel,
    displayName: displayTeamNameForFixture_(away)
  })}
    </div>
  `;
}

function isGwLockedById_(gwId) {
  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) return false;
  return Date.now() >= gw.deadline.getTime();
}

function isApproved_(u) {
  const v = u?.approved ?? u?.isApproved ?? u?.Approved ?? u?.verified ?? u?.isVerified ?? u?.paid ?? u?.isPaid;

  // booleans / numbers
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;

  // strings from Sheets / APIs
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1", "approved"].includes(s)) return true;
  if (["false", "no", "n", "0", "", "pending"].includes(s)) return false;

  // fallback: treat unknown as NOT approved
  return false;
}


function outcomeLabel_(outcome) {
  const o = String(outcome || "").trim().toUpperCase();
  if (o === "WIN" || o === "WON") return "Won";
  if (o === "LOSS" || o === "LOST") return "Lost";
  return "TBC";
}

function outcomeCls_(outcome) {
  const o = String(outcome || "").trim().toUpperCase();
  if (o === "WIN" || o === "WON") return "won";
  if (o === "LOSS" || o === "LOST") return "lost";
  return "tbc";
}


async function fetchGwReportRows_(gwId) {
  const data = await api({ action: "getGwReport", gameId: activeGameId, gwId });
  console.log("getGwReport source:", data.source, data.rows?.length);
  return Array.isArray(data.rows) ? data.rows : [];
}

async function getSavedPickFromGwReport_(email, gwId) {
  try {
    const rows = await fetchGwReportRows_(gwId);
    const wanted = String(email || "").trim().toLowerCase();

    const row = (rows || []).find(r =>
      String(r.email || "").trim().toLowerCase() === wanted
    );

    const team = String(row?.selection || row?.team || "").trim();
    if (!team) return null;

    return {
      gwId: String(gwId || "").trim().toUpperCase(),
      team,
      outcome: String(row?.outcome || "PENDING").trim().toUpperCase()
    };
  } catch (err) {
    console.warn("GW report fallback failed", err);
    return null;
  }
}

function simplifyClub_(club) {
  const s = String(club || "").trim().toLowerCase();
  if (s.includes("friend")) return "Friend";
  if (s.includes("relative")) return "Relative";
  return club || "—";
}

function startOfDayUTC(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function buildGameweeks(fixturesArr, game) {
  const map = new Map();
  const startGwNum = getGameStartGwNum_(game);

  for (const f of fixturesArr) {
    const actualNum = gwNumFromId(f.gwId);
    if (!Number.isFinite(actualNum)) continue;
    if (actualNum < startGwNum) continue;
    if (!gameIncludesLeague_(f.league, game)) continue;

    if (!map.has(f.gwId)) map.set(f.gwId, { id: f.gwId, fixtures: [] });
    map.get(f.gwId).fixtures.push(f);
  }

  const gws = Array.from(map.values()).map(gw => {
    gw.fixtures.sort((a, b) => a.kickoff - b.kickoff);

    const firstKickoff = gw.fixtures[0].kickoff;
    const lastKickoff = gw.fixtures[gw.fixtures.length - 1].kickoff;

    const start = startOfDayUTC(firstKickoff);
    const fallbackDeadline = new Date(firstKickoff.getTime() - DEADLINE_HOURS_BEFORE_FIRST_FIXTURE * 3600 * 1000);
    const fallbackLateDeadline = new Date(lastKickoff.getTime());

    const endDay = startOfDayUTC(lastKickoff);
    const endCutoff = new Date(lastKickoff.getTime());

    const actualNum = gwNumFromId(gw.id);
    const displayNum = actualNum - startGwNum + 1;

    return {
      ...gw,
      actualGwId: gw.id,
      displayGwId: `GW${displayNum}`,
      num: displayNum,
      actualNum,
      start,
      firstKickoff,
      lastKickoff,
      deadline: fallbackDeadline,
      lateDeadline: fallbackLateDeadline,
      endDay,
      endCutoff
    };
  });

  gws.sort((a, b) => a.actualNum - b.actualNum);
  return gws;
}

function applyDeadlinesToGameweeks_(gws) {
  return (gws || []).map(gw => {
    const override = deadlinesByGw.get(String(gw.id || "").toUpperCase());

    const sortedFixtures = [...(gw.fixtures || [])].sort((a, b) => a.kickoff - b.kickoff);
    const firstKickoff = sortedFixtures[0]?.kickoff || gw.firstKickoff || null;
    const lastKickoff = sortedFixtures[sortedFixtures.length - 1]?.kickoff || gw.lastKickoff || null;

    if (!firstKickoff || !lastKickoff) return gw;

    if (override?.normalDeadlineIso) {
      return {
        ...gw,
        firstKickoff: override.firstKickoffIso ? new Date(override.firstKickoffIso) : firstKickoff,
        lastKickoff: override.lastKickoffIso ? new Date(override.lastKickoffIso) : lastKickoff,
        deadline: new Date(override.normalDeadlineIso),
        lateDeadline: override.lateDeadlineIso ? new Date(override.lateDeadlineIso) : new Date(lastKickoff),
        endCutoff: override.lateDeadlineIso ? new Date(override.lateDeadlineIso) : new Date(lastKickoff)
      };
    }

    const deadline = new Date(
      firstKickoff.getTime() - DEADLINE_HOURS_BEFORE_FIRST_FIXTURE * 60 * 60 * 1000
    );

    const lateDeadline = new Date(lastKickoff.getTime());

    return {
      ...gw,
      firstKickoff,
      lastKickoff,
      deadline,
      lateDeadline,
      endCutoff: lateDeadline
    };
  });
}

function getGameweeksForGame_(game) {
  if (!game || !fixtures.length) return [];
  return applyDeadlinesToGameweeks_(buildGameweeks(fixtures, game), game);
}

function shouldShowGwReportRow_(row, gwId) {
  const rowGwId = String(row?.gwId || gwId || "").trim().toUpperCase();
  const targetGwId = String(gwId || "").trim().toUpperCase();

  if (rowGwId !== targetGwId) return false;

  const selection = String(row?.selection || row?.team || "").trim();
  const outcome = String(row?.outcome || "").trim().toUpperCase();

  if (selection) return true;
  if (!selection && outcome === "LOSS") return true;

  return false;
}

async function fetchGwReportRowsWithAlivePlayers_(gwId) {
  const targetGwId = String(gwId || "").trim().toUpperCase();

  const [reportRowsRaw, entriesData, sheetsEntriesData] = await Promise.all([
    fetchGwReportRows_(targetGwId).catch(() => []),
    api({ action: "getEntries", gameId: activeGameId, gwId: targetGwId }).catch(() => ({ users: [] })),
    api({ action: "getEntriesFromSheets", gameId: activeGameId, gwId: targetGwId }).catch(() => ({ users: [] }))
  ]);

  const reportRows = (Array.isArray(reportRowsRaw) ? reportRowsRaw : [])
    .filter(row => {
      const rowGwId = String(row?.gwId || targetGwId || "").trim().toUpperCase();
      const outcome = String(row?.outcome || "").trim().toUpperCase();
      return rowGwId === targetGwId && outcome !== "VOID";
    });

  const reportByEmail = new Map();
  reportRows.forEach(row => {
    const email = String(row.email || "").trim().toLowerCase();
    if (email) reportByEmail.set(email, row);
  });

  const sheetsByEmail = new Map();
  (Array.isArray(sheetsEntriesData.users) ? sheetsEntriesData.users : []).forEach(user => {
    const email = String(user.email || "").trim().toLowerCase();
    if (email) sheetsByEmail.set(email, user);
  });

  const aliveUsers = (Array.isArray(entriesData.users) ? entriesData.users : [])
    .map(user => {
      const email = String(user.email || "").trim().toLowerCase();
      const sheetUser = sheetsByEmail.get(email) || {};
      return {
        ...user,
        approved: sheetUser.approved ?? user.approved,
        alive: sheetUser.alive ?? user.alive,
        knockedOutGw: sheetUser.knockedOutGw ?? user.knockedOutGw,
        knockedOutTeam: sheetUser.knockedOutTeam ?? user.knockedOutTeam,
        firstName: user.firstName || sheetUser.firstName || "",
        lastName: user.lastName || sheetUser.lastName || "",
        clubTeam: user.clubTeam || sheetUser.clubTeam || ""
      };
    })
    .filter(user => wasAliveForGwFromEntry_(user, targetGwId));

  const merged = [];
  const seen = new Set();

  aliveUsers.forEach(user => {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) return;

    const report = reportByEmail.get(email);
    seen.add(email);

    merged.push({
      ...user,
      ...(report || {}),
      email,
      gwId: targetGwId,
      name:
        report?.name ||
        `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
        user.name ||
        email,
      clubTeam: report?.clubTeam || user.clubTeam || "",
      selection: String(report?.selection || report?.team || "").trim(),
      outcome: String(report?.outcome || "").trim().toUpperCase()
    });
  });

  return merged.sort((a, b) =>
    String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""))
  );
}

function getGwReportStatsFromRows_(rows) {
  const alivePlayers = rows.length;
  const selections = rows.filter(row =>
    String(row.selection || row.team || "").trim()
  ).length;

  return { alivePlayers, selections };
}

function updateFixtureGwSubmissionSummary_(gwId, stats) {
  const box = document.querySelector(`[data-gw-submission-summary="${CSS.escape(String(gwId || ""))}"]`);
  if (!box || !stats) return;

  const playersEl = box.querySelector("[data-gw-summary-players]");
  const selectionsEl = box.querySelector("[data-gw-summary-selections]");

  if (playersEl) playersEl.textContent = String(stats.alivePlayers);
  if (selectionsEl) selectionsEl.textContent = String(stats.selections);
}

function getGwIdForSelectionsCard_() {
  // Manual override still wins
  if (DEBUG_REPORT_GW_ID) return DEBUG_REPORT_GW_ID;
  if (GW_REPORT_GW_ID) return GW_REPORT_GW_ID;

  const nowMs = Date.now();

  // Find all gameweeks where the deadline has passed
  const locked = (gameweeks || []).filter(g => g && g.deadline && nowMs >= g.deadline.getTime());
  if (!locked.length) return null;

  // Pick the latest locked GW (by gw.num if numeric, otherwise by deadline time)
  locked.sort((a, b) => {
    const an = (typeof a.num === "number") ? a.num : -1;
    const bn = (typeof b.num === "number") ? b.num : -1;
    if (an !== bn) return bn - an;
    return b.deadline.getTime() - a.deadline.getTime();
  });

  const gw = locked[0];

  // ✅ Keep it visible until end of the gameweek fixture window
  if (gw.endCutoff && nowMs < gw.endCutoff.getTime()) return gw.id;

  // Past the end of the GW -> hide
  return null;
}

function getCurrentGame_() {
  const games = Array.isArray(gamesList) ? [...gamesList] : [];

  if (!games.length) return null;

  games.sort((a, b) => {
    const as = Number(a?.sortOrder || 9999);
    const bs = Number(b?.sortOrder || 9999);
    if (as !== bs) return as - bs;
    return String(a?.title || "").localeCompare(String(b?.title || ""));
  });

  const running = games.find(g => String(g?.status || "").toUpperCase() === "RUNNING");
  if (running) return running;

  const open = games.find(g => String(g?.status || "").toUpperCase() === "OPEN");
  if (open) return open;

  return null;
}

function formatGwDropdownLabel_(gw) {
  const first = gw?.start ? formatDateUK(gw.start) : "";
  const lastKickoff = gw?.lastKickoff || gw?.firstKickoff || null;
  const lastDay = lastKickoff ? startOfDay(lastKickoff) : null;
  const last = lastDay ? formatDateUK(lastDay) : "";

  if (!first) return gw.displayGwId || gw.id || "GW";
  if (!last || first === last) return `${gw.displayGwId || gw.id} (${first})`;

  return `${gw.displayGwId || gw.id} (${first} - ${last})`;
}

function wasAliveForGwFromEntry_(entry, gwId) {
  if (!isApproved_(entry)) return false;

  const targetIdx = gwIndexForRank_(String(gwId || "").toUpperCase());
  const knockedOutGw = String(entry?.knockedOutGw || "").toUpperCase();

  // no knockout GW = still alive / never knocked out yet
  if (!knockedOutGw) return true;

  const koIdx = gwIndexForRank_(knockedOutGw);

  // if knocked out in GW2, they still count for GW2 selections
  return koIdx >= targetIdx;
}

function getAutoEnterGameIdForSession_() {
  if (!sessionEmail) return null;

  const currentGame = getCurrentGame_();
  if (!currentGame) return null;

  const currentGameId = String(currentGame.id || "");
  if (!currentGameId) return null;

  const entry = (myEntries || []).find(
    e => String(e?.gameId || "") === currentGameId
  );

  if (!entry) return null;

  if (isPaymentWorkflowGame_(currentGameId) && !entry.approved) {
    return null;
  }

  return currentGameId;
}

function getRunningStatusText_() {
  const game = getActiveGame_();
  const status = String(game?.status || "").toUpperCase();

  if (status !== "RUNNING") return status || "—";

  const counts = lobbyCountsByGame[String(activeGameId || "")];

  const hasRealCounts =
    counts &&
    counts.remaining != null &&
    counts.total != null;

  const remaining = Number(counts?.remaining);
  const total = Number(counts?.total);

  if (hasRealCounts && total > 0 && remaining === 1) {
    const lastStartedGw = getLastStartedActualGwIdForGame_(game) || game?.startGw;
    return `Complete: ${getDisplayGwIdForGame_(lastStartedGw, game)}`;
  }

  const gwId = getCurrentActualGwIdForGame_(game) || viewingGwId || currentGwId || game?.startGw;
  return gwId ? `Running: ${getDisplayGwIdForGame_(gwId, game)}` : "Running";
}

function snapshotLobbyApprovalStates_() {
  lastEntryApprovedByGame = {};

  (myEntries || []).forEach(entry => {
    const gameId = String(entry?.gameId || "");
    if (!gameId) return;
    lastEntryApprovedByGame[gameId] = isApproved_(entry);
  });
}

async function refreshGwReportCount_(gwId) {
  if (!gwId) return;
  const now = Date.now();

  if (gwReportCountLoading) return;
  if (lastGwReportCountGwId === gwId && (now - lastGwReportCountFetchAt) < 20000) return;

  gwReportCountLoading = true;
  lastGwReportCountFetchAt = now;

  try {
    let rows = await fetchGwReportRowsWithAlivePlayers_(gwId);
    rows = Array.isArray(rows) ? rows : [];

    const stats = getGwReportStatsFromRows_(rows);
    const count = stats.selections;

    if (lastGwReportCountGwId !== gwId || lastGwReportCount !== count) {
      lastGwReportCountGwId = gwId;
      lastGwReportCount = count;
      lastGwReportStatsGwId = gwId;
      lastGwReportStats = stats;

      const countEl = document.getElementById("gwReportCardCount");
      const dotsEl = document.getElementById("gwReportCardDots");
      if (countEl) countEl.textContent = String(count);
      if (dotsEl) dotsEl.style.display = "none";
    }
  } catch {
    // leave existing UI as-is
  } finally {
    gwReportCountLoading = false;
  }
}

async function openGwReportModal_(gwId) {
  const modal = document.getElementById("gwReportModal");
  const titleEl = document.getElementById("gwReportModalTitle");
  const bodyEl = document.getElementById("gwReportModalBody");
  if (!modal || !bodyEl || !titleEl) return;

  titleEl.innerHTML = `
    <div class="gw-report-title-row">
      <span>${escapeHtml(gwLabelLong(gwId))}</span>
      <span class="gw-report-player-pill">
        Players:
        <span id="gwReportModalPlayersDots">
          <span class="dots" aria-label="Loading"></span>
        </span>
        <span id="gwReportModalPlayers"></span>
      </span>
    </div>
  `;

  bodyEl.innerHTML = `
    <div class="gw-report-summary" id="gwReportModalSummary" style="margin:0 0 10px 0;">
      Loading…
    </div>

    <div class="gw-report-body" style="overflow:auto; max-height:60vh;">
      <table class="gw-table">
        <thead>
          <tr>
            <th class="gw-col-player">Player</th>
            <th class="gw-col-club">Team</th>
            <th class="gw-col-team">Selection</th>
            <th class="gw-col-result">Result</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="4" class="muted small" style="padding:10px 6px;">
              Loading…
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  openModal(modal);

  let rows = [];

  try {
    rows = await fetchGwReportRowsWithAlivePlayers_(gwId);
    rows = Array.isArray(rows) ? rows : [];
  } catch {
    rows = [];
  }

  const wonCount = rows.filter(r => String(r.outcome || "").trim().toUpperCase() === "WIN").length;
  const lostCount = rows.filter(r => String(r.outcome || "").trim().toUpperCase() === "LOSS").length;
  const pendingCount = rows.filter(r => String(r.outcome || "").trim().toUpperCase() === "PENDING").length;
  const notSubmittedCount = rows.filter(r => !String(r.selection || r.team || "").trim()).length;

  const stats = getGwReportStatsFromRows_(rows);

  const playersEl = document.getElementById("gwReportModalPlayers");
  const playersDotsEl = document.getElementById("gwReportModalPlayersDots");
  const summaryEl = document.getElementById("gwReportModalSummary");

  if (playersEl) playersEl.textContent = String(stats.alivePlayers);
  if (playersDotsEl) playersDotsEl.style.display = "none";

  if (summaryEl) {
    const summaryItems = [
      `<span class="gw-summary-item gw-summary-won">Won: <strong>${wonCount}</strong></span>`,
      `<span class="gw-summary-item gw-summary-lost">Lost: <strong>${lostCount}</strong></span>`,
    ];

    if (pendingCount > 0) {
      summaryItems.push(`<span class="gw-summary-item gw-summary-muted">Pending: <strong>${pendingCount}</strong></span>`);
    }

    if (notSubmittedCount > 0) {
      summaryItems.push(`<span class="gw-summary-item gw-summary-muted">Not submitted: <strong>${notSubmittedCount}</strong></span>`);
    }

    summaryEl.innerHTML = summaryItems.join(`<span class="gw-summary-sep">•</span>`);
  }

  const tbodyHtml = rows.map(r => {
    const name = r.name || r.email || "—";
    const club = simplifyClub_(r.clubTeam || "—");
    const sel = String(r.selection || "").trim();
    const hasSelection = !!sel;

    const outcomeRaw = String(r.outcome || "").trim().toUpperCase();
    const outcomeForDisplay = hasSelection ? outcomeRaw : "";
    const resLabel = hasSelection ? outcomeLabel_(outcomeForDisplay) : "TBC";
    const resCls = hasSelection ? outcomeCls_(outcomeForDisplay) : "tbc";

    return `
      <tr>
        <td title="${escapeAttr(name)}">${escapeHtml(name)}</td>
        <td class="muted" title="${escapeAttr(club)}">${escapeHtml(club)}</td>
        <td class="gw-cell-selection">
          ${hasSelection
        ? teamInlineHtml_(sel, { size: 12, logoPosition: "before" })
        : `<span class="muted">Not submitted</span>`
      }
        </td>
        <td class="gw-cell-result">
          <span class="gw-result ${resCls}">${escapeHtml(resLabel)}</span>
        </td>
      </tr>
    `;
  }).join("");

  const tbody = bodyEl.querySelector(".gw-table tbody");
  if (tbody) {
    tbody.innerHTML = tbodyHtml || `<tr><td colspan="4" class="muted small" style="padding:10px 6px;">No selections.</td></tr>`;
  }
}

function showPickConfirmModal_(team, gwId) {
  const canonicalTeam = getCanonicalTeamName_(team);
  if (isPlaceholderTeam_(canonicalTeam)) {
    showFixturesMessage("You cannot queue a selection until the team is confirmed.", "bad");
    setBtnLoading(submitPickBtn, false);
    return;
  }
  const existingPick = getPickForGw(gwId);
  const isChangingPick = !!existingPick?.team && !areTeamsSame_(existingPick.team, canonicalTeam);
  const queueMode = isQueuePicksGame_();
  const futureGw = isFutureGw_(gwId);
  const isQueuedPick = queueMode && futureGw;

  if (isQueuedPick && !canQueueGw_(gwId)) {
    showFixturesMessage("You can only queue group stage selections for now.", "bad");
    setBtnLoading(submitPickBtn, false);
    return;
  }

  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) {
    setBtnLoading(submitPickBtn, false);
    return;
  }

  const fx = findFixtureForTeam(gw, canonicalTeam);
  if (!fx) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("Match not found for this gameweek.", "bad");
    return;
  }

  if (isFixtureResolved_(fx)) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("That fixture has already finished.", "bad");
    return;
  }

  const kickoffText = fx.kickoffHasTime
    ? `${formatDateWithOrdinalShortUK(fx.kickoff)} - ${formatTimeUK(fx.kickoff)}`
    : `${formatDateWithOrdinalShortUK(fx.kickoff)}`;

  showConfirmModal_(
    isChangingPick
      ? `<span>Change ${isQueuedPick ? "queued " : ""}selection to:</span> <strong>${escapeHtml(canonicalTeam)}?</strong>`
      : isQueuedPick
        ? `<span>Queue selection for ${escapeHtml(gwLabelShort(gwId))}:</span> <strong>${escapeHtml(canonicalTeam)}?</strong>`
        : `<span>Confirm selection:</span> <strong>${escapeHtml(canonicalTeam)}?</strong>`,
    `
      <div style="margin-top:10px;">
        <div class="fixture-row">
          <div class="fixture-main">
            ${fixtureTeamsHtml_(fx.home, fx.away, { highlightTeam: canonicalTeam })}
            <div class="fixture-datetime muted">${escapeHtml(kickoffText)}</div>
          </div>
        </div>
      </div>
    `,
    {
      confirmText: isChangingPick
        ? "Confirm change"
        : isQueuedPick
          ? "Queue selection"
          : "Confirm",
      cancelText: "Cancel",
      onConfirm: async (confirmBtn) => {
        await savePick(canonicalTeam, gwId);
      }
    }
  );
}


function getActiveGame_() {
  return (gamesList || []).find(g => String(g.id || "") === String(activeGameId || "")) || null;
}

function getEntriesViewGwId_() {
  return String(computeDateGwId() || currentGwId || gameweeks[0]?.id || "GW1").toUpperCase();
}

function formatGameDeadlineText_(value) {
  if (!value) return "—";

  const raw = String(value).trim();

  // If it's already plain text from sheets, return as-is
  if (isNaN(Date.parse(raw)) && !raw.includes("T")) {
    return raw;
  }

  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(d);

  const weekday = parts.find(p => p.type === "weekday")?.value || "";
  const dayNum = Number(parts.find(p => p.type === "day")?.value || "0");
  const month = parts.find(p => p.type === "month")?.value || "";
  const hour = parts.find(p => p.type === "hour")?.value || "";
  const minute = parts.find(p => p.type === "minute")?.value || "00";
  const dayPeriod = (parts.find(p => p.type === "dayPeriod")?.value || "").toLowerCase();

  const suffix =
    (dayNum % 100 >= 11 && dayNum % 100 <= 13) ? "th" :
      (dayNum % 10 === 1) ? "st" :
        (dayNum % 10 === 2) ? "nd" :
          (dayNum % 10 === 3) ? "rd" : "th";

  return `${weekday} ${dayNum}${suffix} ${month} - ${hour}:${minute}${dayPeriod}`;
}

function formatOrdinal_(n) {
  const x = Number(n);
  if (!isFinite(x)) return "";
  const v = x % 100;
  if (v >= 11 && v <= 13) return `${x}th`;
  switch (x % 10) {
    case 1: return `${x}st`;
    case 2: return `${x}nd`;
    case 3: return `${x}rd`;
    default: return `${x}th`;
  }
}

function getWinnerLineHtml_(winner, remainingCount) {
  const winnerText = String(winner || "").trim();
  const remaining = Number(remainingCount || 0);

  if (winnerText) {
    const label = winnerText.includes(",") ? "Winners" : "Winner";
    return `${label}: <strong>${escapeHtml(winnerText)}</strong>`;
  }

  if (remaining === 0) {
    return `No winner - <strong>prize rollover</strong>`;
  }

  return "";
}

function getCurrentActualGwIdForGame_(game) {
  const relevantGameweeks = getGameweeksForGame_(game);
  if (!relevantGameweeks.length) return null;

  const nowMs = Date.now();

  const inProgress = relevantGameweeks.find(gw =>
    nowMs >= gw.deadline.getTime() && nowMs < gw.endCutoff.getTime()
  );
  if (inProgress) return inProgress.id;

  const upcoming = relevantGameweeks.find(gw => nowMs < gw.deadline.getTime());
  if (upcoming) return upcoming.id;

  return relevantGameweeks[relevantGameweeks.length - 1]?.id || null;
}

function getLastStartedActualGwIdForGame_(game) {
  const relevantGameweeks = getGameweeksForGame_(game);
  if (!relevantGameweeks.length) return null;

  const nowMs = Date.now();
  const started = relevantGameweeks.filter(gw => nowMs >= gw.deadline.getTime());

  if (!started.length) return relevantGameweeks[0]?.id || null;
  return started[started.length - 1]?.id || null;
}

function getFinishedGwIdForGame_(game) {
  const explicit = String(
    game?.endGw || game?.finishedGw || game?.lastGw || ""
  ).trim().toUpperCase();

  if (explicit) return explicit;

  const relevantGameweeks = getGameweeksForGame_(game);
  if (!relevantGameweeks.length) {
    return String(game?.startGw || "GW1").toUpperCase();
  }

  const nowMs = Date.now();

  const completed = relevantGameweeks.filter(gw =>
    nowMs >= gw.endCutoff.getTime()
  );
  if (completed.length) return completed[completed.length - 1].id;

  const started = relevantGameweeks.filter(gw =>
    nowMs >= gw.deadline.getTime()
  );
  if (started.length) return started[started.length - 1].id;

  return relevantGameweeks[0].id;
}

function getLobbyRunningStatusText_(game) {
  const gameId = String(game?.id || "");
  const counts = lobbyCountsByGame[gameId];

  const hasRealCounts =
    counts &&
    counts.remaining != null &&
    counts.total != null;

  const remaining = Number(counts?.remaining);
  const total = Number(counts?.total);

  if (hasRealCounts && total > 0 && remaining === 1) {
    const finishedGwId = getFinishedGwIdForGame_(game);
    return `Finished: ${getDisplayGwIdForGame_(finishedGwId, game)}`;
  }

  const actualGwId = getCurrentActualGwIdForGame_(game) || game?.startGw || "GW1";
  return `Running: ${getDisplayGwIdForGame_(actualGwId, game)}`;
}

function getGameBannerStatusText_(game, entry) {
  const rawStatus = String(game?.status || "").toUpperCase();
  const firstGw = getGameFirstGw_(game);
  const nowMs = Date.now();

  const firstDeadlinePassed = !!firstGw && nowMs >= firstGw.deadline.getTime();
  const registrationOpenNow = isGameRegistrationOpenNow_(game);
  const lateRegistrationOpen = isGameLateRegistrationOpen_(game);

  if (rawStatus === "FINISHED") {
    return `Finished: ${getDisplayGwIdForGame_(getFinishedGwIdForGame_(game), game)}`;
  }

  if (entry && !entry.approved) {
    return "Pending";
  }

  if (entry && entry.approved) {
    if (firstDeadlinePassed) {
      return getLobbyRunningStatusText_(game);
    }
    return "Registered";
  }

  if (!entry) {
    if (lateRegistrationOpen) return "Late reg";
    if (registrationOpenNow) return "Registering";
    return "Registering";
  }

  return "Registering";
}

function slugifyGameTitle_(title) {
  return String(title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyPersonNameForFile_(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getWinnerImageUrl_(gameId) {
  const id = String(gameId || "").trim();
  if (!id) return "";
  return `site/images/winners/${id}.jpg`;
}

function getPrizeDisplayText_(game) {
  const prizeInfo = parsePrizeInfo_(game?.prize);

  if (!prizeInfo.hasPrize) return "—";
  return prizeInfo.isRollover ? prizeInfo.badgeText : prizeInfo.displayAmount;
}

function escapeJsString_(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

function openWinnerPhotoModal_(gameTitle, winnerName, prizeText, imageUrl) {
  showSystemModal_(
    gameTitle,
    `
      <div style="line-height:1.5;">
        <div style="margin-bottom:6px;">
          <strong>Winner:</strong> ${escapeHtml(winnerName)}
        </div>

        <div style="margin-bottom:14px;">
          <strong>Prize:</strong> ${escapeHtml(prizeText)}
        </div>

        <div style="border-radius:16px;overflow:hidden;background:#111;">
          <img
            src="${escapeAttr(imageUrl)}"
            alt="${escapeAttr(winnerName)} winner image"
            style="display:block;width:100%;height:auto;"
            onerror="this.style.display='none'; this.insertAdjacentHTML('afterend','<div class=&quot;muted&quot; style=&quot;padding:16px;&quot;>Winner image not found.</div>');"
          />
        </div>
      </div>
    `,
    { showActions: false }
  );
}

function getGameBannerStatusClass_(game, entry) {
  const text = getGameBannerStatusText_(game, entry);

  if (text === "Pending") return "game-status-pill--running";
  if (text.startsWith("Running:")) return "game-status-pill--running";
  if (text.startsWith("Finished:")) return "game-status-pill--finished";

  return "game-status-pill--open";
}

function getPlayersBadgeHtml_(game, counts) {
  const gameId = String(game?.id || "");
  const status = String(game?.status || "").toUpperCase();
  const loading = !!lobbyCountsLoading[gameId] || !counts;

  if (loading) {
    const tooltip = status === "OPEN" ? "Players" : "Remaining";
    return `
      <span class="hero-pill-tooltip" data-tooltip="${tooltip}">
        <span class="pill-emoji">👤</span> ${dotsHtml_()}
      </span>
    `;
  }

  const registered = Number(counts?.registered || counts?.total || 0);
  const remaining = Number(counts?.remaining || 0);
  const total = Number(counts?.total || registered || 0);

  if (status === "OPEN") {
    return `
      <span class="hero-pill-tooltip" data-tooltip="Players">
        <span class="pill-emoji">👤</span> ${registered}
      </span>
    `;
  }

  return `
    <span class="hero-pill-tooltip" data-tooltip="Remaining">
      <span class="pill-emoji">👤</span> ${remaining}/${total}
    </span>
  `;
}

function renderGameTitleBox_() {
  const game = getActiveGame_();
  const entry = getMyEntryForGame_(activeGameId);

  const countsForBadge = lobbyCountsByGame[String(activeGameId || "")] || null;
  const counts = countsForBadge || {};

  const remainingCount = Number(counts?.remaining || 0);
  const totalCount = Number(counts?.total || 0);
  const isWinner = isEntryWinner_(entry, remainingCount);

  const playerNameEl = document.getElementById("gameTitlePlayerName");
  const metaEl = document.getElementById("gameTitleBoxMeta");
  const statusPillEl = document.getElementById("gameTitleStatusPill");
  const playersBadgeEl = document.getElementById("gameTitlePlayersBadge");
  const prizeBadgeEl = document.getElementById("gameTitlePrizeBadge");
  const rolloverBadgeEl = document.getElementById("gameTitleRolloverBadge");

  if (!playerNameEl || !metaEl || !statusPillEl || !playersBadgeEl || !prizeBadgeEl || !rolloverBadgeEl) return;

  if (!game) {
    playerNameEl.innerHTML = dotsHtml_();
    metaEl.innerHTML = `<div class="game-hero-meta-row">${dotsHtml_()}</div>`;
    statusPillEl.className = "game-status-pill hidden";
    playersBadgeEl.classList.add("hidden");
    prizeBadgeEl.classList.add("hidden");
    return;
  }

  const gameId = String(game.id || "").trim();
  const title = String(game.title || gameId || "Competition");
  const bio = String(game.bio || "").trim();
  const status = String(game.status || "OPEN").toUpperCase();
  const prizeInfo = parsePrizeInfo_(game?.prize);
  const entryFee = Number(game.entryFee || 0);
  const winner = String(game.winner || "").trim();

  const firstGw = getGameFirstGw_(game);
  const lateRegistrationOpen = isGameLateRegistrationOpen_(game);
  const deadlineIso = lateRegistrationOpen
    ? (firstGw?.lateDeadline ? firstGw.lateDeadline.toISOString() : "")
    : (firstGw?.deadline ? firstGw.deadline.toISOString() : "");
  const showCountdown = status === "OPEN" && !!deadlineIso;

  const bannerWrap = document.querySelector("#gameTitleBox .game-hero-banner");
  const bannerImg = document.querySelector("#gameTitleBox .game-hero-banner-img");

  const bannerSlug = slugifyGameTitle_(title);

  if (bannerWrap) {
    bannerWrap.className = "game-hero-banner";
    bannerWrap.classList.add(`${bannerSlug}-banner`);
  }

  if (bannerImg) {
    bannerImg.src = getGameBannerUrl_(gameId);
    bannerImg.alt = `${title} banner`;

    bannerImg.className = "game-hero-banner-img";
    bannerImg.classList.add(`${bannerSlug}-banner-img`);

    bannerImg.onerror = function () {
      this.onerror = null;
      this.src = "site/images/game-banners/default.png";
    };
  }

  playerNameEl.textContent = title;

  statusPillEl.className = "game-status-pill";
  statusPillEl.innerHTML = `
    <span class="hero-pill-tooltip" data-tooltip="Status">
      ${escapeHtml(getGameBannerStatusText_(game, entry))}
    </span>
  `;

  statusPillEl.classList.remove(
    "game-status-pill--open",
    "game-status-pill--running",
    "game-status-pill--finished"
  );

  statusPillEl.classList.add(getGameBannerStatusClass_(game, entry));

  playersBadgeEl.innerHTML = getPlayersBadgeHtml_(game, countsForBadge);
  playersBadgeEl.classList.remove("hidden");

  if (status === "OPEN") {
    prizeBadgeEl.innerHTML = `
    <span class="hero-pill-tooltip" data-tooltip="Entry fee">
      <span class="pill-emoji">🎟️</span> £${entryFee}
    </span>
  `;
    prizeBadgeEl.classList.remove("hidden");

    if (prizeInfo.isRollover) {
      rolloverBadgeEl.innerHTML = getRolloverPillHtml_(game);
      rolloverBadgeEl.classList.remove("hidden");
    } else {
      rolloverBadgeEl.innerHTML = "";
      rolloverBadgeEl.classList.add("hidden");
    }
  } else if (prizeInfo.hasPrize) {
    prizeBadgeEl.innerHTML = prizeInfo.isRollover
      ? ""
      : getPrizePillHtml_(game);

    if (prizeInfo.isRollover) {
      rolloverBadgeEl.innerHTML = getRolloverPillHtml_(game);
      rolloverBadgeEl.classList.remove("hidden");
      prizeBadgeEl.classList.add("hidden");
    } else {
      prizeBadgeEl.classList.remove("hidden");
      rolloverBadgeEl.innerHTML = "";
      rolloverBadgeEl.classList.add("hidden");
    }
  } else {
    prizeBadgeEl.innerHTML = "";
    prizeBadgeEl.classList.add("hidden");
    rolloverBadgeEl.innerHTML = "";
    rolloverBadgeEl.classList.add("hidden");
  }

  const statusText = !entry
    ? ""
    : status === "OPEN"
      ? (entry.approved ? "Registered" : "Pending")
      : isWinner
        ? "Winner"
        : entry.alive === false
          ? "Dead"
          : "Alive";

  const statusStateClass = !entry
    ? "muted"
    : status === "OPEN"
      ? (entry.approved ? "good" : "warn")
      : isWinner
        ? "good"
        : entry.alive === false
          ? "bad"
          : "good";

  const statusIcon = !entry
    ? "—"
    : status === "OPEN"
      ? (entry.approved ? "✓" : "…")
      : isWinner
        ? "🏆"
        : entry.alive === false
          ? "✕"
          : "✓";

  const finishedLine =
    status === "RUNNING" && entry?.alive === false && lastMyPlacing && lastMyTotalPlayers
      ? `<div class="lobby-meta-line">Finished: <strong>${lastMyPlacing}${ordinalSuffix_(lastMyPlacing)}</strong> of <strong>${lastMyTotalPlayers}</strong></div>`
      : "";

  if (status === "OPEN") {
    const playerUi = getPlayerStatusUi_(game, entry);
    const showGwReportBtn = hasCurrentGwPick_();

    metaEl.innerHTML = `
    ${bio ? `
      <div class="game-hero-bio">${escapeHtml(bio)}</div>
    ` : ``}

    <div class="lobby-status-actions-row" style="margin-top:12px;">
      ${entry ? `
        <div class="lobby-meta-line" style="margin:0;">
          <span class="lobby-meta-key">Your status:</span>
          <span class="player-status-pill ${playerUi.pillClass}">
            <span>${playerUi.text}</span>
            <span class="state ${playerUi.stateClass}">${playerUi.icon}</span>
          </span>
        </div>
      ` : `<div></div>`}

      <div class="lobby-card-actions" style="margin:0;">
        ${!entry || entry.approved ? `` : `
          <button id="gameTitlePayBtn" class="btn btn-primary" type="button">Payment details</button>
        `}
      </div>
    </div>
  `;

    document.getElementById("gameTitlePayBtn")?.addEventListener("click", () => {
      showPaymentDetailsModal_();
    });

    return;
  }

  if (status === "RUNNING") {
    const playerUi = getPlayerStatusUi_(game, entry);
    const showGwReportBtn = hasCurrentGwPick_();

    metaEl.innerHTML = `
    ${bio ? `
      <div class="game-hero-bio">${escapeHtml(bio)}</div>
    ` : ``}

    <div class="lobby-status-actions-row" style="margin-top:12px;">
      ${entry ? `
        <div class="lobby-meta-line" style="margin:0;">
          <span class="lobby-meta-key">Your status:</span>
          <span class="player-status-pill ${playerUi.pillClass}">
            <span>${playerUi.text}</span>
            <span class="state ${playerUi.stateClass}">${playerUi.icon}</span>
          </span>
        </div>
      ` : `<div></div>`}
    </div>
  `;

    return;
  }

  if (status === "FINISHED") {
    metaEl.innerHTML = `
      <div class="lobby-bottom-main">
        <div class="lobby-fit">
          <div class="lobby-fit-left">
            ${getWinnerLineHtml_(winner, counts?.remaining)
        ? `<div class="lobby-meta-line">${getWinnerLineHtml_(winner, counts?.remaining)}</div>`
        : ``
      }
          </div>
        </div>
      </div>
    `;
    return;
  }
}

async function renderGwReportCard_() {
  const card = document.getElementById("gwReportCard");
  if (!card) return;
  card.classList.add("hidden");
}

async function refreshMyPlacingIfDead_() {
  // only relevant if player is dead + we have an email
  if (!sessionUser?.email) return;
  if (sessionUser?.alive !== false) {
    lastMyPlacing = null;
    lastMyTotalPlayers = null;
    return;
  }

  // Use currentGwId (or knockedOutGw if you prefer)
  const gwForRank = sessionUser.knockedOutGw || currentGwId || gameweeks?.[0]?.id;
  if (!gwForRank) return;

  try {
    const { placing, total } = await computePlacingForEmail_(sessionUser.email, gwForRank);
    lastMyPlacing = placing;
    lastMyTotalPlayers = total;
  } catch {
    // leave as-is
  }
}

function hasCompetitionStarted_() {
  const firstGw = gameweeks[0];
  if (!firstGw) return false;
  return isGwLockedById_(firstGw.id);
}

function setSession(userOrEmail) {
  const payload = typeof userOrEmail === "string"
    ? { email: userOrEmail }
    : {
      email: userOrEmail?.email || "",
      firstName: userOrEmail?.firstName || "",
      lastName: userOrEmail?.lastName || "",
      phone: userOrEmail?.phone || "",
      clubTeam: userOrEmail?.clubTeam || "",
    };

  sessionEmail = payload.email || null;
  localStorage.setItem(LS_SESSION, JSON.stringify(payload));
}

function getSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionEmail = null;
  sessionUser = null;
  sessionPicks = [];
  usedTeams = new Set();

  myEntries = [];
  activeEntry = null;
  lastEntryApprovedByGame = {};

  localStorage.removeItem(LS_SESSION);
}

function now() {
  return new Date();
}

function displayTeamName_(name) {
  return getDisplayTeamName_(name);
}

function displayTeamNameForFixture_(name) {
  return getDisplayTeamName_(name);
}

function showPlayerModal_(title, html, { status = null, approved = true } = {}) {
  if (!playerModal || !playerModalBody) return;

  let statusPill = "";

  if (!approved) {
    statusPill = `<span class="player-status-pill pending" ><span>Pending</span><span class="state bad">…</span></span > `;
  } else if (status === "alive") {
    statusPill = `<span class="player-status-pill alive" ><span>Alive</span><span class="state good">✓</span></span > `;
  } else if (status === "dead") {
    statusPill = `<span class="player-status-pill dead" ><span>Dead</span><span class="state bad">✕</span></span > `;
  }

  playerModalBody.innerHTML = `
  <div class="player-modal-head" >
      <div class="player-modal-title">${escapeHtml(title)}</div>
      <div class="player-modal-status">${statusPill}</div>
    </div >
  <div class="modal-body" style="margin-top:6px;">${html}</div>
`;

  openModal(playerModal);
}

function hasGameStartedForUi_(game) {
  const firstGw = getGameFirstGw_(game);
  if (!firstGw?.deadline) return false;
  return Date.now() >= firstGw.deadline.getTime();
}



function getPlayerStatusUi_(game, entry) {
  const status = String(game?.status || "").toUpperCase();
  const counts = lobbyCountsByGame[String(game?.id || "")] || {};
  const remainingCount = Number(counts.remaining || 0);

  if (!entry) {
    return {
      text: "—",
      pillClass: "",
      stateClass: "muted",
      icon: "—"
    };
  }

  const approved = !!entry.approved;
  const dead = entry.alive === false;
  const winner = isEntryWinner_(entry, remainingCount);

  if (status === "OPEN") {
    return approved
      ? {
        text: "Registered",
        pillClass: "alive",
        stateClass: "good",
        icon: "✓"
      }
      : {
        text: "Pending",
        pillClass: "",
        stateClass: "warn",
        icon: "…"
      };
  }

  if (winner) {
    return {
      text: "Winner",
      pillClass: "alive",
      stateClass: "good",
      icon: "🏆"
    };
  }

  if (dead) {
    return {
      text: "Dead",
      pillClass: "dead",
      stateClass: "bad",
      icon: "✕"
    };
  }

  return {
    text: "Alive",
    pillClass: "alive",
    stateClass: "good",
    icon: "✓"
  };
}

function hasCurrentGwPick_() {
  const p = getPickForGw(currentGwId);
  return !!String(p?.team || "").trim();
}

async function goToLobby_() {
  if (deadlineInterval) {
    clearInterval(deadlineInterval);
    deadlineInterval = null;
  }

  if (profilePoll) {
    clearInterval(profilePoll);
    profilePoll = null;
  }

  activeGameId = null;
  activeEntry = null;

  showLobby_();
  renderLobby_();
  refreshLobbyCounts_().catch(() => { });
}

function dotsHtml_() {
  return `<span class="dots" aria-label="Loading"></span>`;
}


(function bindPrivacyModalOnce() {
  const btn = document.querySelector("[data-open-privacy]");
  const modal = document.getElementById("privacyModal");
  if (!btn || !modal || btn.dataset.bound) return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", () => openModal(modal));
})();


function upsertLocalPick(gwId, team, outcome = "PENDING") {
  const key = String(gwId || "").trim().toUpperCase();
  const existing = sessionPicks.find(p => String(p.gwId || "").trim().toUpperCase() === key);

  if (existing) {
    existing.team = team;
    existing.outcome = outcome;
    existing.submittedAt = new Date().toISOString();
  } else {
    sessionPicks.push({
      gwId: key,
      team,
      outcome,
      submittedAt: new Date().toISOString()
    });
  }
}

function getTeamsForGw_(gwId) {
  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );

  if (!gw) return [];

  return (gw.fixtures || [])
    .flatMap(f => [f.home, f.away])
    .filter(Boolean)
    .filter(t => !isPlaceholderTeam_(t));
}

function getCurrentInputTargetGwId_() {
  return String(
    submitPickBtn?.dataset?.queueGwId ||
    getNextSelectionTargetGwId_() ||
    currentGwId ||
    ""
  ).toUpperCase();
}

function getTeamsForGw_(gwId) {
  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );

  if (!gw) return [];

  const teams = new Set();

  for (const f of gw.fixtures || []) {
    if (f.home && !isPlaceholderTeam_(f.home)) teams.add(getCanonicalTeamName_(f.home));
    if (f.away && !isPlaceholderTeam_(f.away)) teams.add(getCanonicalTeamName_(f.away));
  }

  return Array.from(teams).sort((a, b) => a.localeCompare(b));
}

function getTeamsForCurrentInput_() {
  const targetGwId = getCurrentInputTargetGwId_();

  if (isQueuePicksGame_() && targetGwId !== currentGwId) {
    return getTeamsForGw_(targetGwId);
  }

  return getTeamsForSelectedGw();
}

function getTeamsForSelectedGw() {
  const gw = gameweeks.find(g => g.id === currentGwId);
  if (!gw) return [];

  const pick = getPickForGw(currentGwId);
  if (pick?.team) return [];

  if (canLateSubmitCurrentGw_()) {
    return getUnstartedTeamsForGw_(currentGwId);
  }

  if (currentGwLocked()) return [];

  const teams = new Set();
  for (const f of gw.fixtures) {
    teams.add(getCanonicalTeamName_(f.home));
    teams.add(getCanonicalTeamName_(f.away));
  }

  return Array.from(teams).sort((a, b) => a.localeCompare(b));
}

function updateTeamDatalist() {
  if (!teamsDatalist) return;
  teamsDatalist.innerHTML = "";
  const teams = getTeamsForCurrentInput_();
  for (const t of teams) {
    const opt = document.createElement("option");
    opt.value = t;
    teamsDatalist.appendChild(opt);
  }
}

const teamSuggest = document.getElementById("teamSuggest");

function renderSuggestions() {
  if (!teamSuggest) return;

  const q = (teamSearch?.value || "").trim().toLowerCase();
  const teams = getTeamsForCurrentInput_();

  if (!q) {
    teamSuggest.classList.add("hidden");
    teamSuggest.innerHTML = "";
    return;
  }

  const hits = teams
    .filter(t => {
      const terms = getTeamSearchTerms_(t).map(x => String(x).toLowerCase());
      return terms.some(term => term.includes(q));
    })
    .slice(0, 8);

  if (!hits.length) {
    teamSuggest.classList.add("hidden");
    teamSuggest.innerHTML = "";
    return;
  }

  teamSuggest.innerHTML = hits.map(t => `
  <button type = "button" class="suggest-item" data-team="${escapeAttr(t)}" > ${escapeHtml(t)}</button >
    `).join("");

  teamSuggest.classList.remove("hidden");

  teamSuggest.querySelectorAll(".suggest-item").forEach(btn => {
    btn.addEventListener("click", () => {
      teamSearch.value = btn.getAttribute("data-team");
      teamSuggest.classList.add("hidden");
      teamSuggest.innerHTML = "";
      teamSearch.focus();
    });
  });
}

teamSearch?.addEventListener("input", renderSuggestions);
teamSearch?.addEventListener("focus", renderSuggestions);
document.addEventListener("click", (e) => {
  if (!teamSuggest) return;
  if (e.target === teamSearch || teamSuggest.contains(e.target)) return;
  teamSuggest.classList.add("hidden");
});

document.addEventListener("click", e => {
  const pill = e.target.closest(".hero-pill-tooltip");

  document.querySelectorAll(".hero-pill-tooltip.active")
    .forEach(p => p.classList.remove("active"));

  if (pill) {
    pill.classList.add("active");

    setTimeout(() => {
      pill.classList.remove("active");
    }, 2000);
  }
});


function setGwLabelFromSelected() {
  const gw = gameweeks.find(g => g.id === currentGwId);
  if (!gw) return;

  const title = `Gameweek ${gw.num} `;

  const lastKickoff = gw.fixtures[gw.fixtures.length - 1]?.kickoff || gw.firstKickoff;
  const endDay = startOfDay(lastKickoff);

  // 🔁 CHANGE THIS LINE
  const range = `${formatDateWithOrdinalShortUK(gw.start)} - ${formatDateWithOrdinalShortUK(endDay)} `;

  if (gwTitleEl) gwTitleEl.textContent = title;
  if (gwRangeEl) gwRangeEl.textContent = range;
}



const UK_TZ = "Europe/London";

function formatDateUK(d) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function formatTimeUK(d) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d);
}

function formatDateWithOrdinalShortUK(d) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(d);

  const weekday = parts.find(p => p.type === "weekday")?.value || "";
  const month = parts.find(p => p.type === "month")?.value || "";
  const dayNum = Number(parts.find(p => p.type === "day")?.value || "0");

  const suffix =
    (dayNum % 100 >= 11 && dayNum % 100 <= 13) ? "th" :
      (dayNum % 10 === 1) ? "st" :
        (dayNum % 10 === 2) ? "nd" :
          (dayNum % 10 === 3) ? "rd" : "th";

  return `${weekday} ${dayNum}${suffix} ${month} `;
}


function formatKickoffLineUK(d) {
  // "Sat 31 Jan, 15:00"
  const day = formatDateUK(d);
  const time = formatTimeUK(d);
  return `${day}, ${time} `;
}

function handleAccountStateChange_() {
  if (!sessionUser?.email) return;

  const emailKey = String(sessionUser.email).toLowerCase();
  const approvedNow = !!sessionUser.approved;

  if (lastApprovedState === null) {
    lastApprovedState = approvedNow;
    return;
  }

  // pending -> approved
  if (approvedNow && lastApprovedState === false) {
    const k = KEY_SESSION_SEEN_VERIFIED(emailKey);
    if (sessionStorage.getItem(k) !== "1") {
      sessionStorage.setItem(k, "1");

      const approvedEntry = (myEntries || []).find(e => !!e?.approved);
      const approvedGame = (gamesList || []).find(g =>
        String(g.id || "") === String(approvedEntry?.gameId || "")
      );
      const gameTitle = String(
        approvedGame?.title || getActiveGame_()?.title || "this game"
      ).trim();

      showSystemModal_(
        "Registration approved ✅",
        `
          <div style="line-height:1.5;">
            <p style="margin-top: 18px;"><strong>You have been approved for the ${escapeHtml(gameTitle)} game.</strong></p>
            <p style="margin:0;">You can now enter and make your first selection.</p>
          </div>
        `,
        { showActions: false }
      );

      renderLobby_();
      renderGameTitleBox_();
    }
  }

  lastApprovedState = approvedNow;
}

function resetPickInputUi_() {
  if (teamSearch) teamSearch.value = "";
  if (teamSuggest) {
    teamSuggest.classList.add("hidden");
    teamSuggest.innerHTML = "";
  }
  hideFixturesMessage();
}

function isResolvedOutcome_(o) {
  const out = String(o || "").toUpperCase();
  return out === "WIN" || out === "LOSS";
}

function getLatestResolvedPick_() {
  const resolved = (sessionPicks || []).filter(p => isResolvedOutcome_(p.outcome));
  if (!resolved.length) return null;

  // Prefer gameweek order if possible
  resolved.sort((a, b) => {
    const ai = findGwIndexById(a.gwId);
    const bi = findGwIndexById(b.gwId);

    // If both are known, compare by GW index
    if (ai >= 0 && bi >= 0) return bi - ai;

    // Fallback: compare by submittedAt if present
    const at = Date.parse(a.submittedAt || "") || 0;
    const bt = Date.parse(b.submittedAt || "") || 0;
    if (at !== bt) return bt - at;

    // Final fallback: string compare gwId
    return String(b.gwId).localeCompare(String(a.gwId));
  });

  return resolved[0];
}

/**
 * Show the latest WIN/LOSS modal once per browser session.
 * This solves: "I refreshed and didn't see the modal" + "polling didn't catch transition"
 */



function setIconBtnLoading(btn, loading, loadingText = "Working…") {
  if (!btn) return;

  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("icon-loading");
    btn.innerHTML = `
  <span class="icon-spinner" aria - hidden="true" ></span >
    <span class="sr-only">${loadingText}</span>
`;
  } else {
    btn.disabled = false;
    btn.classList.remove("icon-loading");
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

function isWinner_() {
  if (!competitionOver || !winnerEmail || !sessionUser?.email) return false;
  return String(sessionUser.email).toLowerCase() === String(winnerEmail).toLowerCase();
}

function applyWinConditionUi_() {
  if (!isWinner_()) return;

  // Disable pick controls
  submitPickBtn && (submitPickBtn.disabled = true);
  teamSearch && (teamSearch.disabled = true);
  clearPickBtn && (clearPickBtn.disabled = true);

  // Hide edit pencil + both pick modes (so it never prompts another team)
  document.getElementById("editPickBtn")?.classList.add("hidden");
  document.getElementById("pickModeInput")?.classList.add("hidden");
  document.getElementById("pickModeSubmitted")?.classList.add("hidden");

  // Make the deadline area read "Competition finished" (if present)
  const timeLeftText = document.getElementById("timeLeftText");
  if (timeLeftText) timeLeftText.textContent = "Competition finished";

  // Show modal ONCE per device (or per browser session if you prefer sessionStorage)
  const k = KEY_WINNER_SEEN(sessionUser.email);
  if (localStorage.getItem(k) === "1") return;
  localStorage.setItem(k, "1");

  const game = getActiveGame_();
  const rawPrize = String(game?.prize ?? "").trim();
  const hasPrize = rawPrize !== "";
  const prize = Number(rawPrize || 0);

  showSystemModal_(
    "Congratulations 🎉",
    `
      <div style="line-height:1.5;">
        <p style="margin:0 0 10px;"><strong>You have won the game!</strong></p>
        ${hasPrize ? `<p style="margin:0;">Prize money: <strong>£${prize}</strong></p>` : ``}
      </div>
    `,
    { showActions: false }
  );
}

function isDeadUi_() {
  if (sessionUser?.alive === false) return true;
  const sig = latestOutcomeSig_();
  return !!sig && sig.endsWith("::LOSS");
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-close-modal]");
  if (!btn) return;

  const id = btn.getAttribute("data-close-modal");
  const modal = document.getElementById(id);
  if (modal) closeModal(modal);
});

let lastApprovedPlayers = null;
let lastPendingPlayers = null;

async function refreshRemainingPlayersCount() {
  const gameId = String(activeGameId || "");
  if (!gameId) return;

  const myReq = ++remainingReqId;

  remainingLoading = true;
  renderStatusBox();

  try {
    // 1. Firebase first
    const fast = await api({ action: "getGameCounts", gameId });

    if (myReq !== remainingReqId) return;

    if (fast?.counts && Number(fast.counts.registered || 0) > 0) {
      lobbyCountsByGame[gameId] = fast.counts;

      lastApprovedPlayers = Number(fast.counts.approved || 0);
      lastPendingPlayers = Number(fast.counts.pending || 0);
      lastRemainingPlayers = Number(fast.counts.remaining || 0);
      lastTotalPlayers = Number(fast.counts.total || fast.counts.registered || 0);

      return;
    }

    throw new Error("No Firebase counts returned");

  } catch (firebaseErr) {
    console.warn("Firebase game counts failed, falling back to Sheets", firebaseErr);

    try {
      const data = await api({ action: "getEntries", gameId, gwId: currentGwId });
      if (myReq !== remainingReqId) return;

      const users = Array.isArray(data.users) ? data.users : [];

      const approvedUsers = users.filter(u => isApproved_(u));
      const pendingUsers = users.filter(u => !isApproved_(u));
      const aliveApprovedUsers = approvedUsers.filter(u => u.alive);

      lastApprovedPlayers = approvedUsers.length;
      lastPendingPlayers = pendingUsers.length;
      lastRemainingPlayers = aliveApprovedUsers.length;
      lastTotalPlayers = users.length;

      lobbyCountsByGame[gameId] = {
        registered: users.length,
        approved: approvedUsers.length,
        pending: pendingUsers.length,
        remaining: aliveApprovedUsers.length,
        total: users.length
      };
    } catch {
      // ignore
    }

  } finally {
    remainingLoading = false;
    renderStatusBox();
    renderGameTitleBox_();
    applyWinConditionUi_();
  }
}

function payInstructionsHtml_({
  gameTitle = "Payment Test Game",
  paymentRef = "",
  entryFee = 10,
  loading = false,
  error = ""
} = {}) {
  const ref = String(paymentRef || "").trim();
  const hasRef = !!ref;

  const refLabel = loading
    ? "Generating payment reference..."
    : "Payment reference";

  return `
    <div class="payment-sheet-v3">
      <div class="payment-sheet-v3__header">
        <div class="payment-sheet-v3__title">Pay by bank transfer</div>
        <div class="payment-sheet-v3__fee">Entry fee: £${entryFee}</div>
      </div>
      <div class="payment-sheet-v3__eyebrow">
          Unique reference for automatic approval
      </div>
      <div class="payment-sheet-v3__section">
        <div class="payment-sheet-v3__ref-card ${loading ? "is-loading" : ""}">
          <div class="payment-sheet-v3__ref-label">${escapeHtml(refLabel)}</div>
          <div class="payment-sheet-v3__ref-value">
            ${loading ? `<span class="dots" aria-label="Loading"></span>` : (hasRef ? escapeHtml(ref) : "—")}
          </div>
        </div>
      </div>

      <div class="payment-sheet-v3__section payment-sheet-v3__section--tight">
        <button
          id="paymentCopyRefBtn"
          class="btn btn-primary payment-sheet-v3__primary"
          type="button"
          ${hasRef && !loading ? "" : "disabled"}
        >
          Copy reference
        </button>
      </div>

      <div class="payment-sheet-v3__section">
        <div class="payment-sheet-v3__bank-card">
          <div class="payment-sheet-v3__bank-row">
            <div class="payment-sheet-v3__bank-text">
              <div class="payment-sheet-v3__field-label">Account name</div>
              <div class="payment-sheet-v3__field-value">Nicholas Horne</div>
            </div>
            <button
              class="payment-icon-copy"
              type="button"
              data-copy-text="Nicholas Horne"
              aria-label="Copy account name"
              title="Copy account name"
            >
              ⧉
            </button>
          </div>

          <div class="payment-sheet-v3__bank-row">
            <div class="payment-sheet-v3__bank-text">
              <div class="payment-sheet-v3__field-label">Sort code</div>
              <div class="payment-sheet-v3__field-value">60-83-71</div>
            </div>
            <button
              class="payment-icon-copy"
              type="button"
              data-copy-text="60-83-71"
              aria-label="Copy sort code"
              title="Copy sort code"
            >
              ⧉
            </button>
          </div>

          <div class="payment-sheet-v3__bank-row">
            <div class="payment-sheet-v3__bank-text">
              <div class="payment-sheet-v3__field-label">Account number</div>
              <div class="payment-sheet-v3__field-value">78664226</div>
            </div>
            <button
              class="payment-icon-copy"
              type="button"
              data-copy-text="78664226"
              aria-label="Copy account number"
              title="Copy account number"
            >
              ⧉
            </button>
          </div>
        </div>
      </div>

      <div class="payment-sheet-v3__section payment-sheet-v3__section--tight">
        <button
          id="paymentCheckStatusBtn"
          class="btn btn-secondary payment-sheet-v3__secondary"
          type="button"
          ${hasRef && !loading ? "" : "disabled"}
        >
          Check approval status
        </button>
      </div>

      <div class="payment-sheet-v3__section payment-sheet-v3__section--tight">
        <button
          id="paymentCancelBtn"
          class="btn btn-ghost payment-sheet-v3__ghost"
          type="button"
        >
          Cancel registration
        </button>
      </div>

      <div id="paymentSheetMsg" class="msg hidden" style="margin-top:10px;"></div>
    </div>
  `;
}

function getGameFirstGw_(game) {
  const gws = getGameweeksForGame_(game);
  return gws[0] || null;
}

async function refreshAccountProfile_() {
  const sess = getSession();
  if (!sess?.email) return;

  sessionUser = {
    email: sess.email,
    firstName: sess.firstName || "",
    lastName: sess.lastName || "",
    phone: sess.phone || "",
    clubTeam: sess.clubTeam || ""
  };
}

function showConfirmModal_(title, html, { confirmText = "Confirm", cancelText = "Cancel", onConfirm } = {}) {
  const titleEl = document.getElementById("systemModalTitle");
  const bodyEl = document.getElementById("systemModalBody");
  const modalEl = document.getElementById("systemModal");
  const actionsEl = document.getElementById("systemModalActions");

  if (!titleEl || !bodyEl || !modalEl) {
    setBtnLoading(submitPickBtn, false);
    return;
  }

  closeAllModals();

  titleEl.innerHTML = title || "";

  bodyEl.innerHTML = `
    ${html || ""}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-ghost" type="button" id="sysCancelBtn">${cancelText}</button>
      <button class="btn btn-primary" type="button" id="sysConfirmBtn">${confirmText}</button>
    </div>
  `;

  if (actionsEl) {
    actionsEl.classList.add("hidden");
    actionsEl.hidden = true;
    actionsEl.style.display = "none";
    actionsEl.innerHTML = "";
  }

  const cancelBtn = document.getElementById("sysCancelBtn");
  const confirmBtn = document.getElementById("sysConfirmBtn");

  cancelBtn.onclick = () => {
    closeModal(modalEl);
    setBtnLoading(submitPickBtn, false);
  };

  confirmBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("Confirm modal clicked");

    setBtnLoading(confirmBtn, true);
    cancelBtn.disabled = true;

    try {
      await onConfirm?.(confirmBtn);
    } catch (err) {
      console.warn("Confirm modal action failed", err);
      setBtnLoading(confirmBtn, false);
      cancelBtn.disabled = false;
      showFixturesMessage(String(err.message || err), "bad");
    }
  };

  openModal(modalEl);
}

function showSystemModal_(title, html, { showActions = true, variant = "default" } = {}) {
  const systemModal = document.getElementById("systemModal");
  const titleEl = document.getElementById("systemModalTitle");
  const bodyEl = document.getElementById("systemModalBody");
  const actionsEl = document.getElementById("systemModalActions");
  const cardEl = systemModal?.querySelector(".modal-card");

  if (!systemModal || !titleEl || !bodyEl || !actionsEl || !cardEl) return;

  closeAllModals();

  titleEl.textContent = title || "";
  bodyEl.innerHTML = html || "";

  systemModal.classList.remove("modal-sheet");
  cardEl.classList.remove("modal-card--sheet");
  bodyEl.classList.remove("system-modal-body--sheet");
  titleEl.classList.remove("system-modal-title--hidden");

  if (variant === "sheet") {
    systemModal.classList.add("modal-sheet");
    cardEl.classList.add("modal-card--sheet");
    bodyEl.classList.add("system-modal-body--sheet");

    if (!title) {
      titleEl.classList.add("system-modal-title--hidden");
    }
  }

  if (showActions) {
    actionsEl.classList.remove("hidden");
    actionsEl.hidden = false;
    actionsEl.style.display = "flex";
  } else {
    actionsEl.classList.add("hidden");
    actionsEl.hidden = true;
    actionsEl.style.display = "none";
    actionsEl.innerHTML = "";
  }

  openModal(systemModal);
}

function setSystemModalVariant_(variant = "default") {
  const modal = document.getElementById("systemModal");
  const card = modal?.querySelector(".modal-card");
  if (!modal || !card) return;

  modal.classList.remove("modal-sheet");
  card.classList.remove("modal-card--sheet");

  if (variant === "sheet") {
    modal.classList.add("modal-sheet");
    card.classList.add("modal-card--sheet");
  }
}




function latestOutcomeSig_() {
  const resolved = (sessionPicks || []).filter(p => p.outcome === "WIN" || p.outcome === "LOSS");
  if (!resolved.length) return null;

  resolved.sort((a, b) => findGwIndexById(b.gwId) - findGwIndexById(a.gwId));
  const p = resolved[0];
  return `${p.gwId}::${p.outcome}`;
}

function showWinModal_(pick) {
  const nextGwId = getNextGwId(pick.gwId);
  showSystemModal_(
    "Congratulations ✅",
    `
    <div style="line-height:1.45;">
      <div class="muted small" style="margin-bottom:10px;">
        Your selection won — you’re through.
      </div>

      <div class="status-row win" style="margin:0 0 12px 0;">
        <div class="status-left" style="display:flex;align-items:center;gap:10px;">
          ${teamInlineHtml_(pick.team, { size: 22, logoPosition: "before" })}
        </div>
        <div class="state good">✓</div>
      </div>

      ${nextGwId
      ? `<div style="margin:0;">Now select for <strong>${escapeHtml(gwLabelShort(nextGwId))}</strong>.</div>`
      : `<div style="margin:0;">No further gameweeks available.</div>`
    }
    </div>
  `,
    { showActions: false }
  );

}

function showLoseModal_() {
  // Try to use the latest resolved LOSS pick if we have it
  const p = getLastResolvedPick();

  const gwId =
    p?.gwId ||
    sessionUser?.knockedOutGw ||
    currentGwId ||
    "—";

  const team =
    p?.team ||
    sessionUser?.knockedOutTeam ||
    "—";

  showSystemModal_(
    "Unlucky — you’re out 💔",
    `
      <div style="line-height:1.5;">

        <div class="status-row loss" style="margin:10px 0 10px;">
          <div style="display:flex;align-items:center;gap:4px;">
            <div style="font-weight:900;font-size:18px;">
              ${teamInlineHtml_(team, { size: 22, logoPosition: "before" })}
            </div>
          </div>

          <div class="state bad">✕</div>
        </div>

        <div class="muted small">
          Your team failed to win — you’re out. Thanks for playing — better luck next time.
        </div>
      </div>
    `,
    { showActions: false }
  );
}


/**
 * Call this right after refreshProfile() and also on initial load.
 * It updates UI first, then opens exactly one modal if a NEW resolution happened.
 */
function applyOutcomeEffects_({ allowModal = true } = {}) {
  renderStatusPill();
  renderStatusBox();
  renderPaymentDetailsCard_();
  renderCurrentPickBlock();
  renderPickCardState();

  if (!allowModal || !sessionUser?.email) return false;

  const sig = latestOutcomeSig_();
  if (!sig) return false;

  const [gwId, outcome] = sig.split("::");
  const pick = (sessionPicks || []).find(p => p.gwId === gwId);

  // Don't show the WIN modal if the player has already submitted for the next GW
  if (outcome === "WIN" && pick) {
    const nextGwId = getNextGwId(gwId);
    const alreadyPickedNextGw = !!(nextGwId && (sessionPicks || []).some(p =>
      String(p.gwId || "").toUpperCase() === String(nextGwId).toUpperCase() &&
      String(p.team || "").trim()
    ));

    if (alreadyPickedNextGw) {
      const suppressKey = KEY_SEEN_OUTCOME_SIG(sessionUser.email);
      sessionStorage.setItem(suppressKey, sig);
      return false;
    }
  }

  const k = KEY_SEEN_OUTCOME_SIG(sessionUser.email);
  if (sessionStorage.getItem(k) === sig) return false;
  sessionStorage.setItem(k, sig);

  if (outcome === "WIN" && pick) {
    showWinModal_(pick);
    return true;
  }

  if (outcome === "LOSS") {
    showLoseModal_();
    return true;
  }

  return false;
}


function setIconBtnBusyText_(btn, busy, busyText = "…") {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("is-busy");
    btn.innerHTML = busyText; // no spinner, just …
  } else {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
  }
}


function showPaymentDetailsModal_(gameId = activeGameId) {
  const game = (gamesList || []).find(g => String(g.id || "") === String(gameId || ""));
  const entryFee = Number(game?.entryFee || 10);
  const entry = getMyEntryForGame_(gameId);

  if (entry && isApproved_(entry)) {
    enterGame_(gameId);
    return;
  }

  if (isPaymentWorkflowGame_(gameId)) {
    const paymentRef = getStoredPaymentRef_(gameId);
    showPaymentWorkflowModal_(gameId, paymentRef);
    return;
  }

  showSystemModal_(
    "",
    payInstructionsHtml_({
      gameTitle: String(game?.title || "Competition").trim(),
      paymentRef: "",
      entryFee
    }),
    { showActions: true }
  );

  const titleEl = document.getElementById("systemModalTitle");
  if (titleEl) titleEl.textContent = "";
}

function bindPaymentSheetActions_({ gameId, paymentRef }) {
  document.querySelectorAll("[data-copy-text]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy-text") || "";
      const original = btn.innerHTML;
      const ok = await copyTextSafe_(text);

      btn.innerHTML = ok ? "✓" : "!";
      btn.disabled = true;

      setTimeout(() => {
        btn.innerHTML = original;
        btn.disabled = false;
      }, 1000);
    });
  });

  document.getElementById("paymentCopyRefBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("paymentCopyRefBtn");
    const original = btn.textContent;
    const ok = await copyTextSafe_(paymentRef);

    btn.textContent = ok ? "Copied" : "Copy failed";

    setTimeout(() => {
      btn.textContent = original;
    }, 1200);
  });

  document.getElementById("paymentCheckStatusBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("paymentCheckStatusBtn");
    const msg = document.getElementById("paymentSheetMsg");
    if (!btn || !msg || !sessionEmail || !gameId) return;

    setBtnLoading(btn, true);

    try {
      await fetchMyEntries_();

      const entry = getMyEntryForGame_(gameId);

      if (entry && isApproved_(entry)) {
        btn.textContent = "Approved ✓";
        btn.disabled = true;

        snapshotLobbyApprovalStates_();
        await refreshLobbyCounts_().catch(() => { });
        renderLobby_();

        showSystemModal_(
          "",
          `
            <div class="payment-sheet-v3">
              <div class="payment-status-card payment-status-card--approved" style="margin-bottom:14px;">
                <div class="payment-status-card__icon">✓</div>
                <div class="payment-status-card__content">
                  <div class="payment-status-card__title">Registration approved</div>
                  <div class="payment-status-card__text">
                    Your payment has been matched successfully.
                  </div>
                </div>
              </div>

              <div style="
                padding:14px;
                border-radius:16px;
                background:rgba(255,255,255,0.06);
                border:1px solid rgba(255,255,255,0.08);
                line-height:1.45;
                margin-bottom:14px;
              ">
                You can now make your first selection.
              </div>

              <button
                type="button"
                id="approvedContinueBtn"
                class="btn btn-primary payment-sheet-v3__primary"
                style="width:100%;"
              >
                Continue
              </button>
            </div>
          `,
          { showActions: false, variant: "sheet" }
        );

        document.getElementById("approvedContinueBtn")?.addEventListener("click", async () => {
          closeModal(systemModal);
          await enterGame_(gameId);
        }, { once: true });

        return;
      }

      msg.innerHTML = `
      <div class="payment-status-card payment-status-card--pending">
        <div class="payment-status-card__icon">…</div>
        <div class="payment-status-card__content">
          <div class="payment-status-card__title">Not ready yet</div>
          <div class="payment-status-card__text">
            We have not matched your payment yet. Please wait a few seconds and try again. This can take up to 2 minutes. 
          </div>
        </div>
      </div>

      <button
        type="button"
        id="paidDifferentReferenceBtn"
        class="btn btn-ghost"
        style="margin-top:10px;width:100%;"
      >
        I paid with a different reference
      </button>
    `;

      document.getElementById("paidDifferentReferenceBtn")?.addEventListener("click", () => {
        msg.innerHTML = `
        <div class="payment-status-card payment-status-card--pending">
          <div class="payment-status-card__icon">…</div>
          <div class="payment-status-card__content">
            <div class="payment-status-card__title">Manual approval needed</div>
            <div class="payment-status-card__text">
              Please wait for manual approval.
            </div>
          </div>
        </div>
      `;

        msg.classList.remove("hidden", "good");
        msg.classList.add("bad");
      });

      msg.classList.remove("hidden", "good");
      msg.classList.add("bad");

    } catch (err) {
      msg.innerHTML = `
      <div class="payment-status-card payment-status-card--pending">
        <div class="payment-status-card__icon">…</div>
        <div class="payment-status-card__content">
          <div class="payment-status-card__title">Not ready yet</div>
          <div class="payment-status-card__text">
            We could not check your payment status. Please wait a few seconds and try again.
          </div>
        </div>
      </div>
    `;

      msg.classList.remove("hidden", "good");
      msg.classList.add("bad");
    } finally {
      setBtnLoading(btn, false);
    }
  });

  document.getElementById("paymentCancelBtn")?.addEventListener("click", async () => {
    if (!sessionEmail || !gameId) return;

    const confirmed = window.confirm("Are you sure you want to cancel your registration?");
    if (!confirmed) return;

    const btn = document.getElementById("paymentCancelBtn");
    if (!btn) return;

    setBtnLoading(btn, true);

    try {
      await api({
        action: "leaveGame",
        email: sessionEmail,
        gameId
      });

      localStorage.removeItem(paymentRefStorageKey_(gameId));

      await fetchMyEntries_();
      snapshotLobbyApprovalStates_();
      renderLobby_();
      refreshLobbyCounts_().catch(() => { });

      closeModal(systemModal);
    } catch (err) {
      const msg = document.getElementById("paymentSheetMsg");
      if (msg) {
        msg.textContent = String(err.message || err);
        msg.classList.remove("hidden", "good");
        msg.classList.add("bad");
      }
    } finally {
      setBtnLoading(btn, false);
    }
  });
}

function showPaymentWorkflowModal_(gameId, paymentRef = "", { loading = false, error = "" } = {}) {
  const game = (gamesList || []).find(g => String(g.id || "") === String(gameId || ""));
  const title = String(game?.title || "Payment Test Game").trim();
  const entryFee = Number(game?.entryFee || 10);

  showSystemModal_(
    "",
    payInstructionsHtml_({
      gameTitle: title,
      paymentRef,
      entryFee,
      loading,
      error
    }),
    { showActions: false, variant: "sheet" }
  );

  const titleEl = document.getElementById("systemModalTitle");
  if (titleEl) titleEl.textContent = "";

  bindPaymentSheetActions_({ gameId, paymentRef });
}



function showVerifiedModalOnce_() {
  if (!sessionUser?.email || !sessionUser.approved) return;
  const emailKey = String(sessionUser.email).toLowerCase();
  const k = `seen_verified_once::${emailKey}`;
  if (localStorage.getItem(k) === "1") return;
  localStorage.setItem(k, "1");

  showSystemModal_(
    "Verification complete ✅",
    `
      <div style="line-height:1.5;">
        <p style="margin:0 0 10px;"><strong>Your account is now approved.</strong></p>
        <p style="margin:0;">You can now submit your first team selection.</p>
      </div>
    `,
    { showActions: false }
  );
}

function renderPaymentDetailsCard_() {
  // removed - payment now lives in the title box button
}

function normalizeOutcome_(o) {
  const out = String(o || "").trim().toUpperCase();

  if (out === "WIN" || out === "WON") return "WIN";
  if (out === "LOSS" || out === "LOST" || out === "LOSE") return "LOSS";
  if (out === "QUEUED") return "QUEUED";
  if (out === "VOID") return "VOID";
  if (out === "PENDING") return "PENDING";

  return "PENDING";
}

/**
 * Opens a modal for a given player (from getEntries list).
 * Hides the current GW team (only shows "Team submitted …" or "Not submitted").
 */

async function openPlayerPicksModal_(player, gwIdForEntries, allUsers = []) {
  const fullName =
    `${player.firstName || ""} ${player.lastName || ""}`.trim() ||
    player.name ||
    player.email ||
    "Player";

  const club =
    String(player.clubTeam || player.club || player.team || player.connection || "").trim() || "—";

  const isAlive = player.alive === true;
  const isDead = player.alive === false;
  const approved = isApproved_(player);

  const status = !approved
    ? "pending"
    : isAlive
      ? "alive"
      : isDead
        ? "dead"
        : null;

  function gwRowUi_(gwId, { submitted }) {
    if (!approved) {
      return {
        rowCls: "approval-pending",
        text: "Pending approval",
        stateCls: "bad",
        icon: "…"
      };
    }

    if (submitted) {
      return {
        rowCls: "pending",
        text: "Team submitted",
        stateCls: "warn",
        icon: "…"
      };
    }

    return {
      rowCls: "neutral",
      text: "Not selected",
      stateCls: "muted",
      icon: "…"
    };
  }

  const loadingHtml = `
    <div class="muted small" style="margin-bottom:10px;">${escapeHtml(club)}</div>
    <div class="fixtures-card" style="padding:12px;">
      <div class="status-rows">
        <div class="status-row neutral">
          <div>
            Fetching picks <span class="dots" aria-label="Loading"></span>
          </div>
        </div>
      </div>
    </div>
  `;

  showPlayerModal_(fullName, loadingHtml, { status, approved });

  let positionLine = "";
  if (isDead) {
    try {
      if (Array.isArray(allUsers) && allUsers.length) {
        const sorted = [...allUsers].sort((a, b) => {
          if (!!a.alive !== !!b.alive) return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
          return gwIndexForRank_(b.knockedOutGw) - gwIndexForRank_(a.knockedOutGw);
        });

        const idx = sorted.findIndex(u =>
          String(u.email || "").toLowerCase() === String(player.email || "").toLowerCase()
        );

        if (idx >= 0) {
          const placing = idx + 1;
          positionLine = `Finished: <strong>${placing}${ordinalSuffix_(placing)}</strong> of <strong>${sorted.length}</strong>`;
        }
      }
    } catch (err) {
      console.warn("Position line failed", err);
    }
  }

  try {
    let picks = Array.isArray(player.picks) ? player.picks : [];

    if (!picks.length && player.email) {
      const resp = await api({
        action: "getUserPicks",
        email: player.email,
        gameId: activeGameId
      });

      console.log("getUserPicks source:", resp.source, resp.picks?.length);
      picks = Array.isArray(resp.picks) ? resp.picks : [];
    }

    const currentGwKey = String(getEntriesViewGwId_() || gwIdForEntries || "").toUpperCase();

    const picksSorted = [...picks]
      .map(p => ({
        gwId: String(p.gwId || "").toUpperCase(),
        team: String(p.team || "").trim(),
        outcome: String(p.outcome || "PENDING").toUpperCase()
      }))
      .filter(p => p.gwId)
      .sort((a, b) => {
        const ai = findGwIndexById(a.gwId);
        const bi = findGwIndexById(b.gwId);
        if (ai >= 0 && bi >= 0) return ai - bi;
        return String(a.gwId).localeCompare(String(b.gwId));
      });

    let rowsHtml = "";

    if (!picksSorted.length) {
      const submitted = !!player.submittedForGw;
      const ui = gwRowUi_(currentGwKey, { submitted });

      rowsHtml = `
        <div class="status-row ${ui.rowCls}">
          <div>${escapeHtml(gwLabelShort(currentGwKey))} - ${ui.text}</div>
          <div class="state ${ui.stateCls}">${ui.icon}</div>
        </div>
      `;
    } else {
      for (const p of picksSorted) {
        const displayGwId = getDisplayGwIdForGame_(p.gwId, getActiveGame_());
        const isCurrent = String(p.gwId).toUpperCase() === currentGwKey;

        if (isAlive && isCurrent && p.outcome === "PENDING") {
          const submitted = !!player.submittedForGw;
          const ui = gwRowUi_(currentGwKey, { submitted });

          rowsHtml += `
            <div class="status-row ${ui.rowCls}">
              <div>${escapeHtml(gwLabelShort(displayGwId))} - ${ui.text}</div>
              <div class="state ${ui.stateCls}">${ui.icon}</div>
            </div>
          `;
          continue;
        }

        const outcome = String(p.outcome || "PENDING").toUpperCase();
        const displayOutcome =
          outcome === "PENDING" && gwIndexForRank_(p.gwId) > gwIndexForRank_(currentGwKey)
            ? "QUEUED"
            : outcome;

        let rowCls = "pending";
        let stateCls = "warn";
        let icon = "…";
        let labelHtml = "Team submitted";

        if (displayOutcome === "QUEUED") {
          rowCls = "queued";
          stateCls = "muted";
          icon = "⏱";
          labelHtml = "Team queued";
        } else if (displayOutcome === "WIN") {
          rowCls = "win";
          stateCls = "good";
          icon = "✓";
          labelHtml = teamInlineHtml_(p.team || "—", { size: 16, logoPosition: "before" });
        } else if (displayOutcome === "LOSS") {
          rowCls = "loss";
          stateCls = "bad";
          icon = "✕";
          labelHtml = teamInlineHtml_(p.team || "—", { size: 16, logoPosition: "before" });
        } else if (displayOutcome === "VOID") {
          rowCls = "void";
          stateCls = "muted";
          icon = "—";
          labelHtml = "Team void";
        }

        rowsHtml += `
          <div class="status-row fade-row ${rowCls}">
            <div>
              ${escapeHtml(gwLabelShort(displayGwId))} - ${labelHtml}
            </div>
            <div class="state ${stateCls}">${icon}</div>
          </div>
        `;
      }

      const hasCurrent = picksSorted.some(p => String(p.gwId).toUpperCase() === currentGwKey);

      if (!hasCurrent) {
        const ui = gwRowUi_(currentGwKey, { submitted: !!player.submittedForGw });

        rowsHtml += `
          <div class="status-row ${ui.rowCls}">
            <div>${escapeHtml(gwLabelShort(currentGwKey))} - ${ui.text}</div>
            <div class="state ${ui.stateCls}">${ui.icon}</div>
          </div>
        `;
      }
    }

    const finalHtml = `
      <div class="muted small" style="margin-bottom:10px;">${escapeHtml(club)}</div>
      <div class="fixtures-card" style="padding:12px;">
        <div class="status-rows">${rowsHtml}</div>
        ${positionLine ? `<div class="muted small" style="margin-top:10px;">${positionLine}</div>` : ""}
      </div>
    `;

    showPlayerModal_(fullName, finalHtml, { status, approved });

    requestAnimationFrame(() => {
      const rows = playerModalBody?.querySelectorAll(".fade-row") || [];
      rows.forEach((el, i) => setTimeout(() => el.classList.add("is-in"), i * 60));
    });

  } catch (err) {
    console.error("openPlayerPicksModal_ failed", err);

    showPlayerModal_(
      fullName,
      `
        <div class="muted small" style="margin-bottom:10px;">${escapeHtml(club)}</div>
        <div class="fixtures-card" style="padding:12px;">
          <div class="status-row neutral">
            <div>Could not load picks</div>
            <div class="state bad">✕</div>
          </div>
        </div>
      `,
      { status, approved }
    );
  }
}

async function computePlacingForEmail_(targetEmail, gwIdForRank) {
  const emailKey = String(targetEmail || "").toLowerCase();

  // Pull all users so we can rank (same logic as your dead modal)
  let users = [];
  try {
    const data = await api({ action: "getEntries", gameId: activeGameId, gwId: gwIdForRank });
    users = data.users || [];
  } catch {
    users = [];
  }

  const sorted = [...users].sort((a, b) => {
    // Alive always above dead
    if (!!a.alive !== !!b.alive) return (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
    // Among dead: later knockedOutGw is better
    return gwIndexForRank_(b.knockedOutGw) - gwIndexForRank_(a.knockedOutGw);
  });

  const total = sorted.length || 0;
  const idx = sorted.findIndex(u => String(u.email || "").toLowerCase() === emailKey);
  const placing = idx >= 0 ? (idx + 1) : null;

  return { placing, total };
}


function gwLabelShort(gwId) {
  return getDisplayGwIdForGame_(gwId);
}

function gwLabelLong(gwId) {
  const n = getDisplayGwNumForGame_(gwId);
  return n ? `Gameweek ${n}` : String(gwId || "");
}


function rowClass(outcome) {
  const o = String(outcome || "PENDING").toUpperCase();
  if (o === "WIN") return "win";
  if (o === "LOSS") return "loss";
  return "pending";
}

function sortPicksByGw(picks) {
  return [...picks].sort((a, b) => findGwIndexById(a.gwId) - findGwIndexById(b.gwId));
}

function currentGwLocked() {
  const gw = gameweeks.find(g => g.id === currentGwId);
  if (!gw) return true;
  return Date.now() >= gw.deadline.getTime();
}

function getNextQueueTargetGwId_() {
  const picksByGw = new Map(
    (sessionPicks || [])
      .filter(p => p?.gwId)
      .map(p => [String(p.gwId).toUpperCase(), p])
  );

  const nextEmpty = (gameweeks || []).find(gw => {
    const gwId = String(gw.id || "").toUpperCase();

    if (!canQueueGw_(gwId)) return false;

    const pick = picksByGw.get(gwId);
    return !String(pick?.team || "").trim();
  });

  return nextEmpty ? String(nextEmpty.id).toUpperCase() : "";
}

function renderStatusBox() {
  const box = document.getElementById("statusBox");
  if (!box || !sessionUser) return;

  const game = getActiveGame_();
  const isWorldCup = gameIncludesLeague_("World Cup", game);
  const name = `${sessionUser.firstName || ""} ${sessionUser.lastName || ""}`.trim() || "Player";

  const isPending = !sessionUser.approved;
  const isDead = sessionUser.alive === false;
  const isAlive = !isPending && !isDead;

  box.classList.remove("status-alive", "status-dead", "status-pending");
  if (isPending) box.classList.add("status-pending");
  else if (isDead) box.classList.add("status-dead");
  else box.classList.add("status-alive");

  const picksAsc = sortPicksByGw(sessionPicks || []);
  const picksByGw = new Map(
    picksAsc
      .filter(p => p && p.gwId)
      .map(p => [String(p.gwId).toUpperCase(), p])
  );

  const currentPick = picksByGw.get(String(currentGwId || "").toUpperCase()) || null;
  const lateSubmittingNow = canLateSubmitCurrentGw_() && !currentPick?.team;

  function canShowViewAllForGw_(gwId) {
    const gw = gameweeks.find(g => g.id === gwId);
    if (!gw) return false;

    const started = Date.now() >= gw.deadline.getTime();
    if (!started) return false;

    if (String(gwId).toUpperCase() === String(currentGwId || "").toUpperCase() && lateSubmittingNow) {
      return false;
    }

    return true;
  }

  function viewAllHtml_(gwId) {
    if (!canShowViewAllForGw_(gwId)) return ``;

    return `
      <button
        type="button"
        class="text-link-btn status-view-all-link"
        data-view-all-gw="${escapeAttr(gwId)}"
      >
        View all
      </button>
    `;
  }

  function stateHtml_(outcome, hasTeam, gwId) {
    const o = String(outcome || "PENDING").toUpperCase();

    if (!hasTeam) return ``;

    const editHtml = canEditPickForGw_(gwId)
      ? `
      <button
        type="button"
        class="status-edit-btn"
        data-edit-pick-gw="${escapeAttr(gwId)}"
        aria-label="Edit ${escapeAttr(gwLabelShort(gwId))} selection"
        title="Edit selection"
      >✎</button>
    `
      : "";

    if (o === "WIN") return `<div class="state good">✓</div>`;
    if (o === "LOSS") return `<div class="state bad">✕</div>`;
    if (o === "QUEUED") return `<div class="state muted">⏱</div>${editHtml}`;
    if (o === "VOID") return `<div class="state muted">—</div>`;

    return `<div class="state warn">…</div>${editHtml}`;
  }

  function rowClassForOutcome_(outcome) {
    const o = String(outcome || "PENDING").toUpperCase();

    if (o === "WIN") return "win";
    if (o === "LOSS") return "loss";
    if (o === "QUEUED") return "queued";
    if (o === "VOID") return "void";
    return "pending";
  }

  let rowsHtml = "";

  if (isPending) {
    rowsHtml = `
      <div class="status-row pending">
        <div class="status-row-main">
          <div class="status-row-left">
            <span>${escapeHtml(gwLabelShort(currentGwId))} - Awaiting approval...</span>
          </div>
          <div class="status-row-right">
            <div class="state warn">…</div>
          </div>
        </div>
      </div>
    `;
  } else {
    const rows = [];
    let lastStageLabel = "";

    const displayGws = (gameweeks || []).filter(gw => {
      const gwId = String(gw.id || "").toUpperCase();
      const pick = picksByGw.get(gwId) || null;
      const hasTeam = !!String(pick?.team || "").trim();

      if (hasTeam) return true;
      if (gwId === String(currentGwId || "").toUpperCase() && isAlive) return true;

      if (
        isAlive &&
        isQueuePicksGame_() &&
        canQueueGw_(gwId) &&
        hasSelectableFixtureForGw_(gwId)
      ) return true;

      return false;
    });

    displayGws.forEach(gw => {
      const gwId = String(gw.id || "").toUpperCase();
      const pick = picksByGw.get(gwId) || null;
      const hasTeam = !!String(pick?.team || "").trim();
      const outcome = String(pick?.outcome || "PENDING").toUpperCase();

      if (isWorldCup) {
        const stage = getWorldCupQueueStage_(gwId);
        if (stage.label && stage.label !== lastStageLabel) {
          rows.push(`
            <div class="status-stage-title">
              ${escapeHtml(stage.label)}
            </div>
          `);
          lastStageLabel = stage.label;
        }
      }

      let rowCls = hasTeam ? rowClassForOutcome_(outcome) : "neutral";
      let leftHtml = "";

      if (hasTeam) {
        leftHtml = `
          <span>${escapeHtml(gwLabelShort(gwId))} - </span>
          ${teamInlineHtml_(pick.team, { size: 16, logoPosition: "before" })}
        `;
      } else {
        leftHtml = `<span>${escapeHtml(gwLabelShort(gwId))} - No selection</span>`;
      }

      rows.push(`
        <div class="status-row ${rowCls}">
          <div class="status-row-main">
            <div class="status-row-left">
              ${leftHtml}
            </div>

            <div class="status-row-right">
              ${viewAllHtml_(gwId)}
              ${stateHtml_(outcome, hasTeam, gwId)}
            </div>
          </div>
        </div>
      `);
    });

    rowsHtml = rows.join("") || `
      <div class="status-row neutral">
        <div class="status-row-main">
          <div class="status-row-left">
            <span>${escapeHtml(gwLabelShort(currentGwId))} - Make a selection...</span>
          </div>
          <div class="status-row-right">
            <div class="state warn">…</div>
          </div>
        </div>
      </div>
    `;
  }

  box.innerHTML = `
    <div class="status-head">
      <div class="status-name">${escapeHtml(name)} - Selections</div>
    </div>

    <div class="status-rows">
      ${rowsHtml}
    </div>
  `;

  box.querySelectorAll("[data-view-all-gw]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gwId = btn.getAttribute("data-view-all-gw");
      if (!gwId) return;
      openGwReportModal_(gwId);
    });
  });
  box.querySelectorAll("[data-edit-pick-gw]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const gwId = btn.getAttribute("data-edit-pick-gw");
      if (!gwId) return;
      await editPickForGw_(gwId);
    });
  });
}

function getTeamResetGws_(game = getActiveGame_()) {
  const raw = String(game?.resetTeamGw || game?.resetteamgw || "").trim();

  if (!raw || raw.toLowerCase() === "false") return [];

  return raw
    .split(",")
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);
}

function getTeamReuseGroupForGw_(gwId, game = getActiveGame_()) {
  const gwNum = gwNumberFromId_(gwId);
  const resets = getTeamResetGws_(game)
    .map(gwNumberFromId_)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  let groupStart = 1;

  for (const resetNum of resets) {
    if (gwNum >= resetNum) {
      groupStart = resetNum;
    }
  }

  return `FROM_GW${groupStart}`;
}

function bindConnectionToClubToggleOnce_() {
  if (!registerForm || registerForm.dataset.boundConn === "1") return;
  registerForm.dataset.boundConn = "1";

  const sel = document.getElementById("clubTeam");          // ✅ your actual select
  const wrap = document.getElementById("connectionWrap");   // ✅ your actual wrapper
  const input = document.getElementById("connectionInput"); // ✅ your actual input
  if (!sel || !wrap || !input) return;

  const norm = (s) => String(s || "").trim().toLowerCase();

  const apply = () => {
    const text = norm(sel.value || sel.selectedOptions?.[0]?.textContent);
    const needs = text.includes("friend") || text.includes("relative");

    wrap.classList.toggle("hidden", !needs);
    input.required = needs;
    if (!needs) input.value = "";
  };

  sel.addEventListener("change", apply);
  apply(); // ✅ apply immediately on load / when tab is shown
}

bindConnectionToClubToggleOnce_();

async function editCurrentPickFlow() {
  if (!sessionEmail) return;
  if (currentGwLocked()) return;

  setEditing(true);
  isEditingCurrentPick = true;

  try {
    // 1) clear on backend so polling cannot restore it
    await api({ action: "clearPick", email: sessionEmail, gameId: activeGameId, gwId: currentGwId })

    // 3) open input
    openPickEditor();

    // 2) refresh local state
    await refreshProfile();

    // 4) re-render
    renderStatusBox();
    renderPickCardState?.(); // if you have it
  } catch (e) {
    console.warn(e);
  } finally {
    // small delay so the next poll doesn’t fight mid-edit
    setEditing(false);
    setTimeout(() => { isEditingCurrentPick = false; }, 1500);
  }
}


function hideFixturesMessage() {
  const el = document.getElementById("fixturesMsg");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("good", "bad");
}


function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[m]));
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function showAuthMessage(text, type) {
  const el = document.getElementById("authMsg");
  if (!el) return; // prevent crash
  el.textContent = text;
  el.classList.remove("hidden", "good", "bad");
  el.classList.add(type === "good" ? "good" : "bad");
}

function showFixturesMessage(text, type) {
  const el = document.getElementById("fixturesMsg");
  if (!el) return;

  const t = String(text || "").trim();
  if (!t) {
    el.textContent = "";
    el.classList.add("hidden");
    el.classList.remove("good", "bad");
    return;
  }

  el.textContent = t;
  el.classList.remove("hidden", "good", "bad");
  el.classList.add(type === "good" ? "good" : "bad");
}


function renderTopUIOnly() {
  renderCurrentPickBlock();
  renderStatusBox();
  renderPickCardState();
  startDeadlineTimer();
  updateTeamDatalist();
  renderGwReportCard_();
  startCountdowns_();
}


/*******************************
 * FIXTURES: LOAD + NORMALIZE
 *******************************/
async function loadAllFixtures() {
  const all = [];

  for (const source of FIXTURE_SOURCES) {
    try {
      const res = await fetch(source.url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`Failed to load fixture file: ${source.url} (${res.status})`);
        continue;
      }

      const raw = await res.json();
      const matches = Array.isArray(raw.matches) ? raw.matches : [];

      for (const m of matches) {
        const fx = normalizeFixture(m, source.league);
        if (fx) all.push(fx);
      }
    } catch (err) {
      console.warn(`Failed to load fixture file: ${source.url}`, err);
    }
  }

  fixtures = all.sort((a, b) => a.kickoff - b.kickoff);
  return fixtures;
}


function detectGwId(raw) {
  const direct = String(raw.gwId || "").trim();
  if (direct) return direct.toUpperCase(); // "GW1"

  const round = String(raw.round || "").trim();
  const m = round.match(/GW\s*([0-9]+)/i) || round.match(/Gameweek\s*([0-9]+)/i);
  if (m) return `GW${Number(m[1])}`; // ✅ NO trailing space

  return null;
}


function parseKickoffUK(dateStr, timeStr) {
  const t = (timeStr && String(timeStr).trim()) ? String(timeStr).trim() : null;
  const iso = t ? `${dateStr}T${t}:00` : `${dateStr}T12:00:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
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

  const homeScore =
    raw.homeScore === "" || raw.homeScore == null ? null : Number(raw.homeScore);
  const awayScore =
    raw.awayScore === "" || raw.awayScore == null ? null : Number(raw.awayScore);

  return {
    gwId: String(gwId).trim().toUpperCase(),
    league: leagueName,
    kickoff,
    kickoffHasTime: !!hasTime,
    home: getCanonicalTeamName_(String(home)),
    away: getCanonicalTeamName_(String(away)),
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    resultStatus: String(raw.resultStatus || "pending").trim(),
    round: raw.round || ""
  };
}

function findGwIndexById(gwId) {
  return gameweeks.findIndex(g => g.id === gwId);
}

function getNextGwId(afterGwId) {
  const idx = findGwIndexById(afterGwId);
  if (idx < 0) return null;
  return gameweeks[idx + 1]?.id || null;
}

function computePlayerGwId() {
  if (!gameweeks.length) return null;

  if (sessionUser && sessionUser.alive === false) {
    if (sessionUser.knockedOutGw) return sessionUser.knockedOutGw;

    const lastResolvedPick = [...(sessionPicks || [])]
      .filter(p => !["QUEUED", "VOID"].includes(String(p.outcome || "").toUpperCase()))
      .sort((a, b) => findGwIndexById(a.gwId) - findGwIndexById(b.gwId))
      .pop();

    return lastResolvedPick?.gwId || gameweeks[0].id;
  }

  const activePicks = [...(sessionPicks || [])]
    .filter(p => {
      const outcome = String(p.outcome || "PENDING").toUpperCase();
      return outcome !== "QUEUED" && outcome !== "VOID";
    })
    .sort((a, b) => findGwIndexById(a.gwId) - findGwIndexById(b.gwId));

  const lastPick = activePicks.length ? activePicks[activePicks.length - 1] : null;

  if (!lastPick) {
    return computeDateGwId() || gameweeks[0].id;
  }

  const outcome = String(lastPick.outcome || "PENDING").toUpperCase();

  if (outcome === "LOSS") return lastPick.gwId;

  if (outcome === "WIN") {
    return getNextGwId(lastPick.gwId) || lastPick.gwId;
  }

  return lastPick.gwId;
}

function computeDateGwId() {
  if (!gameweeks.length) return null;

  const n = now();

  // 1) If a gameweek is currently in progress, stay on it
  const inProgress = gameweeks.find(g => n >= g.deadline && n < g.endCutoff);
  if (inProgress) return inProgress.id;

  // 2) Otherwise, if a future gameweek hasn't started yet, show the next upcoming one
  const upcoming = gameweeks.find(g => n < g.deadline);
  if (upcoming) return upcoming.id;

  // 3) If everything is finished, stay on the last one
  return gameweeks[gameweeks.length - 1]?.id || null;
}

function sortPicksByGwAsc(picks) {
  return [...picks].sort((a, b) => findGwIndexById(a.gwId) - findGwIndexById(b.gwId));
}

function formatOutcomeLabel(o) {
  const out = String(o || "PENDING").toUpperCase();
  if (out === "WIN") return "Won";
  if (out === "LOSS") return "Lost";
  return "In progress";
}

function stepClass(o) {
  const out = String(o || "PENDING").toUpperCase();
  if (out === "WIN") return "win";
  if (out === "LOSS") return "loss";
  return "pending";
}

function stepIcon(o) {
  const out = String(o || "PENDING").toUpperCase();
  if (out === "WIN") return "✓";
  if (out === "LOSS") return "✕";
  return "…";
}

function gwNumFromId(gwId) {
  const m = String(gwId || "").match(/^GW(\d+)$/i);
  return m ? Number(m[1]) : null;
}



function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}


function isLateSubmissionOpenForGw_(gwId) {
  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw || !gw.lateDeadline) return false;

  const pick = getPickForGw(gwId);
  if (pick?.team) return false;

  const nowMs = Date.now();
  return nowMs >= gw.deadline.getTime() && nowMs < gw.lateDeadline.getTime();
}

function canLateSubmitCurrentGw_() {
  if (!sessionUser?.approved) return false;
  if (sessionUser?.alive === false) return false;

  const pick = getPickForGw(currentGwId);
  if (pick?.team) return false;

  return isLateSubmissionOpenForGw_(currentGwId);
}

function isQueuePicksGame_(game = getActiveGame_()) {
  const raw =
    game?.queuePicks ??
    game?.queuepicks ??
    game?.queue_picks ??
    game?.QueuePicks ??
    game?.["queuePicks"] ??
    game?.["queue picks"] ??
    "";

  return raw === true ||
    String(raw).trim().toLowerCase() === "true" ||
    String(raw).trim().toLowerCase() === "yes" ||
    String(raw).trim().toLowerCase() === "y" ||
    String(raw).trim() === "1";
}

function isFutureGw_(gwId) {
  return gwIndexForRank_(gwId) > gwIndexForRank_(currentGwId);
}

function getUnstartedFixturesForGw_(gwId) {
  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) return [];

  const nowMs = Date.now();
  return gw.fixtures.filter(f => f.kickoff.getTime() > nowMs);
}

function getUnstartedTeamsForGw_(gwId) {
  const teams = new Set();

  getUnstartedFixturesForGw_(gwId).forEach(f => {
    teams.add(getCanonicalTeamName_(f.home));
    teams.add(getCanonicalTeamName_(f.away));
  });

  return Array.from(teams).sort((a, b) => a.localeCompare(b));
}


function isGameLateRegistrationOpen_(game) {
  const status = String(game?.status || "").toUpperCase();
  if (status !== "OPEN") return false;

  const firstGw = getGameFirstGw_(game);
  if (!firstGw?.deadline || !firstGw?.lateDeadline) return false;

  const nowMs = Date.now();
  return nowMs >= firstGw.deadline.getTime() && nowMs < firstGw.lateDeadline.getTime();
}

function isGameRegistrationOpenNow_(game) {
  const status = String(game?.status || "").toUpperCase();
  if (status !== "OPEN") return false;

  const firstGw = getGameFirstGw_(game);

  // Don't falsely show "closed" if fixtures/deadlines haven't loaded yet
  if (!firstGw?.deadline || !firstGw?.lateDeadline) return true;

  return Date.now() < firstGw.lateDeadline.getTime();
}

async function loadDeadlines(game = getActiveGame_()) {
  const rawFile = String(game?.deadlinesFile || "").trim();

  const deadlinesFile =
    rawFile ||
    "site/data/gameweek-deadlines.json";

  console.log("loading deadlines", {
    activeGameId,
    gameTitle: game?.title,
    rawFile,
    deadlinesFile
  });

  let res;
  try {
    res = await fetch(`${deadlinesFile}?ts=${Date.now()}`, {
      cache: "no-store"
    });
  } catch (err) {
    console.warn("Deadlines fetch failed:", deadlinesFile, err);
    return new Map();
  }

  const text = await res.text();

  if (!res.ok) {
    console.warn("Deadlines file not found:", deadlinesFile, res.status, text.slice(0, 200));
    return new Map();
  }

  if (!String(text || "").trim()) {
    console.warn("Deadlines file is empty:", deadlinesFile);
    return new Map();
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.warn("Deadlines file is not valid JSON:", deadlinesFile, text.slice(0, 300));
    return new Map();
  }

  const map = new Map();

  for (const d of (data.deadlines || [])) {
    const gwId = String(d.gwId || "").trim().toUpperCase();
    if (!gwId) continue;

    map.set(gwId, {
      normalDeadlineIso: String(d.normalDeadlineIso || "").trim(),
      lateDeadlineIso: String(d.lateDeadlineIso || "").trim(),
      firstKickoffIso: String(d.firstKickoffIso || "").trim(),
      lastKickoffIso: String(d.lastKickoffIso || "").trim()
    });
  }

  return map;
}

async function loadFixturesAndDeadlines_() {
  await loadAllFixtures();

  const activeGame = getActiveGame_();

  deadlinesByGw = await loadDeadlines(activeGame);

  gameweeks = activeGame ? getGameweeksForGame_(activeGame) : [];

  console.log("game load debug", {
    activeGameId,
    activeGame,
    fixturesCount: fixtures.length,
    competitions: activeGame ? getGameCompetitions_(activeGame) : [],
    deadlinesCount: deadlinesByGw.size,
    gameweeks: gameweeks.map(g => ({
      id: g.id,
      num: g.num,
      fixtures: g.fixtures.length,
      deadline: g.deadline,
      lateDeadline: g.lateDeadline
    }))
  });
}


/*******************************
 * DATA: LOAD USER PROFILE FROM API
 *******************************/
async function refreshProfile() {
  if (!sessionEmail || !activeGameId) return;

  const data = await api({
    action: "getProfile",
    email: sessionEmail,
    gameId: activeGameId
  });

  sessionUser = {
    ...(sessionUser || {}),
    ...(data.user || {})
  };
  sessionUser.approved = isApproved_(sessionUser);

  sessionPicks = (Array.isArray(data.picks) ? data.picks : []).map(p => ({
    ...p,
    gwId: normaliseGwId_(p.gwId),
    team: String(p.team || "").trim(),
    outcome: normalizeOutcome_(p.outcome)
  }));

  const emergencyGwId = String(currentGwId || gameweeks?.[0]?.id || "GW1").toUpperCase();

  const alreadyHasCurrentPick = (sessionPicks || []).some(p =>
    String(p.gwId || "").toUpperCase() === emergencyGwId &&
    String(p.team || "").trim()
  );

  if (!alreadyHasCurrentPick) {
    const fallbackPick = await getSavedPickFromGwReport_(sessionEmail, emergencyGwId);

    if (fallbackPick?.team) {
      console.warn("Emergency fallback restored pick from GW report", fallbackPick);

      sessionPicks = [
        ...(sessionPicks || []).filter(p =>
          String(p.gwId || "").toUpperCase() !== emergencyGwId
        ),
        fallbackPick
      ];
    }
  }

  usedTeams = new Set(
    sessionPicks
      .filter(p => p.outcome === "WIN")
      .map(p => normTeamKey_(getCanonicalTeamName_(p.team)))
  );
  renderGameTitleBox_();
}

function startDeadlineTimer() {
  const timeLeftText = document.getElementById("timeLeftText");

  if (isWinner_()) {
    if (timeLeftText) timeLeftText.textContent = "Competition finished";
    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  }

  if (deadlineInterval) clearInterval(deadlineInterval);

  const tick = () => {
    const gw = gameweeks.find(g => g.id === currentGwId);
    if (!gw) return;

    const hasPick = !!getPickForGw(currentGwId)?.team;
    const lateSubmitOpen = canLateSubmitCurrentGw_();

    const targetMs = lateSubmitOpen
      ? gw.lateDeadline?.getTime()
      : gw.deadline?.getTime();

    if (!targetMs) return;

    const diffMs = targetMs - Date.now();
    const locked = diffMs <= 0 && !lateSubmitOpen;

    if (timeLeftText) {
      if (hasPick) {
        timeLeftText.textContent = "Selection submitted";
      } else if (lateSubmitOpen) {
        timeLeftText.textContent = formatTimeLeft(diffMs);
      } else if (diffMs <= 0) {
        timeLeftText.textContent = "Submissions closed";
      } else {
        timeLeftText.textContent = formatTimeLeft(diffMs);
      }

      timeLeftText.classList.remove("good");
    }

    if (submitPickBtn) {
      if (isQueuePicksGame_()) {
        const targetGwId = getNextQueueTargetGwId_();
        if (targetGwId) {
          forceQueueSubmitButtonState_(targetGwId);
        }
      } else {
        submitPickBtn.disabled =
          hasPick ||
          !sessionUser?.approved ||
          (diffMs <= 0 && !lateSubmitOpen);
      }
    }
  };

  tick();
  deadlineInterval = setInterval(tick, 1000);
}

function normTeam_(s) {
  return normTeamKey_(getCanonicalTeamName_(s));
}

function findFixtureForTeam(gw, team) {
  if (!gw || !team) return null;

  const t = normTeam_(team);
  return gw.fixtures.find(f =>
    normTeam_(f.home) === t || normTeam_(f.away) === t
  ) || null;
}

/*******************************
 * RENDER: FIXTURES TAB
 *******************************/
function normaliseGwId_(gwId) {
  return String(gwId || "").trim().toUpperCase();
}

function getPickForGw(gwId) {
  const key = normaliseGwId_(gwId);

  return (sessionPicks || []).find(p =>
    normaliseGwId_(p.gwId) === key
  ) || null;
}

function renderFixtureMiddleBoxApp_(f) {
  const hasScore =
    Number.isInteger(f.homeScore) &&
    Number.isInteger(f.awayScore);

  if (hasScore) {
    return `
      <span
        class="score-box"
        style="display:inline-flex;align-items:center;justify-content:center;min-width:45px;height:28px;"
      >
        ${f.homeScore}-${f.awayScore}
      </span>
    `;
  }

  return `
    <span
      class="score-box"
      style="display:inline-flex;align-items:center;justify-content:center;min-width:45px;height:28px;"
    >
      ${escapeHtml(String(f.kickoffHasTime ? formatTimeUK(f.kickoff) : "TBD"))}
    </span>
  `;
}

function formatResultStatusLabelApp_(status) {
  const s = String(status || "").trim().toLowerCase();

  if (!s || s === "final") return "FT";
  if (s === "aet") return "AET";
  if (s.startsWith("pens ")) return `PENS ${s.slice(5)}`;

  return s.toUpperCase();
}

function renderFixtureGwNav() {
  const nav = document.getElementById("fixtureGwNav");
  if (!nav) return;

  const idx = gameweeks.findIndex(g => g.id === viewingGwId);
  if (idx < 0) return;

  const cur = gameweeks[idx];

  let visibleGws = gameweeks.slice(Math.max(0, idx - 1), idx + 2);

  if (idx === 0) {
    visibleGws = gameweeks.slice(0, 3);
  }

  if (idx === gameweeks.length - 1) {
    visibleGws = gameweeks.slice(Math.max(0, gameweeks.length - 3));
  }

  const prev = gameweeks[idx - 1] || null;
  const next = gameweeks[idx + 1] || null;

  function gwClass(gwId) {
    const pick = getPickForGw(gwId);
    const outcome = String(pick?.outcome || "").toUpperCase();

    if (!pick?.team) return "";

    if (outcome === "PENDING") return "gw-pill-pick-pending";
    if (outcome === "QUEUED") return "gw-pill-pick-queued";
    if (outcome === "WIN") return "gw-pill-pick-win";
    if (outcome === "LOSS") return "gw-pill-pick-loss";

    return "";
  }

  function helperHtmlForGw_(gwId) {
    const pick = getPickForGw(gwId);
    const outcome = String(pick?.outcome || "").toUpperCase();
    const gw = gameweeks.find(g => String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase());
    const hasStarted = !!gw?.deadline && Date.now() >= gw.deadline.getTime();

    if (pick?.team) {
      const teamHtml = teamInlineHtml_(pick.team, { size: 14, logoPosition: "before" });

      if (outcome === "VOID") {
        return `
        <span class="fixture-gw-status-pill muted fixture-gw-status-pill--void">
          <span>Selection void:</span>
          ${teamHtml}
        </span>
      `;
      }

      if (!hasStarted) {
        if (outcome === "QUEUED") {
          return `
          <span class="fixture-gw-status-pill">
            <span>Selection queued for future gameweek:</span>
            ${teamHtml}
            <span class="state muted">...</span>
          </span>
        `;
        }

        return `
        <span class="fixture-gw-status-pill">
          <span>Selection confirmed:</span>
          ${teamHtml}
          <span class="state good">✓</span>
        </span>
      `;
      }

      if (outcome === "WIN") {
        return `
        <span class="fixture-gw-status-pill">
          <span>Selection:</span>
          ${teamHtml}
          <span class="state good">Won ✓</span>
        </span>
      `;
      }

      if (outcome === "LOSS") {
        return `
        <span class="fixture-gw-status-pill">
          <span>Selection:</span>
          ${teamHtml}
          <span class="state bad">Lost ×</span>
        </span>
      `;
      }

      return `
      <span class="fixture-gw-status-pill">
        <span>Selection:</span>
        ${teamHtml}
        <span class="state muted">Pending ...</span>
      </span>
    `;
    }

    if (!canClickAnyFixtureTeamForGw_(gwId)) {
      return `
      <span class="fixture-gw-status-pill muted">
        Awaiting gameweek
        <span class="state muted">…</span>
      </span>
    `;
    }

    return `
    <span class="fixture-gw-status-pill muted">
      Make a selection
      <span class="state muted">✎</span>
    </span>
  `;
  }

  function startedStatsHtmlForGw_(gw) {
    if (!gw?.deadline || Date.now() < gw.deadline.getTime()) return "";

    const stats =
      lastGwReportStatsGwId === gw.id && lastGwReportStats
        ? lastGwReportStats
        : null;

    const players = stats ? String(stats.alivePlayers) : `<span class="dots" aria-label="Loading"></span>`;
    const selections = stats ? String(stats.selections) : `<span class="dots" aria-label="Loading"></span>`;

    return `
      <div class="fixture-gw-submission-summary muted small" data-gw-submission-summary="${escapeAttr(gw.id)}">
        Players: <strong data-gw-summary-players>${players}</strong>
        · Selections: <strong data-gw-summary-selections>${selections}</strong>
        · <button class="link-btn" type="button" data-open-gw-report="${escapeAttr(gw.id)}">View All</button>
      </div>
    `;
  }

  const endDay = startOfDay(cur.lastKickoff || cur.firstKickoff);

  nav.innerHTML = `
    <div class="fixture-gw-current-title">
      ${escapeHtml(`${gwLabelShort(cur.id)}: ${getGwStageLabel_(cur.id)}`)}
    </div>

    <div class="fixture-gw-date muted">
      ${formatDateWithOrdinalShortUK(cur.start)} - ${formatDateWithOrdinalShortUK(endDay)}
    </div>

    <div class="fixture-gw-nav-row">
      <button
        class="fixture-gw-arrow"
        ${!prev ? "disabled" : ""}
        data-gw-nav="${prev?.id || ""}"
      >
        ←
      </button>

      <div class="fixture-gw-pills">
        ${visibleGws.map(gw => `
          <button
            class="fixture-gw-pill ${gw.id === cur.id ? "active" : ""} ${gwClass(gw.id)}"
            ${gw.id === cur.id ? "" : `data-gw-nav="${gw.id}"`}
          >
            ${gwLabelShort(gw.id)}
          </button>
        `).join("")}
      </div>

      <button
        class="fixture-gw-arrow"
        ${!next ? "disabled" : ""}
        data-gw-nav="${next?.id || ""}"
      >
        →
      </button>
    </div>
    ${startedStatsHtmlForGw_(cur)}
    <div class="fixture-gw-helper">
      ${helperHtmlForGw_(cur.id)}
    </div>
  `;

  nav.querySelectorAll("[data-gw-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gwId = btn.dataset.gwNav;
      if (!gwId) return;

      viewingGwId = gwId;
      renderFixturesTab();
    });
  });

  nav.querySelector("[data-open-gw-report]")?.addEventListener("click", () => {
    openGwReportModal_(cur.id);
  });

  if (cur?.deadline && Date.now() >= cur.deadline.getTime()) {
    refreshGwReportCount_(cur.id).then(() => {
      if (String(viewingGwId || "") === String(cur.id || "")) updateFixtureGwSubmissionSummary_(cur.id, lastGwReportStats);
    }).catch(() => { });
  }
}

function getGwStageLabel_(gwId) {
  const n = gwNumberFromId_(gwId);

  if (n >= 1 && n <= 6) return "Group Stage";
  if (n === 7) return "Round of 32";
  if (n === 8) return "Round of 32";
  if (n === 9) return "Round of 16";
  if (n === 10) return "Quarter-finals";
  if (n === 11) return "Semi-finals";
  if (n === 12) return "Final & 3rd Place Play-off";

  return `Gameweek ${n}`;
}

async function renderFixturesTab() {
  const viewGw = gameweeks.find(g => g.id === viewingGwId);
  if (!viewGw) return;

  renderFixtureGwNav();

  renderCurrentPickBlock();
  renderStatusBox();
  renderPickCardState();
  startDeadlineTimer();
  updateTeamDatalist();

  if (!fixturesList) return;
  fixturesList.innerHTML = "";

  const showPickData = shouldShowFixturePickDataForGw_(viewGw.id);
  const activeGame = getActiveGame_();
  const allowedLeagues = getGameCompetitions_(activeGame);
  const singleCompetition = allowedLeagues.length === 1;
  const useFlags = gameIncludesLeague_("World Cup", activeGame);

  if (showPickData && !fixturePickCountsByGw.has(String(viewGw.id || "").toUpperCase())) {
    ensureFixturePickDataForGw_(viewGw.id)
      .then(() => {
        if (String(viewingGwId || "").toUpperCase() === String(viewGw.id || "").toUpperCase()) {
          renderFixturesTab();
        }
      })
      .catch((err) => {
        console.warn("Fixture pick data failed to load", err);
      });
  }

  const byDay = new Map();
  for (const f of viewGw.fixtures) {
    const dayKey = new Date(f.kickoff);
    dayKey.setHours(0, 0, 0, 0);
    const key = dayKey.toISOString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(f);
  }

  const dayKeys = Array.from(byDay.keys()).sort();

  if (daySelect) {
    daySelect.classList.add("hidden");
  }

  const renderKeys = dayKeys;

  for (const dk of renderKeys) {
    const dayDate = new Date(dk);

    const dayGroup = document.createElement("div");
    dayGroup.className = "day-group";

    const head = document.createElement("div");
    head.className = "day-head";
    head.innerHTML = `
      <div>
        <div class="day-title">${formatDateUK(dayDate)}</div>
        <div class="day-sub">Fixtures</div>
      </div>
    `;
    dayGroup.appendChild(head);

    const leagueMap = new Map();
    for (const f of byDay.get(dk) || []) {
      if (!leagueMap.has(f.league)) leagueMap.set(f.league, []);
      leagueMap.get(f.league).push(f);
    }

    for (const leagueName of allowedLeagues) {
      const list = leagueMap.get(leagueName);
      if (!list || !list.length) continue;

      const details = document.createElement("details");
      details.className = "league-details";
      details.open = singleCompetition;

      const summary = document.createElement("summary");
      summary.className = "league-summary";
      summary.innerHTML = `
        <span class="league-left">
          ${escapeHtml(leagueName)} (${list.length})
        </span>
        ${showPickData ? `
          <span class="league-summary-right">
            ${renderLeaguePickBadgeApp_(list)}
          </span>
        ` : `<span class="league-summary-right"></span>`}
      `;
      if (!singleCompetition) {
        details.appendChild(summary);
      }

      const container = document.createElement("div");
      container.className = "league-group";

      for (const f of list.sort((a, b) => a.kickoff - b.kickoff)) {
        const row = document.createElement("div");
        row.className = "fixture-row";

        const hasScore =
          Number.isInteger(f.homeScore) &&
          Number.isInteger(f.awayScore);

        const leftLogo = useFlags ? getCountryFlagUrl_(f.home) : getTeamLogo_(f.home);
        const rightLogo = useFlags ? getCountryFlagUrl_(f.away) : getTeamLogo_(f.away);

        const pickCounts = showPickData ? getFixturePickCountsForApp_(f) : null;
        const homePickStats = pickCounts?.home || null;
        const awayPickStats = pickCounts?.away || null;

        const currentPick = getPickForGw(f.gwId);
        const selectedTeam = String(currentPick?.team || "").trim();

        const homeSelected = selectedTeam && areTeamsSame_(selectedTeam, f.home);
        const awaySelected = selectedTeam && areTeamsSame_(selectedTeam, f.away);

        const pickOutcome = String(currentPick?.outcome || "PENDING").toUpperCase();

        const selectedFixtureClass =
          pickOutcome === "VOID"
            ? "fixture-team-side--void"
            : pickOutcome === "QUEUED"
            ? "fixture-team-side--queued"
            : pickOutcome === "WIN"
              ? "fixture-team-side--win"
              : pickOutcome === "LOSS"
                ? "fixture-team-side--loss"
                : "fixture-team-side--pending";

        const homeClickable = canClickFixtureTeam_(f.home, f.gwId);
        const awayClickable = canClickFixtureTeam_(f.away, f.gwId);

        row.innerHTML = `
          <div class="fixture-row-main" style="min-width:0;width:100%;">
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
                class="${homeSelected ? selectedFixtureClass : ""}"
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
                    ${renderFixturePickBadgeApp_(homePickStats, f, "home")}
                  </div>
                ` : ""}

                ${homeClickable ? `
                  <button
                    type="button"
                    class="fixture-team-select-btn team-name team-name-home ${homeSelected ? "is-selected fixture-team--selected" : ""}"
                    data-select-fixture-team="1"
                    data-team="${escapeAttr(f.home)}"
                    data-gw-id="${escapeAttr(f.gwId)}"
                    style="
                      min-width:0;
                      line-height:1.15;
                      text-align:right;
                      white-space:normal;
                      word-break:normal;
                      overflow-wrap:normal;
                    "
                  >
                    ${escapeHtml(displayTeamNameForFixture_(f.home))}
                  </button>
                ` : `
                  <div
                    class="team-name team-name-home ${homeSelected ? "is-selected fixture-team--selected" : ""}"
                    style="
                      min-width:0;
                      line-height:1.15;
                      text-align:right;
                      white-space:normal;
                      word-break:normal;
                      overflow-wrap:normal;
                    "
                  >
                    ${escapeHtml(displayTeamNameForFixture_(f.home))}
                  </div>
                `}

                <img
                  src="${escapeAttr(leftLogo)}"
                  alt="${escapeAttr(f.home)}"
                  class="team-logo"
                  style="display:block;width:22px;height:22px;object-fit:contain;"
                  onerror="this.onerror=null;this.src='site/images/team-default.png';"
                />
              </div>

              <div style="display:flex;justify-content:center;align-items:center;">
                ${renderFixtureMiddleBoxApp_(f)}
              </div>

              <div
                class="${awaySelected ? selectedFixtureClass : ""}"
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
                  src="${escapeAttr(rightLogo)}"
                  alt="${escapeAttr(f.away)}"
                  class="team-logo"
                  style="display:block;width:22px;height:22px;object-fit:contain;"
                  onerror="this.onerror=null;this.src='site/images/team-default.png';"
                />

                ${awayClickable ? `
                  <button
                    type="button"
                    class="fixture-team-select-btn team-name team-name-away ${awaySelected ? "is-selected fixture-team--selected" : ""}"
                    data-select-fixture-team="1"
                    data-team="${escapeAttr(f.away)}"
                    data-gw-id="${escapeAttr(f.gwId)}"
                    style="
                      min-width:0;
                      line-height:1.15;
                      text-align:left;
                      white-space:normal;
                      word-break:normal;
                      overflow-wrap:normal;
                    "
                  >
                    ${escapeHtml(displayTeamNameForFixture_(f.away))}
                  </button>
                ` : `
                  <div
                    class="team-name team-name-away ${awaySelected ? "is-selected fixture-team--selected" : ""}"
                    style="
                      min-width:0;
                      line-height:1.15;
                      text-align:left;
                      white-space:normal;
                      word-break:normal;
                      overflow-wrap:normal;
                    "
                  >
                    ${escapeHtml(displayTeamNameForFixture_(f.away))}
                  </div>
                `}

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
                    ${renderFixturePickBadgeApp_(awayPickStats, f, "away")}
                  </div>
                ` : ""}
              </div>
            </div>

            <div class="fixture-datetime muted" style="text-align:center;margin-top:2px;line-height:1.1;">
              ${hasScore ? formatResultStatusLabelApp_(f.resultStatus) : ""}
            </div>
          </div>
        `;

        container.appendChild(row);
      }

      if (singleCompetition) {
        dayGroup.appendChild(container);
      } else {
        details.appendChild(container);
        dayGroup.appendChild(details);
      }
    }

    fixturesList.appendChild(dayGroup);
  }

  fixturesList.querySelectorAll("[data-select-fixture-team]").forEach(btn => {
    btn.addEventListener("click", () => {
      const team = btn.getAttribute("data-team") || "";
      const gwId = btn.getAttribute("data-gw-id") || currentGwId;

      viewingGwId = gwId;

      showPickConfirmModal_(team, gwId);
    });
  });

  bindFixturePickBadgeEvents_();
}

function isPlaceholderTeam_(team) {
  const s = String(team || "").trim().toUpperCase();
  return ["TBD", "TBC", "TO BE DECIDED", "TO BE CONFIRMED"].includes(s);
}

function isFixtureResolved_(fixture) {
  const status = String(fixture?.resultStatus || "").trim().toLowerCase();

  if (["final", "finished", "ft", "aet", "pens"].includes(status)) {
    return true;
  }

  const hasHomeScore =
    fixture?.homeScore !== null &&
    fixture?.homeScore !== undefined &&
    String(fixture.homeScore).trim() !== "" &&
    Number.isFinite(Number(fixture.homeScore));

  const hasAwayScore =
    fixture?.awayScore !== null &&
    fixture?.awayScore !== undefined &&
    String(fixture.awayScore).trim() !== "" &&
    Number.isFinite(Number(fixture.awayScore));

  return hasHomeScore && hasAwayScore;
}

async function loadGameArchivesOnce_() {
  if (Object.keys(GAME_ARCHIVES || {}).length) return;

  try {
    const res = await fetch(GAME_ARCHIVES_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${GAME_ARCHIVES_URL}`);
    GAME_ARCHIVES = await res.json();
  } catch (err) {
    console.warn("Game archives failed to load", err);
    GAME_ARCHIVES = {};
  }
}

function canClickAnyFixtureTeamForGw_(gwId) {
  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );

  if (!gw) return false;

  return (gw.fixtures || []).some(f =>
    canClickFixtureTeam_(f.home, gw.id) ||
    canClickFixtureTeam_(f.away, gw.id)
  );
}

/*******************************
 * RENDER: ENTRIES TAB
 *******************************/


async function renderEntriesTab() {
  if (!aliveList || !outList) return;
  if (entriesLoading) return;
  entriesLoading = true;

  const myReq = ++entriesReqId;

  const aliveCountEl = document.getElementById("aliveCount");
  const outCountEl = document.getElementById("outCount");

  // Only show dots if we have no value yet (first load)
  if (aliveCountEl && (aliveCountEl.textContent || "").trim() === "—") {
    aliveCountEl.innerHTML = `<span class="dots" aria - label="Loading" ></span > `;
  }
  if (outCountEl && (outCountEl.textContent || "").trim() === "—") {
    outCountEl.innerHTML = `<span class="dots" aria - label="Loading" ></span > `;
  }

  try {
    const gwIdForEntries = getEntriesViewGwId_();
    console.time("getEntries");
    const data = await api({ action: "getEntries", gameId: activeGameId, gwId: gwIdForEntries });
    console.timeEnd("getEntries");
    console.log("getEntries source:", data.source, data.users?.length);
    if (myReq !== entriesReqId) return;

    let users = data.users || [];

    try {
      const sheets = await api({
        action: "getEntriesFromSheets",
        gameId: activeGameId,
        gwId: gwIdForEntries
      });

      const sheetsUsers = Array.isArray(sheets.users) ? sheets.users : [];
      const profileByEmail = new Map();
      const pickByEmail = new Map();

      sheetsUsers.forEach(r => {
        const email = String(r.email || "").trim().toLowerCase();
        const team = String(r.selection || r.team || r.pick || "").trim();
        if (email) profileByEmail.set(email, r);
        if (email && team) pickByEmail.set(email, team);
      });

      users = users.map(u => {
        const email = String(u.email || "").trim().toLowerCase();
        const profile = profileByEmail.get(email) || {};
        const fallbackTeam = pickByEmail.get(email);

        return {
          ...u,
          firstName: String(u.firstName || profile.firstName || "").trim(),
          lastName: String(u.lastName || profile.lastName || "").trim(),
          clubTeam: String(u.clubTeam || profile.clubTeam || "").trim(),
          phone: String(u.phone || profile.phone || "").trim(),
          ...(fallbackTeam ? {
            submittedForGw: true,
            selection: fallbackTeam,
            team: fallbackTeam
          } : {})
        };
      });

      console.warn("Emergency Sheets fallback applied", {
        gwIdForEntries,
        sheetsUsers: sheetsUsers.length,
        matchedProfiles: profileByEmail.size,
        matchedPicks: pickByEmail.size
      });
    } catch (err) {
      console.warn("Emergency Sheets entries fallback failed", err);
    }
    users = users.map(u => {
      const picks = Array.isArray(u.picks) ? u.picks : [];
      const currentGwPick = picks.find(p =>
        String(p.gwId || "").trim().toUpperCase() === String(gwIdForEntries || "").trim().toUpperCase()
      );

      const currentGwTeam = String(
        currentGwPick?.team ||
        currentGwPick?.selection ||
        u.selection ||
        u.team ||
        ""
      ).trim();

      const currentGwOutcome = String(currentGwPick?.outcome || u.outcome || "PENDING")
        .trim()
        .toUpperCase();

      const submittedForGw =
        !!currentGwTeam &&
        !["VOID"].includes(currentGwOutcome);

      return {
        ...u,
        submittedForGw,
        selection: currentGwTeam,
        team: currentGwTeam
      };
    });
    const total = users.length;

    const started = hasCompetitionStarted_();

    // ---- Bucket users depending on started ----
    // Before GW1: Approved vs Pending approval
    // After GW1: Alive vs Out
    const approvedUsers = users.filter(u => isApproved_(u));
    const pendingUsers = users.filter(u => !isApproved_(u));

    const aliveUsers = users.filter(u => u.alive);
    const outUsers = users.filter(u => !u.alive);

    const leftUsers = started ? aliveUsers : approvedUsers;
    const rightUsers = started ? outUsers : pendingUsers;

    // ---- Update headings ----
    const aliveH3 = aliveCountEl?.closest("h3");
    if (aliveH3) aliveH3.childNodes[0].nodeValue = started ? "Alive " : "Approved ";

    const outH3 = outCountEl?.closest("h3");
    if (outH3) outH3.childNodes[0].nodeValue = started ? "Dead " : "Pending approval ";

    // ---- Counts ----
    if (aliveCountEl) aliveCountEl.textContent = String(leftUsers.length);
    if (outCountEl) outCountEl.textContent = String(rightUsers.length);

    // ---- Signature (must match the SAME buckets) ----
    const sig = JSON.stringify({
      gw: gwIdForEntries,
      started,
      total,
      left: leftUsers.map(u => [u.email, !!u.alive, isApproved_(u), !!u.submittedForGw]).sort(),
      right: rightUsers.map(u => [u.email, !!u.alive, isApproved_(u), u.knockedOutGw, u.knockedOutTeam, !!u.submittedForGw]).sort()
    });

    if (sig === lastEntriesSig) return;
    lastEntriesSig = sig;

    // ---- Sort ----
    leftUsers.sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));

    if (started) {
      // Out list: show most recently KO'd first
      rightUsers.sort((a, b) => {
        const na = gwNumFromId(a.knockedOutGw) ?? -1;
        const nb = gwNumFromId(b.knockedOutGw) ?? -1;
        if (nb !== na) return nb - na;
        return (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName);
      });
    } else {
      // Pending approvals: alphabetical
      rightUsers.sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
    }

    // ---- Status text (KEEP your statuses) ----
    function entryStatus_(u) {
      const approved = isApproved_(u);

      if (!approved) return { text: "Pending approval", cls: "pending", icon: "…", stateCls: "warn" };
      if (u.submittedForGw) return { text: "Team submitted", cls: "submitted", icon: "✓", stateCls: "good" };
      return { text: "Not submitted", cls: "neutral", icon: "…", stateCls: "muted" };
    }

    // ---- Left HTML ----
    const leftHtml = leftUsers.map(u => {
      const st = entryStatus_(u);
      return `
  <div class="list-item player-row-alive entry-${st.cls}" data-email="${escapeAttr(u.email)}" style = "cursor:pointer;" >
          <div class="list-left">
            <div class="list-title">${escapeHtml(`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.name || u.email || "Player")}</div>
            <div class="list-sub">${escapeHtml(st.text)}</div>
          </div>
          <div class="state ${st.stateCls}">${st.icon}</div>
        </div >
  `;
    }).join("");

    // ---- Right HTML ----
    const rightHtml = rightUsers.map(u => {
      if (started) {
        // Out list uses KO line
        const koLine = `${u.knockedOutGw || "—"} - ${u.knockedOutTeam || "—"} `;
        return `
  <div class="list-item row-loss player-row-out" data-email="${escapeAttr(u.email)}" style = "cursor:pointer;" >
            <div class="list-left">
              <div class="list-title">${escapeHtml(`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.name || u.email || "Player")}</div>
              <div class="list-sub">${escapeHtml(koLine)}</div>
            </div>
            <div class="state bad">✕</div>
          </div >
  `;
      }

      // Pre-start pending approvals: keep the pending approval status row style
      const st = entryStatus_(u); // will be "Pending approval"
      return `
  <div class="list-item player-row-out entry-${st.cls}" data-email="${escapeAttr(u.email)}" style = "cursor:pointer;" >
          <div class="list-left">
            <div class="list-title">${escapeHtml(`${u.firstName || ""} ${u.lastName || ""}`.trim() || u.name || u.email || "Player")}</div>
            <div class="list-sub">${escapeHtml(st.text)}</div>
          </div>
          <div class="state ${st.stateCls}">${st.icon}</div>
        </div >
  `;
    }).join("");

    // Paint HTML
    aliveList.innerHTML = leftHtml || `<div class="muted" > ${started ? "No alive players." : "No approved players."}</div > `;
    outList.innerHTML = rightHtml || `<div class="muted" > ${started ? "No knocked out players." : "No pending approvals."}</div > `;

    // Bind Left clicks
    aliveList.querySelectorAll("[data-email]").forEach(rowEl => {
      rowEl.addEventListener("click", () => {
        const email = rowEl.getAttribute("data-email");
        const player = leftUsers.find(x => String(x.email).toLowerCase() === String(email).toLowerCase());
        if (!player) return;
        openPlayerPicksModal_(player, gwIdForEntries, users);
      });
    });

    // Bind Right clicks
    outList.querySelectorAll("[data-email]").forEach(rowEl => {
      rowEl.addEventListener("click", () => {
        const email = rowEl.getAttribute("data-email");
        const player = rightUsers.find(x => String(x.email).toLowerCase() === String(email).toLowerCase());
        if (!player) return;
        openPlayerPicksModal_(player, gwIdForEntries, users);
      });
    });

  } catch (err) {
    console.warn(err);
  } finally {
    entriesLoading = false;
  }
}


function openCompetitionsModalForGame_(gameId) {
  const game = (gamesList || []).find(g => String(g.id || "") === String(gameId || ""));
  const competitions = getGameCompetitions_(game);

  showSystemModal_(
    "Competitions included",
    `
      <div style="line-height:1.55;">
        <div class="game-competitions-modal-list">
          ${competitions.map(name => `
            <div class="competition-modal-row">
              <img
                class="competition-modal-logo"
                src="${escapeAttr(getCompetitionLogo_(name))}"
                alt="${escapeAttr(name)}"
                onerror="this.onerror=null;this.src='site/images/competitions/default.png';"
              />
              <span>${escapeHtml(name)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `,
    { showActions: false }
  );
}

if (forgotPasswordLink && forgotPasswordModal) {
  forgotPasswordLink.addEventListener("click", (e) => {
    e.preventDefault();

    forgotPasswordForm?.reset();

    if (forgotPasswordMsg) {
      forgotPasswordMsg.textContent = "";
      forgotPasswordMsg.classList.add("hidden");
      forgotPasswordMsg.classList.remove("good", "bad");
    }

    openModal(forgotPasswordModal);
    setTimeout(() => forgotPasswordEmail?.focus(), 0);
  });
}

forgotPasswordForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = String(forgotPasswordEmail?.value || "").trim();

  if (!forgotPasswordMsg) return;

  forgotPasswordMsg.classList.add("hidden");
  forgotPasswordMsg.classList.remove("good", "bad");
  forgotPasswordMsg.textContent = "";

  setBtnLoading(forgotPasswordSubmitBtn, true);

  try {
    const data = await api({
      action: "requestPasswordReset",
      email
    });

    setBtnLoading(forgotPasswordSubmitBtn, false);

    forgotPasswordMsg.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:8px;">
        <span style="font-weight:700;">✓</span>
        <span>${escapeHtml(data.message || "If an account exists for that email, a reset link has been sent.")}</span>
      </span>
    `;
    forgotPasswordMsg.classList.remove("hidden");
    forgotPasswordMsg.classList.add("good");

  } catch (err) {
    setBtnLoading(forgotPasswordSubmitBtn, false);

    forgotPasswordMsg.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:8px;">
        <span style="font-weight:700;">✕</span>
        <span>${escapeHtml(String(err.message || err))}</span>
      </span>
    `;
    forgotPasswordMsg.classList.remove("hidden");
    forgotPasswordMsg.classList.add("bad");
  }
});

function split2_(n) {
  return String(Math.max(0, Number(n) || 0)).padStart(2, "0");
}

function getCountdownParts_(targetValue) {
  const targetMs = new Date(targetValue).getTime();
  if (!Number.isFinite(targetMs)) {
    return {
      days: "00",
      hours: "00",
      mins: "00",
      secs: "00",
      done: true
    };
  }

  const nowMs = Date.now();
  const diff = Math.max(0, Math.floor((targetMs - nowMs) / 1000));

  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;

  return {
    days: split2_(Math.min(days, 99)),
    hours: split2_(hours),
    mins: split2_(mins),
    secs: split2_(secs),
    done: diff <= 0
  };
}


function formatDeadlineDay_(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";

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

function formatDeadlineTime_(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(d);

  const hour = parts.find(p => p.type === "hour")?.value || "";
  const minute = parts.find(p => p.type === "minute")?.value || "00";
  const dayPeriod = (parts.find(p => p.type === "dayPeriod")?.value || "").toUpperCase();

  return `${hour}:${minute}${dayPeriod}`;
}

function paintCountdownEl_(root, targetValue) {
  if (!root || !targetValue) return;

  const parts = getCountdownParts_(targetValue);

  const nextMap = {
    "days-h": parts.days[0],
    "days-l": parts.days[1],
    "hours-h": parts.hours[0],
    "hours-l": parts.hours[1],
    "mins-h": parts.mins[0],
    "mins-l": parts.mins[1],
    "secs-h": parts.secs[0],
    "secs-l": parts.secs[1]
  };

  root.querySelectorAll(".cool-digit").forEach(el => {
    const key = el.dataset.unit;
    const next = nextMap[key] ?? "0";
    const prev = el.textContent;

    if (prev !== next) {
      el.textContent = next;
      el.classList.remove("is-tick");
      void el.offsetWidth;
      el.classList.add("is-tick");
    }
  });

  if (parts.done) {
    root.classList.add("is-complete");
  } else {
    root.classList.remove("is-complete");
  }
}

let countdownTimer_ = null;

function startCountdowns_() {
  if (countdownTimer_) clearInterval(countdownTimer_);

  const tick = () => {
    document.querySelectorAll("[data-countdown]").forEach(el => {
      paintCountdownEl_(el, el.getAttribute("data-countdown"));
    });
  };

  tick();
  countdownTimer_ = setInterval(tick, 1000);
}

function isEntryWinner_(entry, remainingCount) {
  return !!entry && !!entry.approved && entry.alive !== false && Number(remainingCount || 0) === 1;
}

function renderLobby_() {
  if (!lobbyView) return;

  const lobbySig = JSON.stringify({
    sessionEmail: sessionEmail || "",
    games: (gamesList || []).map(g => ({
      id: g.id,
      status: g.status,
      winner: g.winner,
      counts: lobbyCountsByGame[String(g.id || "")] || null,
      countsLoading: !!lobbyCountsLoading[String(g.id || "")],
      entry: getMyEntryForGame_(g.id) || null
    }))
  });

  if (lobbySig === lastLobbyRenderSig) return;
  lastLobbyRenderSig = lobbySig;

  const renderGameCard_ = (g) => {
    const gameId = String(g.id || "");
    const title = String(g.title || gameId);
    const bio = String(g.bio || "").trim();
    const bannerSlug = slugifyGameTitle_(title);
    const status = String(g.status || "OPEN").toUpperCase();
    const prizeInfo = parsePrizeInfo_(g?.prize);
    const winner = String(g.winner || "").trim();
    const entry = getMyEntryForGame_(gameId);

    const counts = lobbyCountsByGame[gameId];

    const firstGw = getGameFirstGw_(g);
    const normalDeadlineIso = firstGw?.deadline ? firstGw.deadline.toISOString() : "";
    const lateDeadlineIso = firstGw?.lateDeadline ? firstGw.lateDeadline.toISOString() : "";
    const lateRegistrationOpen = isGameLateRegistrationOpen_(g);
    const canRegisterNow = isGameRegistrationOpenNow_(g);

    const isNewGame = status === "OPEN" && canRegisterNow;

    const deadlineIso = lateRegistrationOpen ? lateDeadlineIso : normalDeadlineIso;

    const showLobbyCountdown = status === "OPEN" && !!deadlineIso && canRegisterNow;

    let actionsHtml = "";

    if (!sessionEmail) {
      if (canRegisterNow || lateRegistrationOpen) {
        actionsHtml = `<button class="btn btn-secondary" type="button" data-auth-required="1">Login to register</button>`;
      } else {
        actionsHtml = "";
      }
    } else if (!entry) {
      if (canRegisterNow) {
        actionsHtml = `<button class="btn btn-primary" type="button" data-join-game="${escapeAttr(gameId)}">${lateRegistrationOpen ? "Late register" : "Register now"}</button>`;
      } else {
        actionsHtml = "";
      }
    } else if (status === "OPEN" && !entry.approved) {
      if (isPaymentWorkflowGame_(gameId)) {
        actionsHtml = `<button class="btn btn-primary" type="button" data-pay-game="${escapeAttr(gameId)}">Payment details</button>`;
      } else {
        actionsHtml = `<button class="btn btn-primary" type="button" data-enter-game="${escapeAttr(gameId)}">Enter game →</button>`;
      }
    } else {
      actionsHtml = entry?.alive === false
        ? `<button class="btn btn-ghost" type="button" data-enter-game="${escapeAttr(gameId)}">View game →</button>`
        : `<button class="btn btn-primary" type="button" data-enter-game="${escapeAttr(gameId)}">Enter game →</button>`;
    }

    return `
      <div class="game-hero-card lobby-hero-card" style="margin-bottom:16px;">
        <div class="game-hero-banner lobby-hero-banner ${escapeAttr(bannerSlug)}-banner ${status === "FINISHED" ? "game-banner--finished" : ""}">
        <img
          class="game-hero-banner-img ${escapeAttr(bannerSlug)}-banner-img"
          src="${escapeAttr(getGameBannerUrl_(gameId))}"
          alt="${escapeAttr(title)} banner"
          loading="eager"
          decoding="async"
          onerror="this.onerror=null;this.src='site/images/game-banners/default.png';"
        />

        ${isNewGame ? `
          <div class="game-new-badge">NEW</div>
        ` : ``}


          <div>
            <button
              class="hero-nav-btn"
              type="button"
              data-lobby-info="${escapeAttr(gameId)}"
              aria-label="Competition info"
            >i</button>
          </div>

          <div class="game-hero-banner-badges game-hero-banner-badges--left">
            ${status !== "OPEN" ? `
              <span class="game-hero-badge">
                ${getPlayersBadgeHtml_(g, counts)}
              </span>
            ` : ``}

            ${status === "OPEN" || status === "FINISHED"
        ? `
                    <span class="game-hero-badge">
                      <span class="hero-pill-tooltip" data-tooltip="Entry fee">
                        <span class="pill-emoji">🎟️</span> £${Number(g.entryFee || 0)}
                      </span>
                    </span>
                  `
        : ``
      }

            ${prizeInfo.isRollover
        ? `
                    <span class="game-hero-badge">
                      ${getRolloverPillHtml_(g)}
                    </span>
                  `
        : prizeInfo.hasPrize
          ? `
                    <span class="game-hero-badge">
                      ${getPrizePillHtml_(g)}
                    </span>
                  `
          : ``
      }
          </div>

          <div class="game-hero-banner-badges game-hero-banner-badges--right">
            <span class="game-status-pill ${getGameBannerStatusClass_(g, entry)}">
              <span class="hero-pill-tooltip" data-tooltip="Status">
                ${escapeHtml(getGameBannerStatusText_(g, entry))}
              </span>
            </span>
          </div>
        </div>
        <div class="game-hero-info">
          <div class="lobby-bottom-top">
            <div class="game-hero-player-name">${escapeHtml(title)}</div>

            <button
              type="button"
              class="text-link-btn lobby-competitions-link"
              data-lobby-competitions="${escapeAttr(gameId)}"
            >
              Competitions
            </button>
          </div>

          ${bio ? `
            <div class="lobby-game-bio">${escapeHtml(bio)}</div>
          ` : ``}

          <div class="lobby-bottom-main">
            <div class="lobby-fit">
              <div class="lobby-fit-left">
              ${status === "FINISHED"
        ? `
                    <div class="lobby-meta-line">
                      <span class="lobby-meta-key">${String(winner || "").includes(",") ? "Winners:" : "Winner:"}</span>
                      <strong class="lobby-meta-key2">${escapeHtml(winner || "No Winner")}</strong>
                    </div>
                  `
        : ``}

          ${status === "OPEN" && !entry && canRegisterNow
        ? `
              <div class="lobby-meta-line">
                <span class="lobby-meta-key">Entry fee:</span>
                <strong class="lobby-meta-key2">£${Number(g.entryFee || 0)}</strong>
              </div>

              ${deadlineIso ? `
                <div class="lobby-meta-line">
                  <span class="lobby-meta-key">${lateRegistrationOpen ? "Late entry deadline:" : "Entry deadline:"}</span>
                  <div class="lobby-meta-key2">
                    <strong>${escapeHtml(formatDeadlineDay_(deadlineIso))} · ${escapeHtml(formatDeadlineTime_(deadlineIso))}</strong>
                  </div>
                </div>
              ` : ``}
            `
        : ``
      }
              </div>
            </div>
          </div>

          ${showLobbyCountdown && !entry ? `
            <div class="lobby-deadline-panel lobby-deadline-panel--red" data-countdown="${escapeAttr(deadlineIso)}">
              <div class="lobby-deadline-panel-head">
                <div class="lobby-deadline-panel-line">
                  <span class="lobby-deadline-panel-label">${lateRegistrationOpen ? "Late entry closes in:" : "Game starts in:"}</span>
                </div>
              </div>

              <div class="cool-countdown cool-countdown--compact" aria-label="Entry deadline countdown">
                <div class="cool-countdown-group">
                  <span class="cool-digit" data-unit="days-h">0</span>
                  <span class="cool-digit" data-unit="days-l">0</span>
                </div>
                <span class="cool-sep">:</span>

                <div class="cool-countdown-group">
                  <span class="cool-digit" data-unit="hours-h">0</span>
                  <span class="cool-digit" data-unit="hours-l">0</span>
                </div>
                <span class="cool-sep">:</span>

                <div class="cool-countdown-group">
                  <span class="cool-digit" data-unit="mins-h">0</span>
                  <span class="cool-digit" data-unit="mins-l">0</span>
                </div>
                <span class="cool-sep">:</span>

                <div class="cool-countdown-group">
                  <span class="cool-digit" data-unit="secs-h">0</span>
                  <span class="cool-digit" data-unit="secs-l">0</span>
                </div>
              </div>
            </div>
          ` : ``}
            <div class="lobby-status-actions-row">

            ${sessionEmail && entry ? (
        status === "FINISHED"
          ? `
                  <div class="lobby-meta-line" style="margin:0;">
                    <span class="lobby-meta-key">Finished:</span>
                    <strong class="lobby-meta-key2">
                      ${entry?.placing
            ? `${entry.placing}${ordinalSuffix_(entry.placing)}`
            : entry?.alive === false
              ? "Eliminated"
              : "—"
          }
                      ${counts?.total ? ` of ${counts.total}` : ""}
                      ${entry?.placing === 1 ? " 🏆" : ""}
                    </strong>
                  </div>
                `
          : `
                  <div class="lobby-meta-line" style="margin:0;">
                    <span class="lobby-meta-key">Your status:</span>
                    <span class="player-status-pill ${getPlayerStatusUi_(g, entry).pillClass}">
                      <span>${getPlayerStatusUi_(g, entry).text}</span>
                      <span class="state ${getPlayerStatusUi_(g, entry).stateClass}">
                        ${getPlayerStatusUi_(g, entry).icon}
                      </span>
                    </span>
                  </div>
                `
      ) : `<div></div>`}

              ${actionsHtml ? `
                <div class="lobby-card-actions" style="margin:0;">
                  ${actionsHtml}
                </div>
              ` : ``}
            </div>
        </div>
      </div>
    `;
  };

  const activeGames = (gamesList || []).filter(g => {
    const s = String(g.status || "").toUpperCase();
    return s !== "FINISHED";
  });

  const finishedGames = (gamesList || []).filter(g => {
    const s = String(g.status || "").toUpperCase();
    return s === "FINISHED";
  });

  const activeCardsHtml = activeGames.map(renderGameCard_).join("");
  const finishedCardsHtml = finishedGames.map(renderGameCard_).join("");

  const cardsHtml = `
    ${activeCardsHtml || `<div class="muted">No active games available.</div>`}

    ${finishedGames.length ? `
      <details id="finishedGamesDetails" class="fixtures-card collapse-card" style="margin-top:16px;" ${finishedGamesOpen ? "open" : ""}>
        <summary class="collapse-summary">
          <h3 style="margin:0;">Finished games <span class="muted small">(${finishedGames.length})</span></h3>
          <span class="caret">▸</span>
        </summary>

        <div style="margin-top:12px;">
          ${finishedCardsHtml}
        </div>
      </details>
    ` : ``}
  `;

  const profileDisplayName =
    String(sessionUser?.firstName || "").trim() || "Profile";

  const lobbyTopRightHtml = sessionEmail
    ? `
    <button id="lobbyProfileBtn" class="profile-chip-btn" type="button" title="Profile">
      <span class="profile-chip-icon">👤</span>
    </button>
  `
    : `<button id="lobbyAuthBtn" class="btn btn-secondary" type="button">Login/register</button>`;

  lobbyView.innerHTML = `
    <div class="phone">
      <header class="topbar">
        <div class="brand auth-brand">
          <img class="brand-logo" src="site/images/lmsSquare5.jpg" alt="Polytechnic FC" />
          <div class="brand-text">
            <div class="brand-title">Last Man Standing</div>
            <div class="brand-sub">Polytechnic FC</div>
          </div>
        </div>

        <div class="top-actions">
          ${lobbyTopRightHtml}
        </div>
      </header>

      <hr class="auth-divider">

      <main class="content">
        <div class="main-card">
          <div class="lobby-title">
            LOBBY
          </div>
          ${cardsHtml || `<div class="muted">No games available.</div>`}
        </div>
      </main>
    </div>
  `;

  document.getElementById("finishedGamesDetails")?.addEventListener("toggle", (e) => {
    finishedGamesOpen = e.currentTarget.open;
  });

  document.getElementById("lobbyAuthBtn")?.addEventListener("click", async () => {
    showSplash(true);

    try {
      showRegisterBtn?.classList.remove("active");
      showLoginBtn?.classList.add("active");
      registerForm?.classList.add("hidden");
      loginForm?.classList.remove("hidden");
      authMsg?.classList.add("hidden");

      authView.classList.remove("hidden");
      lobbyView?.classList.add("hidden");
      appView.classList.add("hidden");
    } finally {
      showSplash(false);
    }
  });

  lobbyView.querySelectorAll("[data-lobby-competitions]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gameId = btn.getAttribute("data-lobby-competitions");
      openCompetitionsModalForGame_(gameId);
    });
  });

  lobbyView.querySelectorAll("[data-auth-required]").forEach(btn => {
    btn.addEventListener("click", () => {
      authView.classList.remove("hidden");
      lobbyView?.classList.add("hidden");
      appView.classList.add("hidden");
    });
  });

  lobbyView.querySelectorAll("[data-join-game]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const gameId = btn.getAttribute("data-join-game");
      await joinGame_(gameId, btn);
    });
  });

  lobbyView.querySelectorAll("[data-enter-game]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const gameId = btn.getAttribute("data-enter-game");
      await enterGame_(gameId);
    });
  });

  lobbyView.querySelectorAll("[data-pay-game]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gameId = btn.getAttribute("data-pay-game");
      showPaymentDetailsModal_(gameId);
    });
  });

  lobbyView.querySelectorAll("[data-lobby-info]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gameId = btn.getAttribute("data-lobby-info");
      openInfoModalForGame_(gameId);
    });
  });

  document.getElementById("lobbyProfileBtn")?.addEventListener("click", () => {
    const body = document.getElementById("profileModalBody");
    if (!body) return;

    body.innerHTML = `
    <div style="margin-top:12px" class="fixtures-card">
      <div class="muted small"><strong>Name</strong></div>
      <div style="margin:4px 0;">${escapeHtml(`${sessionUser?.firstName || ""} ${sessionUser?.lastName || ""}`.trim() || "—")}</div>

      <div style="margin-top:10px" class="muted small"><strong>Email</strong></div>
      <div style="margin-top:4px;">${escapeHtml(sessionUser?.email || "—")}</div>

      <div style="margin-top:10px" class="muted small"><strong>Phone</strong></div>
      <div style="margin-top:4px;">${escapeHtml(sessionUser?.phone || "—")}</div>

      <div style="margin-top:10px" class="muted small"><strong>Team / Connection</strong></div>
      <div style="margin-top:4px;">${escapeHtml(sessionUser?.clubTeam || "—")}</div>
    </div>
  `;

    openModal(profileModal);
  });
  startCountdowns_();
}

let joinGameBusy = false;

async function joinGame_(gameId, triggerBtn = null) {
  if (joinGameBusy) return;

  if (!sessionEmail) {
    showSplash(true);
    try {
      showRegisterBtn?.classList.add("active");
      showLoginBtn?.classList.remove("active");
      registerForm?.classList.remove("hidden");
      loginForm?.classList.add("hidden");
      authMsg?.classList.add("hidden");

      authView.classList.remove("hidden");
      lobbyView?.classList.add("hidden");
      appView.classList.add("hidden");
    } finally {
      showSplash(false);
    }
    return;
  }

  joinGameBusy = true;
  setBtnLoading(triggerBtn, true);

  const sess = getSession() || {};
  const joinProfile = {
    firstName: sessionUser?.firstName || sess.firstName || "",
    lastName: sessionUser?.lastName || sess.lastName || "",
    clubTeam: sessionUser?.clubTeam || sess.clubTeam || "",
    phone: sessionUser?.phone || sess.phone || ""
  };

  try {
    if (isPaymentWorkflowGame_(gameId)) {
      const existingEntry = getMyEntryForGame_(gameId);

      if (existingEntry && isApproved_(existingEntry)) {
        await enterGame_(gameId);
        joinGameBusy = false;
        return;
      }
      const game = (gamesList || []).find(g => String(g.id) === String(gameId));
      const entryFee = Number(game?.entryFee || 10);

      // OPEN THE PAYMENT SHEET IMMEDIATELY
      setBtnLoading(triggerBtn, false);
      showPaymentWorkflowModal_(gameId, "", { loading: true });

      fetchMyEntries_().then(() => {
        const freshEntry = getMyEntryForGame_(gameId);

        if (freshEntry && isApproved_(freshEntry)) {
          closeModal(systemModal);
          return enterGame_(gameId);
        }
      }).catch(() => { });

      // Backend happens in the background
      api(
        {
          action: "joinGame",
          email: sessionEmail,
          gameId,
          ...joinProfile
        },
        { timeoutMs: 30000 }
      )
        .then(async (resp) => {
          const paymentRef = String(resp?.paymentRef || "").trim();

          if (paymentRef) {
            saveStoredPaymentRef_(gameId, paymentRef);
          }

          // redraw sheet with real ref once backend returns
          showPaymentWorkflowModal_(gameId, paymentRef, { loading: false });

          await fetchMyEntries_();
          snapshotLobbyApprovalStates_();
          renderLobby_();
          refreshLobbyCounts_().catch(() => { });
        })
        .catch((err) => {
          console.warn("Payment workflow join failed", err);

          showPaymentWorkflowModal_(gameId, "", {
            loading: false,
            error: String(err.message || err)
          });

          const msg = document.getElementById("paymentSheetMsg");
          if (msg) {
            msg.innerHTML = `
              <div class="payment-status-card payment-status-card--pending">
                <div class="payment-status-card__icon">!</div>
                <div class="payment-status-card__content">
                  <div class="payment-status-card__title">Could not start registration</div>
                  <div class="payment-status-card__text">${escapeHtml(String(err.message || err))}</div>
                </div>
              </div>
            `;
            msg.classList.remove("hidden", "good");
            msg.classList.add("bad");
          }
        })
        .finally(() => {
          joinGameBusy = false;
        });

      return;
    }

    // non-payment workflow games keep old behaviour
    const resp = await api(
      {
        action: "joinGame",
        email: sessionEmail,
        gameId,
        ...joinProfile
      },
      { timeoutMs: 30000 }
    );

    const game = (gamesList || []).find(g => String(g.id) === String(gameId));
    const entryFee = Number(game?.entryFee || 10);

    showSplash(true);

    try {
      await fetchMyEntries_();
      snapshotLobbyApprovalStates_();

      await enterGame_(gameId);

      showSystemModal_(
        "Registration",
        `
          <div style="line-height:1.5;">
            <p style="margin:0 0 10px;">
              To register for the game please pay the registration fee.
            </p>
            <p style="margin:0 0 12px;">
              Once approved you will be able to make your first selection.
            </p>
            ${payInstructionsHtml_({
          gameTitle: String(game?.title || "Competition").trim(),
          paymentRef: "",
          entryFee
        })}
          </div>
        `,
        { showActions: false }
      );

      refreshLobbyCounts_().catch(() => { });
    } finally {
      showSplash(false);
    }

  } catch (err) {
    showSystemModal_(
      "Registration",
      `<div style="line-height:1.5;"><p style="margin:0;">${escapeHtml(String(err.message || err))}</p></div>`,
      { showActions: false }
    );
  } finally {
    if (joinGameBusy) {
      setBtnLoading(triggerBtn, false);
      joinGameBusy = false;
    }
  }
}

function showGameView_() {
  stopLobbyPolling_();

  authView.classList.add("hidden");
  lobbyView?.classList.add("hidden");
  appView.classList.remove("hidden");

  logoutBtnOuter?.classList.add("hidden");

  if (sessionEmail) {
    logoutBtnApp?.classList.remove("hidden");
  } else {
    logoutBtnApp?.classList.add("hidden");
  }

  renderGameHeaderAuth_();
}

async function enterGame_(gameId) {
  const seq = ++enterGameSeq;

  activeGameId = String(gameId || "");

  viewingGwId = null;
  currentGwId = null;
  isEditingCurrentPick = false;
  sessionPicks = [];
  usedTeams = new Set();
  activeEntry = sessionEmail ? getMyEntryForGame_(activeGameId) || null : null;

  lastRemainingPlayers = null;
  lastTotalPlayers = null;
  lastApprovedPlayers = null;
  lastPendingPlayers = null;
  lastEntriesSig = "";
  lastGwReportSig = "";
  lastGwReportCount = null;
  lastGwReportCountGwId = null;

  showSplash(true);

  if (gwTitle) gwTitle.textContent = "Loading…";
  if (gwRangeEl) gwRangeEl.textContent = "—";
  if (statusBox) statusBox.innerHTML = "";
  if (fixturesList) fixturesList.innerHTML = "";
  if (aliveList) aliveList.innerHTML = "";
  if (outList) outList.innerHTML = "";

  showGameView_();

  try {
    await initDataAndRenderGame_({
      allowOutcomeModal: !!sessionEmail,
      gameId: activeGameId,
      enterSeq: seq
    });

    if (seq !== enterGameSeq) return;

    const entry = getMyEntryForGame_(activeGameId);

    if (entry && !isApproved_(entry)) {
      showPaymentDetailsModal_(activeGameId);
    }
  } finally {
    if (seq === enterGameSeq) showSplash(false);
  }
}


async function backToLobby_() {
  if (deadlineInterval) {
    clearInterval(deadlineInterval);
    deadlineInterval = null;
  }

  if (profilePoll) {
    clearInterval(profilePoll);
    profilePoll = null;
  }

  activeGameId = null;
  activeEntry = null;

  showLobby_();

  if (!gameweeks.length) {
    await loadFixturesAndDeadlines_().catch(() => { });
  }

  renderLobby_();
  refreshLobbyCounts_().catch(() => { });

  fetchMyEntries_()
    .then(() => {
      renderLobby_();
      return refreshLobbyCounts_();
    })
    .catch(() => { });
}

function renderPickCardState() {
  if (isQueuePicksGame_()) {
    const targetGwId = getNextQueueTargetGwId_();
    if (targetGwId) {
      forceQueueSubmitButtonState_(targetGwId);
      return;
    }
  }
  if (!submitPickBtn) return;

  if (isWinner_() || isDeadUi_() || sessionUser?.alive === false || !sessionUser?.approved) {
    submitPickBtn.disabled = true;
    return;
  }

  const targetGwId = String(
    submitPickBtn.dataset.queueGwId ||
    getNextQueueTargetGwId_() ||
    currentGwId ||
    ""
  ).toUpperCase();

  const targetPick = getPickForGw(targetGwId);
  const isQueueTarget =
    isQueuePicksGame_() &&
    targetGwId &&
    targetGwId !== String(currentGwId || "").toUpperCase();

  if (isQueueTarget) {
    submitPickBtn.textContent = `Queue ${gwLabelShort(targetGwId)}`;
    submitPickBtn.disabled = !!targetPick?.team || !canQueueGw_(targetGwId);
    return;
  }

  const curPick = getPickForGw(currentGwId);
  const locked = currentGwLocked();

  submitPickBtn.textContent = `Submit ${gwLabelShort(currentGwId)}`;
  submitPickBtn.disabled = locked || !!curPick?.team;
}

function hasCompleteFixtureForGw_(gwId) {
  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );

  if (!gw) return false;

  return (gw.fixtures || []).some(f =>
    !isPlaceholderTeam_(f.home) &&
    !isPlaceholderTeam_(f.away)
  );
}

function getWorldCupQueueStage_(gwId) {
  const n = gwNumberFromId_(gwId);

  if (n >= 1 && n <= 6) {
    return {
      label: "Group stage"
    };
  }

  if (n >= 7 && n <= 8) {
    return {
      label: canQueueGw_(gwId) ? "Round of 32" : ""
    };
  }

  return {
    label: ""
  };
}

function canQueueGw_(gwId) {
  if (!isQueuePicksGame_()) return false;

  const game = getActiveGame_();
  const isWorldCup = gameIncludesLeague_("World Cup", game);

  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );
  if (!gw) return false;

  const hasCompleteRealFixture = (gw.fixtures || []).some(f =>
    !isPlaceholderTeam_(f.home) &&
    !isPlaceholderTeam_(f.away)
  );

  if (!hasCompleteRealFixture) return false;
  if (!isWorldCup) return true;

  const n = gwNumberFromId_(gwId);

  if (n >= 1 && n <= 6) return true;
  if (n >= 7 && n <= 8) return true;

  return false;
}

function isTeamUsedInSameReuseGroup_(team, gwId) {
  const game = getActiveGame_();
  const targetGroup = getTeamReuseGroupForGw_(gwId, game);
  const teamKey = normTeamKey_(getCanonicalTeamName_(team));

  return (sessionPicks || []).some(p => {
    const pickTeam = String(p?.team || "").trim();
    if (!pickTeam) return false;

    const outcome = String(p?.outcome || "PENDING").toUpperCase();
    if (outcome === "LOSS" || outcome === "VOID") return false;

    const sameTeam = normTeamKey_(getCanonicalTeamName_(pickTeam)) === teamKey;
    if (!sameTeam) return false;

    return getTeamReuseGroupForGw_(p.gwId, game) === targetGroup;
  });
}

/*******************************
 * PICK SUBMISSION
 *******************************/
function gwNumberFromId_(gwId) {
  const n = Number(String(gwId || "").toUpperCase().replace("GW", ""));
  return Number.isFinite(n) ? n : 9999;
}

function getActivePickGwId_() {
  const activePicks = sortPicksByGw(sessionPicks || [])
    .filter(p => {
      const outcome = String(p?.outcome || "PENDING").toUpperCase();
      return outcome === "PENDING";
    });

  if (activePicks.length) {
    return String(activePicks[0].gwId || "").toUpperCase();
  }

  return String(computeDateGwId() || currentGwId || gameweeks[0]?.id || "").toUpperCase();
}

function getNextSelectionTargetGwId_() {
  const picksByGw = new Map(
    (sessionPicks || [])
      .filter(p => p?.gwId)
      .map(p => [String(p.gwId).toUpperCase(), p])
  );

  // First priority: existing active PENDING pick
  const pending = sortPicksByGw(sessionPicks || [])
    .find(p => String(p?.outcome || "").toUpperCase() === "PENDING");

  if (pending?.gwId) return String(pending.gwId).toUpperCase();

  // Queue game: after current pick exists, typed input should target next empty queueable GW
  if (isQueuePicksGame_()) {
    const nextEmpty = (gameweeks || []).find(gw => {
      const gwId = String(gw.id || "").toUpperCase();
      if (!canQueueGw_(gwId)) return false;
      return !picksByGw.get(gwId)?.team;
    });

    if (nextEmpty?.id) return String(nextEmpty.id).toUpperCase();
  }

  return String(currentGwId || computeDateGwId() || gameweeks[0]?.id || "").toUpperCase();
}

async function savePick(team, gwIdOverride = null) {
  team = getCanonicalTeamName_(team);

  const gwId = String(
    gwIdOverride || getNextSelectionTargetGwId_() || currentGwId || ""
  ).toUpperCase();
  const queueMode = isQueuePicksGame_();
  const activePickGwId = getActivePickGwId_();

  const isCurrentGwPick =
    String(gwId).toUpperCase() === String(activePickGwId || "").toUpperCase();

  const isQueuedPick =
    queueMode &&
    !isCurrentGwPick &&
    canQueueGw_(gwId);

  const pickOutcome = isCurrentGwPick ? "PENDING" : "QUEUED";

  if (!isCurrentGwPick && !isQueuedPick) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("You cannot queue this gameweek yet.", "bad");
    return;
  }

  console.log("queue debug", {
    activeGameId,
    gwId,
    currentGwId,
    activePickGwId,
    queueMode,
    isCurrentGwPick,
    isQueuedPick,
    pickOutcome
  });

  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) {
    setBtnLoading(submitPickBtn, false);
    return;
  }

  if (!sessionUser?.approved) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("You are not approved yet. Please pay entry fee and wait for approval.", "bad");
    return;
  }
  const isLateSubmit = canLateSubmitCurrentGw_();

  if (!isQueuedPick && now() >= gw.deadline && !isLateSubmit) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("Deadline has passed for this gameweek.", "bad");
    return;
  }

  if (!isQueuedPick && isLateSubmit) {
    const allowedTeams = getUnstartedTeamsForGw_(gwId);
    if (!allowedTeams.includes(team)) {
      setBtnLoading(submitPickBtn, false);
      showFixturesMessage("That team's match has already started.", "bad");
      return;
    }
  }

  setBtnLoading(submitPickBtn, true);

  try {
    await api({
      action: "submitPick",
      email: sessionEmail,
      gameId: activeGameId,
      gwId,
      team,
      outcome: pickOutcome
    });

    // ✅ Make sure we’re not stuck in editing mode after submit
    isEditingCurrentPick = false;
    setEditing(false);


    // ✅ Optimistic local update FIRST (this is the “state change”)
    upsertLocalPick(gwId, team, pickOutcome);
    lastEntriesSig = "";

    if (activeTab2 === "entries") {
      entriesReqId++;
      entriesLoading = false;
      renderEntriesTab();
    }
    resetPickInputUi_();

    lastEntriesSig = "";

    await refreshProfile().catch(err => {
      console.warn("Post-pick profile refresh failed", err);
    });

    usedTeams = new Set(
      sessionPicks
        .filter(p => String(p.outcome || "").toUpperCase() === "WIN")
        .map(p => normTeamKey_(getCanonicalTeamName_(p.team)))
    );

    // ✅ Immediately update UI so there is no “gap”
    showFixturesMessage(isQueuedPick ? "Selection queued." : "Selection submitted.", "good");
    renderCurrentPickBlock();
    renderStatusBox();
    renderPickCardState();

    if (activeTab2 === "fixtures") {
      renderFixturesTab();
    }

    // ✅ Show confirmation modal (use your single modal function)
    showSystemModal_(
      isQueuedPick
        ? `${gwLabelShort(gwId)} selection queued:`
        : `${gwLabelShort(gwId)} selection confirmed:`,
      `
  <div style = "margin-top:12px;" >
          <div class="status-row ${isQueuedPick ? "queued" : "pending"}" style="margin:0;">
            <div class="status-left" style="display:flex;align-items:center;gap:10px;">
              ${teamInlineHtml_(team, { size: 22, logoPosition: "before" })}
            </div>
            <div class="state good">✓</div>
          </div>

          <div class="muted small" style="margin-top:10px;line-height:1.4;">
            ${isQueuedPick
        ? "This pick is queued. It will become active if you reach this gameweek."
        : "Good luck — you can edit your selection anytime before the submission deadline."
      }
          </div>
        </div >
  `,
      { showActions: false }
    );



    // ✅ NOW drop the spinner (only after UI has visibly changed)
    setBtnLoading(submitPickBtn, false);

    // Background sync (don’t block UI)
    refreshProfile().then(() => {
      // applyOutcomeEffects_ keeps everything consistent + will NOT re-open submit modal
      applyOutcomeEffects_({ allowModal: false });
      if (activeTab2 === "entries") renderEntriesTab();
    }).catch(() => { });
  } catch (err) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage(String(err.message || err), "bad");
  }
}

let profilePoll = null;

function renderCurrentPickBlock() {
  if (!sessionEmail) {
    const pickModeInput = document.getElementById("pickModeInput");
    const pickModeSubmitted = document.getElementById("pickModeSubmitted");
    const editPickBtn = document.getElementById("editPickBtn");
    const submittedMeta = document.getElementById("submittedMeta");
    const gwPickTitle = document.getElementById("gwPickTitle");
    const gwPickIcon = document.getElementById("gwPickIcon");

    showPickCardAndHideLossBox();
    renderWinBox();

    pickModeSubmitted?.classList.add("hidden");
    pickModeInput?.classList.add("hidden");
    editPickBtn?.classList.add("hidden");
    document.getElementById("lateSubmitNote")?.remove();

    if (gwPickTitle) gwPickTitle.textContent = `${gwLabelShort(currentGwId)} - Login to make a selection`;
    if (gwPickIcon) {
      gwPickIcon.textContent = "→";
      gwPickIcon.className = "state muted";
    }
    if (submittedMeta) {
      submittedMeta.innerHTML = `<div class="muted">Log in or register to join this game.</div>`;
    }

    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  }

  if (isDeadUi_()) {
    renderWinBox();
    renderLossBoxAndHidePickCard();
    return;
  }

  if (isWinner_()) {
    showPickCardAndHideLossBox();
    renderWinBox();

    document.getElementById("pickModeInput")?.classList.add("hidden");
    document.getElementById("pickModeSubmitted")?.classList.add("hidden");
    document.getElementById("editPickBtn")?.classList.add("hidden");
    document.getElementById("lateSubmitNote")?.remove();

    if (submitPickBtn) submitPickBtn.disabled = true;

    const pickDeadlineTextEl = document.getElementById("pickDeadlineText");
    const pickCountdownWrapEl = document.getElementById("pickCountdownWrap");

    if (pickDeadlineTextEl) pickDeadlineTextEl.textContent = "Competition finished";
    if (pickCountdownWrapEl) pickCountdownWrapEl.classList.add("hidden");

    applyWinConditionUi_();
    return;
  }

  setGwLabelFromSelected();
  renderStatusPill();
  renderPickCardHeader_();

  if (isEditingCurrentPick) {
    const pickModeInput = document.getElementById("pickModeInput");
    const pickModeSubmitted = document.getElementById("pickModeSubmitted");
    pickModeSubmitted?.classList.add("hidden");
    pickModeInput?.classList.remove("hidden");
    return;
  }

  if (sessionUser?.alive === false) {
    renderWinBox();
    renderLossBoxAndHidePickCard();
    return;
  }

  showPickCardAndHideLossBox();
  renderWinBox();

  const curGw = gameweeks.find(g => g.id === currentGwId);
  if (!curGw) return;

  if (isQueuePicksGame_()) {
    renderQueuedPickCard_();
    renderSelectedFixturesCard_();
    return;
  }

  const pick = getPickForGw(currentGwId);
  const pickModeInput = document.getElementById("pickModeInput");
  const pickModeSubmitted = document.getElementById("pickModeSubmitted");
  const editPickBtn = document.getElementById("editPickBtn");
  const gwPickTitle = document.getElementById("gwPickTitle");
  const gwPickIcon = document.getElementById("gwPickIcon");
  const submittedMeta = document.getElementById("submittedMeta");

  const locked = currentGwLocked();
  const lateSubmitOpen = canLateSubmitCurrentGw_();

  const team = String(pick?.team || "").trim();
  const outcome = String(pick?.outcome || "PENDING").toUpperCase();
  const hasPick = !!team;

  const countdownBox = document.getElementById("pickCountdownWrap");

  if (countdownBox) {
    countdownBox.classList.toggle("hidden", hasPick);
  }

  const lateSubmitNoteHtml = lateSubmitOpen
    ? `<div class="msg good" style="margin-bottom:10px;">Late submission — choose any team whose match has not started yet this gameweek.</div>`
    : "";

  pickModeInput?.classList.toggle("hidden", (locked && !lateSubmitOpen) || hasPick);
  pickModeSubmitted?.classList.toggle("hidden", !hasPick);

  if (locked && !lateSubmitOpen) {
    editPickBtn?.classList.add("hidden");
    if (submitPickBtn) submitPickBtn.disabled = true;
    document.getElementById("lateSubmitNote")?.remove();

    if (hasPick) {
      if (gwPickTitle) {
        gwPickTitle.innerHTML = `
      <span class="pick-title-inline">
        ${teamInlineHtml_(team, { size: 20 })}
      </span>
    `;
      }

      if (gwPickIcon) {
        gwPickIcon.textContent = "…";
        gwPickIcon.className = "state warn";
      }

      const fx = findFixtureForTeam(curGw, team);
      if (submittedMeta) {
        if (fx) {
          const when = fx.kickoffHasTime ? formatKickoffLineUK(fx.kickoff) : formatDateUK(fx.kickoff);
          submittedMeta.innerHTML = `
        <div class="submitted-label muted" style="margin-bottom:8px;">Game:</div>
        <div class="fixture-main fixture-main--compact">
          ${fixtureTeamsHtml_(fx.home, fx.away, { highlightTeam: p.team })}
          <div class="fixture-datetime muted">${escapeHtml(when)}</div>
        </div>
      `;
        } else {
          submittedMeta.textContent = "Match not found for this gameweek";
        }
      }
    } else {
      if (submittedMeta) submittedMeta.textContent = "";
    }

    return;
  }

  editPickBtn?.classList.remove("hidden");

  if (!hasPick) {
    if (editPickBtn) editPickBtn.disabled = true;
    if (submittedMeta) submittedMeta.textContent = "";

    const existingNote = document.getElementById("lateSubmitNote");
    if (existingNote) existingNote.remove();

    if (pickModeInput) {
      const label = pickModeInput.querySelector(".field");
      if (lateSubmitNoteHtml && label) {
        label.insertAdjacentHTML(
          "beforebegin",
          `<div id="lateSubmitNote">${lateSubmitNoteHtml}</div>`
        );
      }
    }

    return;
  }

  document.getElementById("lateSubmitNote")?.remove();

  if (editPickBtn) {
    editPickBtn.disabled = !sessionUser?.approved || sessionUser?.alive === false || outcome !== "PENDING";
  }

  if (outcome === "WIN") {
    if (gwPickTitle) gwPickTitle.textContent = `${gwLabelShort(pick.gwId)} - ${team} - Won`;
    if (gwPickIcon) {
      gwPickIcon.textContent = "✓";
      gwPickIcon.className = "state good";
    }
    if (editPickBtn) editPickBtn.disabled = true;
  } else if (outcome === "LOSS") {
    if (gwPickTitle) gwPickTitle.textContent = `${gwLabelShort(pick.gwId)} - ${team} - Lost`;
    if (gwPickIcon) {
      gwPickIcon.textContent = "✕";
      gwPickIcon.className = "state bad";
    }
    if (submittedMeta) submittedMeta.innerHTML = `<div class="muted"><strong>Lost — you are out!</strong></div>`;
    if (editPickBtn) editPickBtn.disabled = true;
    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  } else {
    if (gwPickTitle) {
      gwPickTitle.innerHTML = `
        <span class="pick-title-inline">
          ${teamInlineHtml_(team, { size: 20 })}
        </span>
      `;
    }

    if (gwPickIcon) {
      gwPickIcon.textContent = "✓";
      gwPickIcon.className = "state good";
    }
  }

  const fx = findFixtureForTeam(curGw, team);
  if (submittedMeta) {
    if (fx) {
      const whenLine = fx.kickoffHasTime
        ? `${formatDateUK(fx.kickoff)} · ${formatTimeUK(fx.kickoff)}`
        : `${formatDateUK(fx.kickoff)}`;

      submittedMeta.innerHTML = `
        <div class="fixture-row">
          <div class="fixture-main">
            ${fixtureTeamsHtml_(fx.home, fx.away, { highlightTeam: team })}
            <div class="fixture-datetime muted">${escapeHtml(whenLine)}</div>
          </div>
        </div>
      `;
    } else {
      submittedMeta.textContent = "Match not found for this gameweek";
    }
  }

  renderGwReportCard_();
}

function hasSelectableFixtureForGw_(gwId) {
  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );

  if (!gw) return false;

  return (gw.fixtures || []).some(f =>
    !isPlaceholderTeam_(f.home) &&
    !isPlaceholderTeam_(f.away)
  );
}

function forceQueueSubmitButtonState_(targetGwId) {
  if (!submitPickBtn || !targetGwId) return;

  const targetPick = getPickForGw(targetGwId);
  const targetIsCurrent =
    String(targetGwId).toUpperCase() === String(currentGwId || "").toUpperCase();

  submitPickBtn.dataset.queueGwId = targetGwId;
  submitPickBtn.textContent = targetIsCurrent
    ? `Submit ${gwLabelShort(targetGwId)}`
    : `Queue ${gwLabelShort(targetGwId)}`;

  submitPickBtn.disabled =
    !sessionUser?.approved ||
    sessionUser?.alive === false ||
    !!String(targetPick?.team || "").trim() ||
    !canQueueGw_(targetGwId);
}

function renderQueuedPickCard_() {
  const pickModeInput = document.getElementById("pickModeInput");
  const pickModeSubmitted = document.getElementById("pickModeSubmitted");
  const editPickBtn = document.getElementById("editPickBtn");
  const countdownBox = document.getElementById("pickCountdownWrap");
  const gwTitleEl = document.getElementById("gwTitle");
  const gwRangeEl = document.getElementById("gwRange");

  const selectedPicks = sortPicksByGw(sessionPicks || [])
    .filter(p => String(p?.team || "").trim());

  const targetGwId = getNextQueueTargetGwId_();
  const targetGw = gameweeks.find(g => String(g.id).toUpperCase() === targetGwId);

  editPickBtn?.classList.add("hidden");
  pickModeSubmitted?.classList.add("hidden");
  document.getElementById("lateSubmitNote")?.remove();
  document.getElementById("queuePromptTitle")?.remove();

  if (countdownBox) countdownBox.classList.add("hidden");

  if (targetGwId && targetGw) {
    const targetIsCurrent =
      String(targetGwId).toUpperCase() === String(currentGwId || "").toUpperCase();

    if (gwTitleEl) {
      gwTitleEl.textContent = targetIsCurrent
        ? `Make selection for ${gwLabelShort(targetGwId)}`
        : `Queue selection for ${gwLabelShort(targetGwId)}`;
    }

    if (gwRangeEl) {
      const endDay = startOfDay(targetGw.lastKickoff || targetGw.firstKickoff);
      gwRangeEl.textContent =
        `${formatDateWithOrdinalShortUK(targetGw.start)} - ${formatDateWithOrdinalShortUK(endDay)}`;
    }

    pickModeInput?.classList.remove("hidden");

    if (submitPickBtn) {
      submitPickBtn.disabled = !sessionUser?.approved || sessionUser?.alive === false;
      submitPickBtn.dataset.queueGwId = targetGwId;
      submitPickBtn.textContent = targetIsCurrent
        ? `Submit ${gwLabelShort(targetGwId)}`
        : `Queue ${gwLabelShort(targetGwId)}`;
    }
  } else {
    pickModeInput?.classList.add("hidden");

    if (gwTitleEl) {
      gwTitleEl.textContent = selectedPicks.length === 1
        ? "Selection confirmed"
        : "All selections confirmed";
    }

    if (gwRangeEl) gwRangeEl.textContent = "";

    if (submitPickBtn) {
      submitPickBtn.dataset.queueGwId = "";
    }
  }
  forceQueueSubmitButtonState_(targetGwId);
}

function renderSelectedFixturesCard_() {
  const card = document.getElementById("selectedFixturesCard");
  if (!card) return;

  const selectedPicks = sortPicksByGw(sessionPicks || [])
    .filter(p => String(p?.team || "").trim());

  if (!selectedPicks.length) {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }

  card.classList.remove("hidden");

  card.innerHTML = `
    <div class="queued-fixtures-title">
      ${selectedPicks.length === 1 ? "Selected fixture:" : "Selected fixtures:"}
    </div>

    <div class="queued-fixtures-list">
      ${selectedPicks.map(p => {
    const gwId = String(p.gwId || "").toUpperCase();
    const gw = gameweeks.find(g => String(g.id).toUpperCase() === gwId);
    const fx = gw ? findFixtureForTeam(gw, p.team) : null;

    return `
          <div class="queued-fixture-item">
            <div class="queued-fixture-gw-title">${escapeHtml(gwLabelShort(gwId))}:</div>
            ${fx
        ? `
                  <div class="fixture-main fixture-main--compact">
                    ${fixtureTeamsHtml_(fx.home, fx.away, { highlightTeam: p.team })}
                    <div class="fixture-datetime muted">
                      ${escapeHtml(fx.kickoffHasTime ? formatKickoffLineUK(fx.kickoff) : formatDateUK(fx.kickoff))}
                    </div>
                  </div>
                `
        : `<div class="muted">Fixture not found for ${escapeHtml(p.team)}</div>`
      }
          </div>
        `;
  }).join("")}
    </div>
  `;
}

function renderPickCardHeader_() {
  const gw = gameweeks.find(g => g.id === currentGwId);
  if (!gw) return;

  const gwTitleEl = document.getElementById("gwTitle");
  const gwRangeEl = document.getElementById("gwRange");
  const pickCountdownWrapEl = document.getElementById("pickCountdownWrap");
  const pickDeadlineTextEl = document.getElementById("pickDeadlineText");
  const pickCompetitionsBtn = document.getElementById("pickCompetitionsBtn");
  const countdownLabelEl = pickCountdownWrapEl?.querySelector(".lobby-deadline-panel-label");

  if (gwTitleEl) {
    gwTitleEl.textContent = `Gameweek ${gw.num}`;
  }

  if (gwRangeEl) {
    const endDay = startOfDay(gw.lastKickoff || gw.firstKickoff);
    gwRangeEl.textContent = `${formatDateWithOrdinalShortUK(gw.start)} - ${formatDateWithOrdinalShortUK(endDay)}`;
  }

  const isLate = canLateSubmitCurrentGw_();
  const countdownTarget = isLate
    ? (gw.lateDeadline ? gw.lateDeadline.toISOString() : "")
    : (gw.deadline ? gw.deadline.toISOString() : "");

  if (pickDeadlineTextEl) {
    pickDeadlineTextEl.textContent = isLate
      ? "Late submission:"
      : formatGameDeadlineText_(gw.deadline);
  }

  if (countdownLabelEl) {
    countdownLabelEl.textContent = isLate ? "Late submission:" : "Submit by:";
  }

  if (pickCountdownWrapEl) {
    if (countdownTarget) {
      pickCountdownWrapEl.setAttribute("data-countdown", countdownTarget);
      pickCountdownWrapEl.classList.remove("hidden");
    } else {
      pickCountdownWrapEl.classList.add("hidden");
    }
  }

  if (pickCompetitionsBtn && !pickCompetitionsBtn.dataset.bound) {
    pickCompetitionsBtn.dataset.bound = "1";
    pickCompetitionsBtn.addEventListener("click", () => {
      openPickCompetitionsModal_();
    });
  }

  startCountdowns_();
}

function canClickFixtureTeam_(team, gwId) {
  if (!sessionEmail) return false;
  if (!sessionUser?.approved) return false;
  if (sessionUser?.alive === false) return false;

  if (isPlaceholderTeam_(team)) return false;

  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) return false;

  const canonical = getCanonicalTeamName_(team);
  const fx = findFixtureForTeam(gw, canonical);

  if (!fx) return false;
  if (isFixtureResolved_(fx)) return false;

  const queueMode = isQueuePicksGame_();
  const futureGw = gwNumberFromId_(gwId) > gwNumberFromId_(currentGwId);

  if (futureGw && !queueMode) return false;

  if (futureGw && queueMode && !canQueueGw_(gwId)) return false;

  const existingPick = getPickForGw(gwId);
  if (existingPick?.team && !areTeamsSame_(existingPick.team, team)) return true;
  if (existingPick?.team && areTeamsSame_(existingPick.team, team)) return false;

  if (isTeamUsedInSameReuseGroup_(canonical, gwId)) return false;

  if (!futureGw) {
    if (currentGwLocked() && !canLateSubmitCurrentGw_()) return false;

    if (canLateSubmitCurrentGw_()) {
      return getUnstartedTeamsForGw_(gwId).includes(canonical);
    }
  }

  return true;
}

function openPickCompetitionsModal_() {
  const game = getActiveGame_();
  if (!game) return;

  const competitions = getGameCompetitions_(game);
  const gw = gameweeks.find(g => g.id === currentGwId);

  const countsByLeague = {};
  competitions.forEach(name => countsByLeague[name] = 0);

  if (gw?.fixtures?.length) {
    gw.fixtures.forEach(f => {
      const league = String(f.league || "").trim();
      if (countsByLeague[league] != null) countsByLeague[league] += 1;
    });
  }

  showSystemModal_(
    "Competitions",
    `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${competitions.map(name => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <img
                src="${escapeAttr(getCompetitionLogo_(name))}"
                alt="${escapeAttr(name)}"
                style="width:22px;height:22px;object-fit:contain;"
                onerror="this.onerror=null;this.src='site/images/competitions/default.png';"
              />
              <span>${escapeHtml(name)}</span>
            </div>
            <strong>(${countsByLeague[name] || 0})</strong>
          </div>
        `).join("")}

        <div style="margin-top:8px;">
          <button id="pickCompetitionsFixturesBtn" class="btn btn-ghost" type="button">Fixtures</button>
        </div>
      </div>
    `,
    { showActions: false }
  );

  setTimeout(() => {
    document.getElementById("pickCompetitionsFixturesBtn")?.addEventListener("click", () => {
      closeModal(systemModal);
      setTab2("fixtures");
    });
  }, 0);
}

function getLastResolvedPick() {
  const resolved = sessionPicks.filter(p => {
    const o = String(p.outcome || "").toUpperCase();
    return o === "WIN" || o === "LOSS";
  });
  if (!resolved.length) return null;

  resolved.sort((a, b) => findGwIndexById(b.gwId) - findGwIndexById(a.gwId));
  return resolved[0];
}

function getLastWinPick() {
  const wins = sessionPicks.filter(p => String(p.outcome || "").toUpperCase() === "WIN");
  if (!wins.length) return null;
  wins.sort((a, b) => findGwIndexById(b.gwId) - findGwIndexById(a.gwId));
  return wins[0];
}

function renderWinBox() {
  const box = document.getElementById("lastWinBox");
  if (!box) return;

  const p = getLastWinPick();
  // show only if they have at least one WIN and they are still alive
  if (!p || sessionUser?.alive === false) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  box.classList.remove("hidden");
  box.classList.remove("loss"); // ensure green styling
  box.innerHTML = `
    <div><strong>${escapeHtml(gwLabelShort(getDisplayGwIdForGame_(p.gwId, getActiveGame_())))} - ${escapeHtml(p.team)} - Won</strong></div>
      <div class="state good">✓</div>
`;
}

function renderLossBoxAndHidePickCard() {
  const lossBox = document.getElementById("gwResultBanner");
  const pickCard = document.getElementById("pickCard");

  if (pickCard) pickCard.classList.add("hidden");

  if (!lossBox) return;

  const p = getLastResolvedPick(); // should be LOSS when dead
  const team = p?.team || sessionUser?.knockedOutTeam || "—";
  const gw = p?.gwId || sessionUser?.knockedOutGw || "—";

  lossBox.classList.remove("hidden");
  lossBox.classList.add("win-box", "loss"); // reuse win-box styling + loss tint
  lossBox.innerHTML = `
  <div > <strong>${escapeHtml(gwLabelShort(gw))} - ${escapeHtml(team)} - Lost</strong></div >
    <div class="state bad">✕</div>
`;
}

function showPickCardAndHideLossBox() {
  const lossBox = document.getElementById("gwResultBanner");
  const pickCard = document.getElementById("pickCard");

  if (pickCard) pickCard.classList.remove("hidden");

  if (lossBox) {
    lossBox.classList.add("hidden");
    lossBox.classList.remove("win-box", "loss");
    lossBox.innerHTML = "";
  }
}

function openPickEditor() {
  const pickModeInput = document.getElementById("pickModeInput");
  const pickModeSubmitted = document.getElementById("pickModeSubmitted");

  // you said: pick box should remove submitted selection section
  // so this just ensures input is visible
  pickModeSubmitted?.classList.add("hidden");
  pickModeInput?.classList.remove("hidden");

  teamSearch?.focus();
}

function gwIndexForRank_(gwId) {
  const idx = findGwIndexById(String(gwId || ""));
  return idx >= 0 ? idx : -9999;
}

function canEditPickForGw_(gwId) {
  if (!sessionEmail) return false;
  if (!sessionUser?.approved) return false;
  if (sessionUser?.alive === false) return false;

  const pick = getPickForGw(gwId);
  if (!pick?.team) return false;

  const outcome = String(pick.outcome || "PENDING").toUpperCase();
  if (!["PENDING", "QUEUED"].includes(outcome)) return false;

  const gw = gameweeks.find(g =>
    String(g.id || "").toUpperCase() === String(gwId || "").toUpperCase()
  );
  if (!gw) return false;

  if (isFixtureResolved_(findFixtureForTeam(gw, pick.team))) return false;

  return Date.now() < gw.deadline.getTime();
}

async function editPickForGw_(gwId) {
  const pick = getPickForGw(gwId);

  if (!pick?.team) {
    showFixturesMessage("No selection to edit yet.", "bad");
    return;
  }

  if (!canEditPickForGw_(gwId)) {
    showFixturesMessage("Editing is locked for this gameweek.", "bad");
    return;
  }

  try {
    showFixturesMessage(`Clearing ${gwLabelShort(gwId)} selection…`, "good");

    await api({
      action: "clearPick",
      email: sessionEmail,
      gameId: activeGameId,
      gwId
    });

    sessionPicks = (sessionPicks || []).filter(
      p => String(p.gwId || "").toUpperCase() !== String(gwId || "").toUpperCase()
    );

    renderStatusBox();
    renderFixturesTab();
    renderCurrentPickBlock();
    renderPickCardState();

    const nextGwId = getNextQueueTargetGwId_();
    showFixturesMessage(`Choose a new team for ${gwLabelShort(nextGwId || gwId)}.`, "good");

    refreshProfile().then(() => {
      renderStatusBox();
      renderFixturesTab();
      renderCurrentPickBlock();
      renderPickCardState();
    }).catch(() => { });
  } catch (err) {
    showFixturesMessage(String(err.message || err), "bad");
  }
}


function ordinalSuffix_(n) {
  const x = Number(n);
  if (!isFinite(x)) return "";
  const v = x % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (x % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

async function startProfilePolling() {
  // TEMP: disabled to protect Firebase quota
  return;
  // Kick off counts immediately (non-blocking)
  refreshRemainingPlayersCount();

  // If entries tab is open, refresh it (throttled)
  if (activeTab2 === "entries") {
    const t = Date.now();
    if (t - lastEntriesFetchAt > 30000) {
      lastEntriesFetchAt = t;
      renderEntriesTab();
    }
  }

  if (profilePoll) return;

  profilePoll = setInterval(async () => {
    if (!sessionEmail) return;
    if (isEditingCurrentPick) return;

    try {
      await refreshProfile();
      handleAccountStateChange_();
      await fetchMyEntries_();
      snapshotLobbyApprovalStates_();

      const openedOutcomeModal = applyOutcomeEffects_({ allowModal: true });

      // ✅ If an outcome modal opened, don’t open other modals this tick
      if (!openedOutcomeModal) {
        handleAccountStateChange_();
      }

      // ✅ Move gameweek if needed (e.g. after a WIN)
      const nextPlayerGw = computePlayerGwId();
      const nextDateGw = computeDateGwId();

      if (nextPlayerGw && nextPlayerGw !== currentGwId) {
        currentGwId = nextPlayerGw;
        resetPickInputUi_();
      }

      if (!viewingGwId) {
        viewingGwId = nextDateGw || currentGwId;
      }

      syncViewingToCurrent();

      renderTopUIOnly();

      renderPaymentDetailsCard_();   // show/hide payment details card
      startDeadlineTimer();

      // ✅ keep winner detection fresh (throttle 30s)
      const tNow = Date.now();
      if (tNow - lastRemainingFetchAt > 30000) {
        lastRemainingFetchAt = tNow;
        await refreshRemainingPlayersCount().catch(() => { });
      }

      // ✅ Throttled entries refresh
      if (activeTab2 === "entries") {
        const t = Date.now();
        if (t - lastEntriesFetchAt > 30000) {
          lastEntriesFetchAt = t;
          renderEntriesTab();
        }
      }
    } catch (err) {
      console.warn(err);
    }
  }, 30000);
}

/*******************************
 * AUTH UI
 *******************************/
showRegisterBtn.addEventListener("click", () => {
  showRegisterBtn.classList.add("active");
  showLoginBtn.classList.remove("active");
  registerForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  authMsg.classList.add("hidden");
});

showLoginBtn.addEventListener("click", () => {
  showLoginBtn.classList.add("active");
  showRegisterBtn.classList.remove("active");
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
  authMsg.classList.add("hidden");
});

// Open Privacy Modal (shared everywhere)
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-open-privacy], #privacyLink");
  if (!trigger) return;

  e.preventDefault();

  const modal = document.getElementById("privacyModal");
  const overlay = document.getElementById("modalOverlay");

  if (!modal || !overlay) return;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  overlay.classList.remove("hidden");
});

document.getElementById("gameCompetitionsBtn")?.addEventListener("click", () => {
  if (activeGameId) openCompetitionsModalForGame_(activeGameId);
});


function setEditing(on) {
  isEditingCurrentPick = !!on;

  // Hide any old message box entirely when editing
  if (fixturesMsg) fixturesMsg.classList.add("hidden");
}


(function bindEditOnce() {
  const editPickBtn = document.getElementById("editPickBtn");
  if (!editPickBtn || editPickBtn.dataset.bound) return;
  editPickBtn.dataset.bound = "1";

  editPickBtn.addEventListener("click", async () => {
    if (!sessionEmail) return;

    if (!sessionUser?.approved) {
      return showFixturesMessage("Awaiting approval — you can edit once verified.", "bad");
    }
    if (sessionUser?.alive === false) {
      return showFixturesMessage("You are knocked out — you can’t edit picks.", "bad");
    }
    if (currentGwLocked()) {
      return showFixturesMessage("Deadline has passed — editing is locked.", "bad");
    }

    const curPick = getPickForGw(currentGwId);
    const outcome = String(curPick?.outcome || "PENDING").toUpperCase();
    if (!curPick?.team) {
      return showFixturesMessage("No selection to edit yet.", "bad");
    }
    if (outcome !== "PENDING") {
      return showFixturesMessage("This gameweek is already settled — editing is disabled.", "bad");
    }

    setIconBtnBusyText_(editPickBtn, true, "…");
    showFixturesMessage("Updating selection…", "good");

    try {
      await editCurrentPickFlow();
    } finally {
      setIconBtnBusyText_(editPickBtn, false);
      hideFixturesMessage(); // clears the green line after it finishes
    }
  });
})();


registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // ✅ Block new registrations if game is closed
  if (!REGISTRATION_OPEN) {
    // make sure any inline auth error is cleared
    authMsg?.classList.add("hidden");

    // show modal (no actions)
    showSystemModal_(
      "Entries closed",
      `
  <div style = "line-height:1.5;" >
          <p style="margin:0 0 10px;">The game is now currently closed to new entries.</p>
          <p style="margin:0;">We’ll notify you when the next game opens.</p>
        </div >
  `,
      { showActions: false }
    );

    return;
  }

  // ---- your existing registration code below ----
  const form = new FormData(registerForm);
  setBtnLoading(registerBtn, true);

  const consentRequiredEl = document.getElementById("consentRequired");
  const consentMarketingEl = document.getElementById("consentMarketing");
  const consentErrorEl = document.getElementById("consentError");

  const consentRequired = !!consentRequiredEl?.checked;
  if (!consentRequired) {
    consentErrorEl?.classList.remove("hidden");
    setBtnLoading(registerBtn, false);
    return;
  }
  consentErrorEl?.classList.add("hidden");

  const consentMarketing = !!consentMarketingEl?.checked;

  try {
    await api({
      action: "register",
      firstName: String(form.get("firstName") || "").trim(),
      lastName: String(form.get("lastName") || "").trim(),
      email: String(form.get("email") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      clubTeam: String(form.get("clubTeam") || "").trim(),
      connection: String(form.get("connection") || "").trim(),
      password: String(form.get("password") || ""),

      consentRequired, // boolean
      consentMarketing, // boolean
      consentTimestamp: new Date().toISOString(),
    });

    const emailLower = String(form.get("email") || "").trim().toLowerCase();

    setSession({
      email: emailLower,
      firstName: String(form.get("firstName") || "").trim(),
      lastName: String(form.get("lastName") || "").trim(),
      phone: String(form.get("phone") || "").trim(),
      clubTeam: String(form.get("clubTeam") || "").trim()
    });

    await refreshAccountProfile_();
    await fetchGames_(sessionEmail);
    await loadGameArchivesOnce_();
    await fetchMyEntries_();
    snapshotLobbyApprovalStates_();
    showLobby_();
    renderLobby_();
    refreshLobbyCounts_().catch(() => { });

    setTimeout(() => {
      showSystemModal_(
        "Account created ✅",
        `
          <div style="line-height:1.5;">
            <p style="margin:0 0 10px;"><strong>Your account has been created successfully.</strong></p>
            <p style="margin:0;">You can now enter the lobby and register for a game.</p>
          </div>
        `,
        { showActions: false }
      );
    }, 0);

    localStorage.removeItem(KEY_VERIFIED_SEEN(emailLower));
    sessionStorage.removeItem(KEY_SESSION_SEEN_VERIFIED(emailLower));

    showAuthMessage("Registered successfully.", "good");
    registerForm.reset();
  } catch (err) {
    showAuthMessage(String(err.message || err), "bad");
  } finally {
    setBtnLoading(registerBtn, false);
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = new FormData(loginForm);
  setBtnLoading(loginBtn, true);

  try {
    const data = await api({
      action: "login",
      email: String(form.get("email") || "").trim(),
      password: String(form.get("password") || "")
    }, { timeoutMs: 20000 });

    setSession(data.user);
    sessionUser = data.user;
    sessionEmail = String(data.user?.email || "").trim().toLowerCase();

    // Get them into the app first
    showLobby_();
    renderLobby_();
    showAuthMessage("", "good");

    // Then load heavier stuff
    try {
      await refreshAccountProfile_();
      await fetchGames_(data.user.email);
      await loadGameArchivesOnce_();
      await fetchMyEntries_();
      snapshotLobbyApprovalStates_();

      const autoEnterGameId = getAutoEnterGameIdForSession_();

      if (autoEnterGameId) {
        await enterGame_(autoEnterGameId);
      } else {
        showLobby_();
        renderLobby_();
        refreshLobbyCounts_().catch(() => { });
        startLobbyPolling_();
      }
    } catch (postLoginErr) {
      console.warn("Post-login loading failed:", postLoginErr);
      showLobby_();
      renderLobby_();
      refreshLobbyCounts_().catch(() => { });
    }

  } catch (err) {
    showAuthMessage(String(err.message || err), "bad");
  } finally {
    setBtnLoading(loginBtn, false);
  }
});


function renderStatusPill() {
  // no-op now
}

let lastFocusBeforeModal = null;

function openModal(modalEl) {
  const modalOverlay = document.getElementById("modalOverlay");
  if (!modalOverlay || !modalEl) return;

  lastFocusBeforeModal = document.activeElement;

  modalOverlay.classList.remove("hidden");
  modalEl.classList.remove("hidden");

  lockBodyScroll_(); // ✅ instead of overflow=hidden

  const focusable = modalEl.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  focusable?.focus?.();
}

function closeModal(modalEl) {
  const modalOverlay = document.getElementById("modalOverlay");
  if (!modalEl) return;

  modalEl.classList.add("hidden");
  setBtnLoading(submitPickBtn, false);

  const anyOpen = Array.from(document.querySelectorAll(".modal"))
    .some(m => !m.classList.contains("hidden"));

  if (!anyOpen) {
    modalOverlay?.classList.add("hidden");

    // ✅ undo fixed-position scroll lock
    unlockBodyScroll_();

    // ✅ also clear any leftover overflow locks (from older code paths)
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
  }
}

document.getElementById("homeBrandBtn")?.addEventListener("click", () => {
  goToLobby_();
});

document.addEventListener("click", (e) => {
  const brandHit = e.target.closest(".brand, .brand-logo, .brand-text, .brand-title, .brand-sub");
  if (!brandHit) return;

  if (sessionEmail) {
    goToLobby_();
  } else {
    showLobby_();
    renderLobby_();
    refreshLobbyCounts_().catch(() => { });
  }
});


document.querySelectorAll(".modal-card").forEach(card => {
  card.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  card.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
});



function closeAllModals() {
  allModals.forEach(closeModal);
}

// close on overlay click
modalOverlay?.addEventListener("pointerdown", (e) => {
  if (e.target === modalOverlay) closeAllModals();
});

// prevent clicks inside cards from closing
allModals.forEach(m => {
  m.addEventListener("pointerdown", (e) => {
    if (e.target === m) closeModal(m);     // click backdrop area inside modal
  });
  m.querySelector(".modal-card")?.addEventListener("pointerdown", (e) => e.stopPropagation());
});


document.getElementById("logoutBtnModal")?.addEventListener("click", () => {
  closeModal(profileModal);
  doLogout();
});

document.getElementById("profileBtn")?.addEventListener("click", () => {
  const body = document.getElementById("profileModalBody");
  const sess = getSession();

  const profile = {
    firstName: sessionUser?.firstName || sess?.firstName || "",
    lastName: sessionUser?.lastName || sess?.lastName || "",
    email: sessionUser?.email || sess?.email || "",
    phone: sessionUser?.phone || sess?.phone || "—",
    clubTeam: sessionUser?.clubTeam || sess?.clubTeam || "—"
  };

  if (body) {
    body.innerHTML = `
      <div style="margin-top:12px" class="fixtures-card">
        <div class="muted small"><strong>Name</strong></div>
        <div style="margin:4px 0px;">${escapeHtml(profile.firstName)} ${escapeHtml(profile.lastName)}</div>

        <div style="margin-top:10px" class="muted small"><strong>Email</strong></div>
        <div style="margin-top:4px;">${escapeHtml(profile.email)}</div>

        <div style="margin-top:10px" class="muted small"><strong>Phone</strong></div>
        <div style="margin-top:4px;">${escapeHtml(profile.phone)}</div>

        <div style="margin-top:10px" class="muted small"><strong>Team / Connection</strong></div>
        <div style="margin-top:4px;">${escapeHtml(profile.clubTeam)}</div>
      </div>
    `;
  }

  openModal(profileModal);
});


document.getElementById("infoBtn")?.addEventListener("click", () => {
  openInfoModalForGame_(activeGameId);
});

function formatTimeLeft(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"} `;

  // Days away -> "X days Y hours"
  if (days > 0) return `${plural(days, "day")} ${plural(hours, "hour")} `;

  // Hours away -> "X hours Y minutes"
  if (hours > 0) return `${plural(hours, "hour")} ${plural(mins, "minute")} `;

  // Minutes away -> "X minutes Y seconds"
  if (mins > 0) return `${plural(mins, "minute")} ${plural(secs, "second")} `;

  // Seconds only -> "X seconds"
  return `${plural(secs, "second")} `;
}

function renderGameHeaderAuth_() {
  const profileBtn = document.getElementById("profileBtn");
  const infoBtn = document.getElementById("infoBtn");
  const logoutBtn = document.getElementById("logoutBtnApp");
  const authBtn = document.getElementById("guestAuthBtn");

  if (sessionEmail) {
    profileBtn?.classList.remove("hidden");
    logoutBtn?.classList.remove("hidden");
    authBtn?.classList.add("hidden");
  } else {
    profileBtn?.classList.add("hidden");
    logoutBtn?.classList.add("hidden");
    authBtn?.classList.remove("hidden");
  }
}


const splash = document.getElementById("splash");

function showSplash(on) {
  if (!splash) return;

  splash.classList.toggle("hidden", !on);

  // IMPORTANT: only if you added the CSS that hides the rest of the page
  document.body.classList.toggle("splashing", on);
}


function syncViewingToCurrent() {
  if (!viewingGwId) viewingGwId = currentGwId;
  if (gameweekSelect) gameweekSelect.value = viewingGwId;
}


async function doLogout() {
  stopLobbyPolling_();
  clearSession();

  activeGameId = null;
  activeEntry = null;

  if (deadlineInterval) {
    clearInterval(deadlineInterval);
    deadlineInterval = null;
  }

  if (profilePoll) {
    clearInterval(profilePoll);
    profilePoll = null;
  }

  showLobby_();
  renderLobby_();
  refreshLobbyCounts_().catch(() => { });
}

logoutBtnOuter?.addEventListener("click", doLogout);
logoutBtnApp?.addEventListener("click", doLogout);

lobbyView.querySelectorAll("[data-winner-photo]").forEach(btn => {
  btn.addEventListener("click", () => {
    openWinnerPhotoModal_(
      btn.getAttribute("data-game-title") || "",
      btn.getAttribute("data-winner-name") || "",
      btn.getAttribute("data-prize-text") || "",
      btn.getAttribute("data-image-url") || ""
    );
  });
});

lobbyView?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-winner-photo]");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  openWinnerPhotoModal_(
    btn.getAttribute("data-game-title") || "",
    btn.getAttribute("data-winner-name") || "",
    btn.getAttribute("data-prize-text") || "",
    btn.getAttribute("data-image-url") || ""
  );
});


submitPickBtn?.addEventListener("click", () => {
  const typed = (teamSearch?.value || "").trim();
  if (!typed) return showFixturesMessage("Type a team first.", "bad");

  const targetGwId = getCurrentInputTargetGwId_();
  const gwTeams = getTeamsForCurrentInput_();
  const typedKey = normTeamKey_(typed);

  const matchedTeam = gwTeams.find(t => {
    const terms = getTeamSearchTerms_(t).map(x => normTeamKey_(x));
    return terms.includes(typedKey);
  });

  if (!matchedTeam) {
    return showFixturesMessage("That team is not in this gameweek’s fixtures.", "bad");
  }

  const match = getCanonicalTeamName_(matchedTeam);
  const existing = getPickForGw(targetGwId);

  if (
    usedTeams.has(normTeamKey_(getCanonicalTeamName_(match))) &&
    !areTeamsSame_(existing?.team, match)
  ) {
    return showFixturesMessage("You already used that team in a previous gameweek.", "bad");
  }

  showPickConfirmModal_(match, targetGwId);
});

document.getElementById("backToLobbyBtn")?.addEventListener("click", () => {
  backToLobby_();
});

/*******************************
 * APP START/STOP
 *******************************/
function showLobby_() {
  authView.classList.add("hidden");
  appView.classList.add("hidden");
  document.getElementById("lobbyView")?.classList.remove("hidden");

  logoutBtnOuter?.classList.add("hidden");
  logoutBtnApp?.classList.add("hidden");

  if (sessionEmail) startLobbyPolling_();
}

function exitApp_() {
  authView.classList.remove("hidden");
  appView.classList.add("hidden");

  if (deadlineInterval) clearInterval(deadlineInterval);

  if (profilePoll) { clearInterval(profilePoll); profilePoll = null; } // ✅ add
}

clearPickBtn?.addEventListener("click", () => {
  teamSearch.value = "";
  showFixturesMessage("", "good");
});


async function initDataAndRenderGame_({ allowOutcomeModal = true, gameId = activeGameId, enterSeq = enterGameSeq } = {}) {
  if (!activeGameId) return;

  const stillCurrent = () =>
    enterSeq === enterGameSeq &&
    String(gameId || "") === String(activeGameId || "");

  try {
    await Promise.all([
      loadTeamLogosOnce_(),
      loadTeamNameMapOnce_()
    ]);
    if (!stillCurrent()) return;
  } catch (e) {
    console.warn("Team assets failed to load:", e);
  }

  if (!fixtures.length || !gameweeks.length) {
    await loadFixturesAndDeadlines_();
  }
  if (!stillCurrent()) return;

  if (!gameweeks.length) {
    currentGwId = null;
    viewingGwId = null;

    renderGameTitleBox_();

    if (gwTitle) gwTitle.textContent = "No fixtures yet";
    if (gwRangeEl) gwRangeEl.textContent = "Fixtures will appear here once added.";

    if (fixturesList) {
      fixturesList.innerHTML = `<div class="muted">No fixtures available yet.</div>`;
    }

    if (statusBox) {
      statusBox.innerHTML = `
      <div class="muted">
        This competition is registered, but fixtures are not available yet.
      </div>
    `;
    }

    if (aliveList) aliveList.innerHTML = "";
    if (outList) outList.innerHTML = "";

    renderPaymentDetailsCard_();

    // Manually show the selection tab WITHOUT re-rendering pick/status blocks
    activeTab2 = "selection";
    tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === "selection"));
    panelSelection?.classList.remove("hidden");
    fixturesPanel?.classList.add("hidden");
    entriesPanel?.classList.add("hidden");

    return;
  }

  if (sessionEmail) {
    await refreshProfile();
    if (!stillCurrent()) return;
    lastApprovedState = !!sessionUser?.approved;
  } else {
    sessionUser = null;
    sessionPicks = [];
    usedTeams = new Set();
    lastApprovedState = null;
  }

  const playerGwId = sessionEmail ? computePlayerGwId() : null;
  const dateGwId = computeDateGwId();

  currentGwId = playerGwId || dateGwId;
  if (!currentGwId || !gameweeks.some(g => g.id === currentGwId)) {
    currentGwId = gameweeks[0].id;
  }

  viewingGwId = dateGwId || currentGwId;
  if (!viewingGwId || !gameweeks.some(g => g.id === viewingGwId)) {
    viewingGwId = gameweeks[0].id;
  }

  if (!stillCurrent()) return;

  syncViewingToCurrent();

  renderFixturesTab();
  renderGameTitleBox_();
  renderPaymentDetailsCard_();
  startDeadlineTimer();
  updateTeamDatalist();

  showVerifiedModalOnce_();
  applyOutcomeEffects_({ allowModal: !!allowOutcomeModal });

  setTab2("fixtures");

  refreshRemainingPlayersCount().catch(console.warn);
  renderGwReportCard_().catch?.(console.warn);
  startProfilePolling();
}


(async function boot() {
  authView.classList.add("hidden");
  appView.classList.add("hidden");

  const sess = getSession();

  if (!sess?.email) {
    sessionEmail = null;
    sessionUser = null;

    try {
      await Promise.all([
        fetchGames_(sessionEmail),
        loadGameArchivesOnce_()
      ]);

      showLobby_();
      renderLobby_();

      loadFixturesAndDeadlines_()
        .then(() => renderLobby_())
        .catch(console.warn);
      refreshLobbyCounts_().catch(() => { });
      stopLobbyPolling_();
    } finally {
      showSplash(false);
    }
    return;
  }

  showSplash(true);

  try {
    sessionEmail = sess.email;

    console.time("boot: initial data");

    console.time("profile");
    const profilePromise = refreshAccountProfile_().finally(() => console.timeEnd("profile"));

    console.time("games");
    const gamesPromise = fetchGames_(sessionEmail).finally(() => console.timeEnd("games"));

    console.time("archives");
    const archivesPromise = loadGameArchivesOnce_().finally(() => console.timeEnd("archives"));

    console.time("myEntries");
    const entriesPromise = fetchMyEntries_().finally(() => console.timeEnd("myEntries"));

    await Promise.all([
      profilePromise,
      gamesPromise,
      archivesPromise,
      entriesPromise
    ]);

    console.timeEnd("boot: initial data");

    snapshotLobbyApprovalStates_();

    const autoEnterGameId = getAutoEnterGameIdForSession_();

    if (autoEnterGameId) {
      await enterGame_(autoEnterGameId);
    } else {
      showLobby_();
      renderLobby_();
      refreshLobbyCounts_().catch(() => { });
      startLobbyPolling_();
      showSplash(false);
    }
  } catch (err) {
    console.error(err);

    if (String(err?.message || err).includes("User not found")) {
      clearSession();
    }

    showSplash(false);
    exitApp_();
  }
})();
