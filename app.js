/*******************************
 * CONFIG
 *******************************/
const API_URL = "https://lms-api.nick-horne123.workers.dev";

const DEBUG_API = false;

const FIXTURE_SOURCES = [
  { league: "Premier League", url: "premier-league.json" },
  { league: "Championship", url: "championship.json" },
  { league: "League One", url: "league-one.json" },
  { league: "League Two", url: "league-two.json" },
  { league: "FA Cup", url: "fa-cup.json" },
];


const DEADLINE_HOURS_BEFORE_FIRST_FIXTURE = 1;

const LS_SESSION = "cpfc_lms_session";

const TEAM_LOGOS_URL = "team-logos.json";
const DEFAULT_TEAM_LOGO = "images/team-default.png";



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

const daySelect = document.getElementById("daySelect");
let selectedDayKey = "ALL";

let entriesReqId = 0;
let remainingReqId = 0;
let activeTab2 = "fixtures"; // track current tab

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

const allModals = [systemModal, profileModal, infoModal, playerModal, privacyModal].filter(Boolean);


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

let competitionOver = false;
let winnerEmail = null;
let lastRemainingFetchAt = 0; // throttle for polling

let lobbyCountsByGame = {};
let lobbyCountsLoading = {};

let lobbyPoll = null;
let lastEntryApprovedByGame = {};

let lastLobbyRenderSig = "";


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

function getTeamLogo_(teamName) {
  const key = normTeamKey_(teamName);
  return TEAM_LOGO_MAP.get(key) || DEFAULT_TEAM_LOGO;
}

async function fetchGames_() {
  const data = await api({ action: "getGames" });
  gamesList = Array.isArray(data.games) ? data.games : [];
}

async function fetchMyEntries_() {
  if (!sessionEmail) return;
  const data = await api({ action: "getMyEntries", email: sessionEmail });
  myEntries = Array.isArray(data.entries) ? data.entries : [];
}

function getMyEntryForGame_(gameId) {
  const gid = String(gameId || "");
  return (myEntries || []).find(e => String(e.gameId || "") === gid) || null;
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

  showSplash(true);

  try {
    await fetchGames_();
    await refreshLobbyCounts_();
    renderLobby_();

    await enterGame_(gameId);

    showSystemModal_(
      "Registration approved ✅",
      `
        <div style="line-height:1.5;">
          <p style="margin:0 0 10px;"><strong>You have been approved for ${escapeHtml(gameTitle)}.</strong></p>
          <p style="margin:0;">You can now make your first selection.</p>
        </div>
      `,
      { showActions: false }
    );

    return true;
  } catch (err) {
    console.warn("Lobby approval transition failed", err);
    return false;
  } finally {
    showSplash(false);
  }
}

function startLobbyPolling_() {
  if (!sessionEmail) return;

  if (lobbyPoll) {
    clearInterval(lobbyPoll);
    lobbyPoll = null;
  }

  lobbyPoll = setInterval(async () => {
    try {
      const hadSnapshot = Object.keys(lastEntryApprovedByGame || {}).length > 0;

      await fetchMyEntries_();

      if (!hadSnapshot) {
        snapshotLobbyApprovalStates_();
        refreshLobbyCounts_().catch(() => { });
        return;
      }

      const changed = await handleLobbyApprovalChanges_();
      if (changed) return;

      snapshotLobbyApprovalStates_();
      refreshLobbyCounts_().catch(() => { });
    } catch (err) {
      console.warn("Lobby polling failed", err);
    }
  }, 8000);
}

function stopLobbyPolling_() {
  if (lobbyPoll) {
    clearInterval(lobbyPoll);
    lobbyPoll = null;
  }
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

      <p><strong>Prize split:</strong> roughly 60% winner, 30% fundraising, 10% admin.</p>

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

function getGameBannerUrl_(gameId) {
  return `images/game-banners/${String(gameId || "").trim()}.png`;
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

    lobbyCountsLoading[gameId] = true;

    try {
      const gwId = String(g.startGw || "GW1").toUpperCase();
      const data = await api({ action: "getEntries", gameId, gwId });
      const users = Array.isArray(data.users) ? data.users : [];

      const approvedUsers = users.filter(u => isApproved_(u));
      const pendingUsers = users.filter(u => !isApproved_(u));
      const aliveApprovedUsers = approvedUsers.filter(u => u.alive);

      lobbyCountsByGame[gameId] = {
        registered: users.length || 0,
        approved: approvedUsers.length || 0,
        pending: pendingUsers.length || 0,
        remaining: aliveApprovedUsers.length || 0,
        total: users.length || 0
      };
    } catch (err) {
      console.warn("Lobby counts failed for", gameId, err);
    } finally {
      lobbyCountsLoading[gameId] = false;
    }
  }));

  renderLobby_();
}

function getCompetitionLogo_(name) {
  const key = String(name || "").trim().toLowerCase();

  const map = {
    "premier league": "images/competitions/premier-league.png",
    "championship": "images/competitions/championship.png",
    "league one": "images/competitions/league-one.png",
    "league two": "images/competitions/league-two.png",
    "fa cup": "images/competitions/fa-cup.png",
  };

  return map[key] || "images/competitions/default.png";
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


// Small reusable HTML renderer

function teamInlineHtml_(teamName, { size = 18, logoPosition = "before", isSelected = false, displayName = null } = {}) {
  const logo = getTeamLogo_(teamName);
  const shown = displayName || teamName;

  const logoImg = `
    <img class="team-logo" src="${escapeAttr(logo)}" alt="${escapeAttr(teamName)} logo"
         width="${size}" height="${size}"
         onerror="this.onerror=null;this.src='${escapeAttr(DEFAULT_TEAM_LOGO)}';" />
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
  const pickKey = normTeamKey_(highlightTeam);
  const homeSel = pickKey && normTeamKey_(home) === pickKey;
  const awaySel = pickKey && normTeamKey_(away) === pickKey;

  return `
    <div class="fixture-teams">
      ${teamInlineHtml_(home, {
    logoPosition: "before",
    isSelected: homeSel,
    displayName: displayTeamNameForFixture_(home)   // ✅ alias here only
  })}
      <span class="vs">vs</span>
      ${teamInlineHtml_(away, {
    logoPosition: "after",
    isSelected: awaySel,
    displayName: displayTeamNameForFixture_(away)   // ✅ alias here only
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
  return Array.isArray(data.rows) ? data.rows : [];
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
    const row = deadlinesByGw.get(String(gw.id || "").toUpperCase());
    if (!row) return gw;

    return {
      ...gw,
      deadline: row.normalDeadlineIso ? new Date(row.normalDeadlineIso) : gw.deadline,
      lateDeadline: row.lateDeadlineIso ? new Date(row.lateDeadlineIso) : gw.lateDeadline,
      firstKickoff: row.firstKickoffIso ? new Date(row.firstKickoffIso) : gw.firstKickoff,
      lastKickoff: row.lastKickoffIso ? new Date(row.lastKickoffIso) : gw.lastKickoff,
      endCutoff: row.lateDeadlineIso ? new Date(row.lateDeadlineIso) : gw.endCutoff
    };
  });
}

function getGameweeksForGame_(game) {
  if (!game || !fixtures.length) return [];
  return applyDeadlinesToGameweeks_(buildGameweeks(fixtures, game));
}

function shouldShowGwReportRow_(row, gwId) {
  const rowGwId = String(row?.gwId || gwId || "").toUpperCase();
  const targetGwId = String(gwId || "").toUpperCase();

  if (rowGwId && rowGwId !== targetGwId) return false;

  const hasSelection = !!String(row?.selection || "").trim();
  const outcome = String(row?.outcome || "").trim().toUpperCase();

  // show:
  // - normal submitted rows
  // - missed submit rows once they become LOSS
  // - explicit pending rows
  if (hasSelection) return true;
  if (outcome === "WIN" || outcome === "LOSS" || outcome === "PENDING") return true;

  return false;
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

function getRunningStatusText_() {
  const game = getActiveGame_();
  const status = String(game?.status || "").toUpperCase();

  if (status !== "RUNNING") return status || "—";

  const counts = lobbyCountsByGame[String(activeGameId || "")] || {};
  const remaining = Number(counts.remaining || 0);

  if (remaining <= 1) {
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
    let rows = await fetchGwReportRows_(gwId);
    rows = Array.isArray(rows) ? rows : [];
    rows = rows.filter(r => shouldShowGwReportRow_(r, gwId));

    const count = rows.length;

    if (lastGwReportCountGwId !== gwId || lastGwReportCount !== count) {
      lastGwReportCountGwId = gwId;
      lastGwReportCount = count;

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
    ${escapeHtml(gwLabelLong(gwId))} - Selections
    <span class="muted" id="gwReportModalCountDots">
      <span class="dots" aria-label="Loading"></span>
    </span>
    <span id="gwReportModalCount"></span>
  `;

  bodyEl.innerHTML = `
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
    rows = await fetchGwReportRows_(gwId);
    rows = Array.isArray(rows) ? rows : [];
  } catch {
    rows = [];
  }

  rows = rows.filter(r => String(r.selection || "").trim());

  const totalSelections = rows.length;

  const countEl = document.getElementById("gwReportModalCount");
  const dotsEl = document.getElementById("gwReportModalCountDots");

  if (countEl) countEl.textContent = String(totalSelections);
  if (dotsEl) dotsEl.style.display = "none";

  const tbodyHtml = rows.map(r => {
    const name = r.name || r.email || "—";
    const club = simplifyClub_(r.clubTeam || "—");
    const sel = String(r.selection || "").trim();
    const resLabel = outcomeLabel_(r.outcome);
    const resCls = outcomeCls_(r.outcome);

    return `
      <tr>
        <td title="${escapeAttr(name)}">${escapeHtml(name)}</td>
        <td class="muted" title="${escapeAttr(club)}">${escapeHtml(club)}</td>
        <td class="gw-cell-selection">
          ${teamInlineHtml_(sel, { size: 12, logoPosition: "before" })}
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
  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) {
    setBtnLoading(submitPickBtn, false);
    return;
  }

  const fx = findFixtureForTeam(gw, team);
  if (!fx) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("Match not found for this gameweek.", "bad");
    return;
  }

  const kickoffText = fx.kickoffHasTime
    ? `${formatDateWithOrdinalShortUK(fx.kickoff)} - ${formatTimeUK(fx.kickoff)}`
    : `${formatDateWithOrdinalShortUK(fx.kickoff)}`;

  showConfirmModal_(
    `<span class="">Confirm selection:</span> <strong>${escapeHtml(team)}?</strong>`,
    `
      <div style="margin-top:10px;">
        <div class="fixture-row">
          <div class="fixture-main">
            ${fixtureTeamsHtml_(fx.home, fx.away, { highlightTeam: team })}
            <div class="fixture-datetime muted">${escapeHtml(kickoffText)}</div>
          </div>
        </div>
      </div>
    `,
    {
      confirmText: "Confirm",
      cancelText: "Cancel",
      onConfirm: async () => {
        await savePick(team);
      }
    }
  );
}

function getActiveGame_() {
  return (gamesList || []).find(g => String(g.id || "") === String(activeGameId || "")) || null;
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
    return `Winner: <strong>${escapeHtml(winnerText)}</strong>`;
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
  const remaining = Number(lobbyCountsByGame[gameId]?.remaining || 0);

  if (remaining <= 1) {
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
    if (lateRegistrationOpen) return "Late registration";
    if (registrationOpenNow) return "Registration open";
    if (firstDeadlinePassed) return "Registration closed";
    return "Registration open";
  }

  return "Registration open";
}

function getGameBannerStatusClass_(game, entry) {
  const text = getGameBannerStatusText_(game, entry);

  if (text === "Pending") return "game-status-pill--running";
  if (text.startsWith("Running:")) return "game-status-pill--running";
  if (text.startsWith("Finished:")) return "game-status-pill--finished";
  if (text === "Registration closed") return "game-status-pill--finished";

  return "game-status-pill--open";
}

function getPlayersBadgeHtml_(game, counts) {
  const status = String(game?.status || "").toUpperCase();
  const registered = Number(counts?.registered || counts?.total || 0);
  const remaining = Number(counts?.remaining || 0);
  const total = Number(counts?.total || 0);

  if (status === "RUNNING") {
    return `
      <span class="hero-pill-tooltip" data-tooltip="Remaining players">
        <span class="pill-emoji">👤</span> ${remaining}/${total}
      </span>
    `;
  }

  if (status === "FINISHED") {
    return `
      <span class="hero-pill-tooltip" data-tooltip="Players">
        <span class="pill-emoji">👤</span> ${total}
      </span>
    `;
  }

  return `
    <span class="hero-pill-tooltip" data-tooltip="Players">
      <span class="pill-emoji">👤</span> ${registered}
    </span>
  `;
}



function renderGameTitleBox_() {
  const game = getActiveGame_();
  const entry = getMyEntryForGame_(activeGameId);

  const counts = lobbyCountsByGame[String(activeGameId || "")] || {};

  const remainingCount = Number(counts.remaining || 0);
  const totalCount = Number(counts.total || 0);
  const isWinner = isEntryWinner_(entry, remainingCount);

  const playerNameEl = document.getElementById("gameTitlePlayerName");
  const metaEl = document.getElementById("gameTitleBoxMeta");
  const statusPillEl = document.getElementById("gameTitleStatusPill");
  const playersBadgeEl = document.getElementById("gameTitlePlayersBadge");
  const prizeBadgeEl = document.getElementById("gameTitlePrizeBadge");

  if (!playerNameEl || !metaEl || !statusPillEl || !playersBadgeEl || !prizeBadgeEl) return;

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
  const status = String(game.status || "OPEN").toUpperCase();
  const prize = Number(game.prize || 0);
  const hasPrize = Number.isFinite(prize) && prize > 0;
  const entryFee = Number(game.entryFee || 0);
  const winner = String(game.winner || "").trim();

  // EXACT same deadline logic as lobby
  const firstGw = getGameFirstGw_(game);
  const lateRegistrationOpen = isGameLateRegistrationOpen_(game);
  const deadlineIso = lateRegistrationOpen
    ? (firstGw?.lateDeadline ? firstGw.lateDeadline.toISOString() : "")
    : (firstGw?.deadline ? firstGw.deadline.toISOString() : "");
  const showCountdown = status === "OPEN" && !!deadlineIso;

  // EXACT same image method as lobby
  const bannerImg = document.querySelector("#gameTitleBox .game-hero-banner-img");
  if (bannerImg) {
    bannerImg.src = getGameBannerUrl_(gameId);
    bannerImg.alt = `${title} banner`;
    bannerImg.onerror = function () {
      this.onerror = null;
      this.src = "images/game-banners/default.png";
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

  // EXACT same top-left badge behaviour as lobby
  playersBadgeEl.innerHTML = getPlayersBadgeHtml_(game, counts);
  playersBadgeEl.classList.remove("hidden");

  // top-right badge
  if (status === "OPEN") {
    prizeBadgeEl.innerHTML = `
      <span class="hero-pill-tooltip" data-tooltip="Entry fee">
        <span class="pill-emoji">🎟️</span> £${entryFee}
      </span>
    `;
    prizeBadgeEl.classList.remove("hidden");
  } else if (hasPrize) {
    prizeBadgeEl.innerHTML = `
      <span class="hero-pill-tooltip" data-tooltip="1st prize">
        <span class="pill-emoji">💰</span> £${prize}
      </span>
    `;
    prizeBadgeEl.classList.remove("hidden");
  } else {
    prizeBadgeEl.innerHTML = "";
    prizeBadgeEl.classList.add("hidden");
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



const TEAM_NAME_ALIAS = {
  "manchester united": "Man United",
  "manchester city": "Man City",
  "nottingham forest": "Nott'm Forest",
  "sheffield wednesday": "Sheff Wed",
  "sheffield united": "Sheff Utd",
  "queens park rangers": "QPR",
  "brighton and hove albion": "Brighton",
  "wolverhampton wanderers": "Wolves",
  "oxford utd": "Oxford",
  "leicester city": "Leicester",
  "blackburn rovers": "Blackburn",
  "norwich city": "Norwich",
  "ipswich town": "Ipswich",
  "wigan athletic": "Wigan",
  "northampton town": "Northampton",
  "harrogate town": "Harrogate",
  "newport county": "Newport",
  "salford city": "Salford",
  "crawley town": "Crawley",
  "swindon town": "Swindon",
  "oldham athletic": "Oldham",
  "cambridge united": "Cambridge",
  "grimsby town": "Grimsby",
};

function displayTeamName_(name) {
  const k = normTeamKey_(name);   // you already have this normalizer
  return TEAM_NAME_ALIAS[k] || name;
}

function displayTeamNameForFixture_(name) {
  const k = normTeamKey_(name);
  return TEAM_NAME_ALIAS[k] || name;
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


function upsertLocalPick(gwId, team) {
  gwId = String(gwId || "").trim().toUpperCase(); // ✅ normalize

  const idx = sessionPicks.findIndex(p => String(p.gwId || "").toUpperCase() === gwId);

  const base = {
    submittedAt: new Date().toISOString(),
    gwId,
    team,
    outcome: "PENDING"
  };

  if (idx >= 0) {
    const prev = sessionPicks[idx];
    sessionPicks[idx] = { ...prev, ...base, outcome: prev.outcome || "PENDING" };
  } else {
    sessionPicks.push(base);
  }

  sessionPicks = Array.isArray(sessionPicks) ? sessionPicks : [];
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
    teams.add(f.home);
    teams.add(f.away);
  }

  return Array.from(teams).sort((a, b) => a.localeCompare(b));
}

function updateTeamDatalist() {
  if (!teamsDatalist) return;
  teamsDatalist.innerHTML = "";
  const teams = getTeamsForSelectedGw();
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
  const teams = getTeamsForSelectedGw();

  if (!q) {
    teamSuggest.classList.add("hidden");
    teamSuggest.innerHTML = "";
    return;
  }

  const hits = teams
    .filter(t => t.toLowerCase().includes(q))
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
  const myReq = ++remainingReqId;

  const firstLoad = (lastRemainingPlayers == null || lastTotalPlayers == null);
  remainingLoading = firstLoad;

  if (firstLoad) renderStatusBox();

  try {
    const data = await api({ action: "getEntries", gameId: activeGameId, gwId: currentGwId });
    if (myReq !== remainingReqId) return;

    const users = Array.isArray(data.users) ? data.users : [];

    const approvedUsers = users.filter(u => isApproved_(u));
    const pendingUsers = users.filter(u => !isApproved_(u));
    const aliveApprovedUsers = approvedUsers.filter(u => u.alive);

    lastApprovedPlayers = approvedUsers.length;
    lastPendingPlayers = pendingUsers.length;
    lastRemainingPlayers = aliveApprovedUsers.length;
    lastTotalPlayers = users.length;

    const alive = aliveApprovedUsers;

    const started = hasCompetitionStarted_();
    if (started && alive.length === 1) {
      competitionOver = true;
      winnerEmail = String(alive[0]?.email || "").toLowerCase() || null;
    } else {
      competitionOver = false;
      winnerEmail = null;
    }

    if (sessionUser?.alive === false) {
      await refreshMyPlacingIfDead_();
    }
  } catch {
    // ignore
  } finally {
    remainingLoading = false;
    renderStatusBox();
    renderGameTitleBox_();
    applyWinConditionUi_();
  }
}


function payInstructionsHtml_(entryFee = 10) {
  return `
    <div class="pay-modal">
      <div class="pay-card">
        <div><strong>Entry fee:</strong> £${entryFee}</div>

        <div class="pay-details" style="margin-top:8px;line-height:1.5;">
          <strong>Bank transfer details:</strong><br>
          Account name: Nicholas Horne<br>
          Account number: 78664226<br>
          Sort code: 60-83-71<br>
          Reference: <strong>Poly LMS</strong>
        </div>
      </div>
      <div style="margin-top:14px;" class="muted small">
        If you have already sent the money please be patient, your account will be approved as soon as possible.
      </div>
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

  // Use login-style identity from session email by asking my entries + account login state.
  // For now we can just keep whatever login returned, but this helper prevents null issues.
  if (!sessionUser) {
    sessionUser = {
      email: sess.email,
      firstName: "",
      lastName: "",
      phone: "",
      clubTeam: "",
      approved: false,
      alive: true
    };
  }
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

  document.getElementById("sysCancelBtn")?.addEventListener("click", () => {
    closeModal(modalEl);
    setBtnLoading(submitPickBtn, false);
  }, { once: true });

  document.getElementById("sysConfirmBtn")?.addEventListener("click", async () => {
    closeModal(modalEl);
    await onConfirm?.();
  }, { once: true });

  // If modal is closed by X or overlay, treat as cancel
  const handleCancel = () => {
    setBtnLoading(submitPickBtn, false);
  };

  modalEl.addEventListener("close", handleCancel, { once: true });

  openModal(modalEl);
}

function showSystemModal_(title, html, { showActions = true } = {}) {
  const systemModal = document.getElementById("systemModal");
  const titleEl = document.getElementById("systemModalTitle");
  const bodyEl = document.getElementById("systemModalBody");
  const actionsEl = document.getElementById("systemModalActions");

  if (!systemModal || !titleEl || !bodyEl || !actionsEl) return;

  closeAllModals();

  titleEl.textContent = title || "";
  bodyEl.innerHTML = html || "";

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


function showPaymentDetailsModal_() {
  showSystemModal_(
    "",
    payInstructionsHtml_(),
    { showActions: true }
  );

  const titleEl = document.getElementById("systemModalTitle");
  if (titleEl) titleEl.textContent = "";
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
  return "PENDING";
}

/**
 * Opens a modal for a given player (from getEntries list).
 * Hides the current GW team (only shows "Team submitted …" or "Not submitted").
 */

async function openPlayerPicksModal_(player, gwIdForEntries, allUsers = []) {
  const fullName =
    `${player.firstName || ""} ${player.lastName || ""}`.trim() || "Player";

  const club =
    String(player.clubTeam || player.club || player.team || "").trim() || "—";

  const isAlive = player.alive === true;
  const isDead = player.alive === false;

  const approved = isApproved_(player);

  const status = !approved
    ? "pending"     // 👈 NEW
    : isAlive
      ? "alive"
      : isDead
        ? "dead"
        : null;

  function gwRowUi_(gwId, { submitted }) {
    // (GW1 - Pending approval ...) red
    if (!approved) {
      return {
        rowCls: "approval-pending",     // NEW red class
        text: "Pending approval",
        stateCls: "bad",
        icon: "…"
      };
    }

    // (GW1 - Team submitted ✓) orange
    if (submitted) {
      return {
        rowCls: "pending",              // your existing orange styling
        text: "Team submitted",
        stateCls: "warn",
        icon: "✓"
      };
    }

    // (GW1 - Not submitted …) grey
    return {
      rowCls: "neutral",               // your existing grey styling
      text: "Not submitted",
      stateCls: "muted",
      icon: "…"
    };
  }


  // 1) show instantly (loading state)
  const loadingHtml = `
    <div class="muted small" style="margin-bottom:10px;">${escapeHtml(club)}</div>
    <div class="fixtures-card" style="padding:12px;">
      <div class="status-rows">
        <div class="status-row neutral">
          <div>
            Fetching picks <span class="dots" aria-label="Loading"></span>
          </div>
          <!-- no right-hand state icon while loading -->
        </div>
      </div>
    </div>
  `;

  showPlayerModal_(fullName, loadingHtml, { status, approved });

  // ranking line only for dead
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
    } catch { }
  }

  // 2) get picks
  let picks = Array.isArray(player.picks) ? player.picks : [];

  if (!picks.length && player.email) {
    try {
      const resp = await api({ action: "getUserPicks", email: player.email, gameId: activeGameId })
      if (Array.isArray(resp.picks)) picks = resp.picks;
    } catch {
      picks = [];
    }
  }

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

  const currentGwKey = String(gwIdForEntries || "").toUpperCase();
  let rowsHtml = "";

  if (!picksSorted.length) {
    if (isDead) {
      rowsHtml = `
        <div class="status-row loss">
          <div>
            ${escapeHtml(gwLabelShort(player.knockedOutGw || "—"))} - ${teamInlineHtml_(player.knockedOutTeam || "—", { size: 16, logoPosition: "before" })}
          </div>
          <div class="state bad">✕</div>
        </div>
      `;
    } else {
      const submitted = !!player.submittedForGw;
      const ui = gwRowUi_(currentGwKey, { submitted });

      rowsHtml += `
        <div class="status-row ${ui.rowCls}">
          <div>${escapeHtml(gwLabelShort(currentGwKey))} - ${ui.text}</div>
          <div class="state ${ui.stateCls}">${ui.icon}</div>
        </div>
      `;
    }
  } else {
    for (const p of picksSorted) {
      const isCurrent = p.gwId === currentGwKey;

      // ✅ privacy: if alive + current gw + pending, never show team or “in progress”
      if (isAlive && isCurrent && p.outcome === "PENDING") {
        const submitted = !!player.submittedForGw;
        const ui = gwRowUi_(currentGwKey, { submitted });
        rowsHtml += `
          <div class="status-row ${ui.rowCls}">
            <div>${escapeHtml(gwLabelShort(currentGwKey))} - ${ui.text}</div>
            <div class="state ${ui.stateCls}">${ui.icon}</div>
          </div>
        `;
        continue;
      }

      const icon = p.outcome === "WIN" ? "✓" : p.outcome === "LOSS" ? "✕" : "…";
      const cls = p.outcome === "WIN" ? "good" : p.outcome === "LOSS" ? "bad" : "warn";
      const label = p.outcome === "WIN" ? "Won" : p.outcome === "LOSS" ? "Lost" : "In progress";

      rowsHtml += `
        <div class="status-row fade-row ${p.outcome === "WIN" ? "win" : p.outcome === "LOSS" ? "loss" : "pending"}">
          <div>
            ${escapeHtml(gwLabelShort(convertFixtureGwToGameGw_(p.gwId, game)))} - ${teamInlineHtml_(p.team || "—", { size: 16, logoPosition: "before" })}
          </div>
          <div class="state ${cls}">${icon}</div>
        </div>
      `;
    }

    // Ensure current GW line exists for alive players even if not present
    if (isAlive && currentGwKey) {
      const hasCurrent = picksSorted.some(p => p.gwId === currentGwKey);
      if (!hasCurrent) {
        const submitted = !!player.submittedForGw;
        const ui = gwRowUi_(currentGwKey, { submitted });

        rowsHtml += `
          <div class="status-row ${ui.rowCls}">
            <div>${escapeHtml(gwLabelShort(currentGwKey))} - ${ui.text}</div>
            <div class="state ${ui.stateCls}">${ui.icon}</div>
          </div>
        `;
      }
    }
  }

  // 3) final render
  const finalHtml = `
    <div class="muted small" style="margin-bottom:10px;">${escapeHtml(club)}</div>

    <div class="fixtures-card" style="padding:12px;">
      <div class="status-rows">${rowsHtml}</div>
      ${positionLine ? `<div class="muted small" style="margin-top:10px;">${positionLine}</div>` : ""}
    </div>
  `;


  showPlayerModal_(fullName, finalHtml, { status, approved });

  // animate rows in
  requestAnimationFrame(() => {
    const rows = playerModalBody?.querySelectorAll(".fade-row") || [];
    rows.forEach((el, i) => setTimeout(() => el.classList.add("is-in"), i * 60));
  });
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

function renderStatusBox() {
  const box = document.getElementById("statusBox");
  if (!box || !sessionUser) return;

  const game = getActiveGame_();
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

  const maxGwId = getLastStartedActualGwIdForGame_(game) || currentGwId;
  const maxGwIndex = findGwIndexById(maxGwId);

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

  function stateHtml_(outcome, hasTeam) {
    const o = String(outcome || "PENDING").toUpperCase();

    if (!hasTeam) return ``;
    if (o === "WIN") return `<div class="state good">✓</div>`;
    if (o === "LOSS") return `<div class="state bad">✕</div>`;
    return `<div class="state warn">…</div>`;
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

    (gameweeks || []).forEach(gw => {
      const gwId = String(gw.id || "").toUpperCase();
      const gwIndex = findGwIndexById(gwId);

      if (gwIndex < 0 || gwIndex > maxGwIndex) return;

      const pick = picksByGw.get(gwId) || null;
      const hasTeam = !!String(pick?.team || "").trim();
      const outcome = String(pick?.outcome || "PENDING").toUpperCase();

      const isCurrentNoPickAlive =
        !hasTeam &&
        isAlive &&
        gwId === String(currentGwId || "").toUpperCase();

      const isFutureNoPickAfterDead =
        isDead &&
        !hasTeam &&
        gwIndex > findGwIndexById(String(sessionUser?.knockedOutGw || "").toUpperCase());

      if (!hasTeam && !isCurrentNoPickAlive && !isFutureNoPickAfterDead) return;

      let rowCls = "neutral";
      let leftHtml = "";

      if (hasTeam) {
        rowCls = rowClass(outcome);
        leftHtml = `
          <span>${escapeHtml(gwLabelShort(gwId))} - </span>
          ${teamInlineHtml_(pick.team, { size: 16, logoPosition: "before" })}
        `;
      } else {
        rowCls = "neutral";
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
              ${stateHtml_(outcome, hasTeam)}
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
  // Treat your JSON date/time as UK local clock time.
  // Convert it into an absolute Date in UTC reliably.
  // We do this by parsing as if it’s UTC, then formatting in Europe/London for display.
  // (This avoids browser-local timezone differences)
  const t = (timeStr && String(timeStr).trim()) ? String(timeStr).trim() : null;

  const iso = t ? `${dateStr}T${t}:00Z` : `${dateStr}T12:00:00Z`;
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

  return {
    gwId: String(gwId).trim().toUpperCase(),
    league: leagueName,
    kickoff,
    kickoffHasTime: !!hasTime,
    home: String(home),
    away: String(away),
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
    const lastPick = sessionPicks[sessionPicks.length - 1];
    return lastPick?.gwId || gameweeks[0].id;
  }

  const picksSorted = [...sessionPicks].sort((a, b) => findGwIndexById(a.gwId) - findGwIndexById(b.gwId));
  const lastPick = picksSorted.length ? picksSorted[picksSorted.length - 1] : null;

  if (!lastPick) {
    return computeDateGwId() || gameweeks[0].id;
  }

  if (lastPick.outcome === "LOSS") return lastPick.gwId;

  if (lastPick.outcome === "WIN") {
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

function getUnstartedFixturesForGw_(gwId) {
  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) return [];

  const nowMs = Date.now();
  return gw.fixtures.filter(f => f.kickoff.getTime() > nowMs);
}

function getUnstartedTeamsForGw_(gwId) {
  const teams = new Set();

  getUnstartedFixturesForGw_(gwId).forEach(f => {
    teams.add(f.home);
    teams.add(f.away);
  });

  return Array.from(teams).sort((a, b) => a.localeCompare(b));
}


function isGameLateRegistrationOpen_(game) {
  const firstGw = getGameFirstGw_(game);
  if (!firstGw?.lateDeadline) return false;

  const nowMs = Date.now();
  return nowMs >= firstGw.deadline.getTime() && nowMs < firstGw.lateDeadline.getTime();
}

function isGameRegistrationOpenNow_(game) {
  const status = String(game?.status || "").toUpperCase();
  if (status !== "OPEN") return false;

  const firstGw = getGameFirstGw_(game);
  if (!firstGw?.lateDeadline) return false;

  return Date.now() < firstGw.lateDeadline.getTime();
}


async function loadDeadlines() {
  const res = await fetch("gameweek-deadlines.json", { cache: "no-store" });
  if (!res.ok) return new Map();

  const data = await res.json();
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
  deadlinesByGw = await loadDeadlines();

  const activeGame = getActiveGame_();
  gameweeks = activeGame ? getGameweeksForGame_(activeGame) : [];
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
  sessionPicks = Array.isArray(data.picks) ? data.picks : [];

  sessionPicks = sessionPicks.map(p => ({
    ...p,
    gwId: String(p.gwId || "").toUpperCase(),
    outcome: normalizeOutcome_(p.outcome)
  }));

  usedTeams = new Set(sessionPicks.filter(p => p.outcome === "WIN").map(p => p.team));
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
      submitPickBtn.disabled =
        hasPick ||
        !sessionUser?.approved ||
        (diffMs <= 0 && !lateSubmitOpen);
    }
  };

  tick();
  deadlineInterval = setInterval(tick, 1000);
}

function normTeam_(s) {
  return String(s || "").trim().toLowerCase();
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
function getPickForGw(gwId) {
  return sessionPicks.find(p => p.gwId === gwId) || null;
}



function renderFixturesTab() {
  const viewGw = gameweeks.find(g => g.id === viewingGwId);
  if (!viewGw) return;

  renderCurrentPickBlock();
  renderStatusBox();
  renderPickCardState();


  // ✅ Enable/disable submit based on CURRENT gw (not viewing gw)
  const curGw = gameweeks.find(g => g.id === currentGwId);
  if (curGw) {
    const locked = Date.now() >= curGw.deadline.getTime();
    if (submitPickBtn) submitPickBtn.disabled = locked || !sessionUser?.approved || sessionUser?.alive === false;
  }

  // ✅ Keep these tied to CURRENT gw
  startDeadlineTimer();   // reads currentGwId
  updateTeamDatalist();   // reads currentGwId

  // ----------------------------
  // Fixtures list uses VIEWING GW only
  // ----------------------------
  if (!fixturesList) return;
  fixturesList.innerHTML = "";

  const byDay = new Map();
  for (const f of viewGw.fixtures) {
    const dayKey = new Date(f.kickoff);
    dayKey.setHours(0, 0, 0, 0);
    const key = dayKey.toISOString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(f);
  }

  const dayKeys = Array.from(byDay.keys()).sort();

  // Day dropdown options
  if (daySelect) {
    if (selectedDayKey !== "ALL" && !dayKeys.includes(selectedDayKey)) {
      selectedDayKey = "ALL";
    }

    daySelect.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "ALL";
    optAll.textContent = "All days";
    daySelect.appendChild(optAll);

    for (const dk of dayKeys) {
      const d = new Date(dk);
      const opt = document.createElement("option");
      opt.value = dk;
      opt.textContent = formatDateUK(d);
      daySelect.appendChild(opt);
    }

    daySelect.value = selectedDayKey;

    if (!daySelect.dataset.bound) {
      daySelect.dataset.bound = "1";
      daySelect.addEventListener("change", () => {
        selectedDayKey = daySelect.value;
        renderFixturesTab();
      });
    }
  }

  const renderKeys = (selectedDayKey === "ALL") ? dayKeys : [selectedDayKey];

  for (const dk of renderKeys) {
    const dayDate = new Date(dk);

    const dayGroup = document.createElement("div");
    dayGroup.className = "day-group";

    const head = document.createElement("div");
    head.className = "day-head";
    head.innerHTML = `
  <div >
        <div class="day-title">${formatDateUK(dayDate)}</div>
        <div class="day-sub">Fixtures</div>
      </div >
  `;
    dayGroup.appendChild(head);

    const leagueMap = new Map();
    for (const f of byDay.get(dk) || []) {
      if (!leagueMap.has(f.league)) leagueMap.set(f.league, []);
      leagueMap.get(f.league).push(f);
    }

    const allowedLeagues = getGameCompetitions_(getActiveGame_());

    for (const leagueName of allowedLeagues) {
      const list = leagueMap.get(leagueName);
      if (!list || !list.length) continue;

      const details = document.createElement("details");
      details.className = "league-details";
      details.open = false; // ✅ start collapsed

      const summary = document.createElement("summary");
      summary.className = "league-summary";
      summary.textContent = `${leagueName} (${list.length})`;
      details.appendChild(summary);


      const container = document.createElement("div");
      container.className = "league-group";

      for (const f of list.sort((a, b) => a.kickoff - b.kickoff)) {
        const row = document.createElement("div");
        row.className = "fixture-row";

        const timeHtml = f.kickoffHasTime
          ? `<div class="fixture-time muted" > ${formatTimeUK(f.kickoff)}</div > `
          : "";

        const dateLine = f.kickoffHasTime
          ? `${escapeHtml(formatDateUK(f.kickoff))} · ${escapeHtml(formatTimeUK(f.kickoff))} `
          : `${escapeHtml(formatDateUK(f.kickoff))} `;

        row.innerHTML = `
  <div class="fixture-main" >
    ${fixtureTeamsHtml_(f.home, f.away)}
<div class="fixture-datetime muted">${dateLine}</div>
          </div >
  `;


        container.appendChild(row);
      }

      details.appendChild(container);
      dayGroup.appendChild(details);
    }

    fixturesList.appendChild(dayGroup);
  }
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
    const gwIdForEntries = currentGwId;
    const data = await api({ action: "getEntries", gameId: activeGameId, gwId: gwIdForEntries });

    if (myReq !== entriesReqId) return;

    const users = data.users || [];
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
            <div class="list-title">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
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
              <div class="list-title">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
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
            <div class="list-title">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
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
                onerror="this.onerror=null;this.src='images/competition-logos/default.png';"
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
      entry: getMyEntryForGame_(g.id) || null
    }))
  });

  if (lobbySig === lastLobbyRenderSig) return;
  lastLobbyRenderSig = lobbySig;

  const cardsHtml = (gamesList || []).map(g => {
    const gameId = String(g.id || "");
    const title = String(g.title || gameId);
    const status = String(g.status || "OPEN").toUpperCase();
    const prize = Number(g.prize || 0);
    const hasPrize = Number.isFinite(prize) && prize > 0;
    const winner = String(g.winner || "").trim();
    const entry = getMyEntryForGame_(gameId);

    const counts = lobbyCountsByGame[gameId];

    const entryFee = Number(g.entryFee || 0);

    const isRegistered = !!entry;
    const isApproved = !!entry?.approved;
    const isDead = entry?.alive === false;
    const isAlive = isRegistered && isApproved && !isDead;
    const isWinner = isEntryWinner_(entry, counts?.remaining);

    const firstGw = getGameFirstGw_(g);
    const normalDeadlineIso = firstGw?.deadline ? firstGw.deadline.toISOString() : "";
    const lateDeadlineIso = firstGw?.lateDeadline ? firstGw.lateDeadline.toISOString() : "";
    const lateRegistrationOpen = isGameLateRegistrationOpen_(g);
    const canRegisterNow = isGameRegistrationOpenNow_(g);

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
      actionsHtml = `<button class="btn btn-primary" type="button" data-enter-game="${escapeAttr(gameId)}">Enter game →</button>`;
    } else {
      actionsHtml = entry?.alive === false
        ? `<button class="btn btn-ghost" type="button" data-enter-game="${escapeAttr(gameId)}">View game →</button>`
        : `<button class="btn btn-primary" type="button" data-enter-game="${escapeAttr(gameId)}">Enter game →</button>`;
    }

    return `
      <div class="game-hero-card lobby-hero-card" style="margin-bottom:16px;">
        <div class="game-hero-banner lobby-hero-banner">
          <img
            class="game-hero-banner-img"
            src="${escapeAttr(getGameBannerUrl_(gameId))}"
            alt="${escapeAttr(title)} banner"
            onerror="this.onerror=null;this.src='images/game-banners/default.png';"
          />

          <div>
            <button
              class="hero-nav-btn"
              type="button"
              data-lobby-info="${escapeAttr(gameId)}"
              aria-label="Competition info"
            >i</button>
          </div>

          <div class="game-hero-banner-badges game-hero-banner-badges--left">
            <span class="game-hero-badge">
              ${getPlayersBadgeHtml_(g, counts)}
            </span>

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

            ${hasPrize
        ? `
                  <span class="game-hero-badge">
                    <span class="hero-pill-tooltip" data-tooltip="1st prize">
                      <span class="pill-emoji">💰</span> £${prize}
                    </span>
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

          <div class="lobby-bottom-main">
            <div class="lobby-fit">
              <div class="lobby-fit-left">

          ${status === "OPEN" && !entry && canRegisterNow
        ? `
                <div class="lobby-meta-line">
                  <span class="lobby-meta-key">Entry fee:</span>
                  <strong class="lobby-meta-key2">£${Number(g.entryFee || 0)}</strong>
                </div>

                <div class="lobby-meta-line">
                  <span class="lobby-meta-key">${lateRegistrationOpen ? "Late entry deadline:" : "Entry deadline:"}</span>
                  <div class="lobby-meta-key2">
                    <strong>${escapeHtml(formatDeadlineDay_(deadlineIso))} · ${escapeHtml(formatDeadlineTime_(deadlineIso))}</strong>
                  </div>
                </div>
              `
        : status === "OPEN" && !entry && !canRegisterNow
          ? `<div class="lobby-meta-line">Registration closed</div>`
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
              ${sessionEmail && entry ? `
                  <div class="lobby-meta-line" style="margin:0;">
                    <span class="lobby-meta-key">Your status:</span>
                    <span class="player-status-pill ${getPlayerStatusUi_(g, entry).pillClass}">
                      <span>${getPlayerStatusUi_(g, entry).text}</span>
                      <span class="state ${getPlayerStatusUi_(g, entry).stateClass}">
                        ${getPlayerStatusUi_(g, entry).icon}
                      </span>
                    </span>
                  </div>
                ` : `<div></div>`}

                              ${actionsHtml ? `
                                <div class="lobby-card-actions" style="margin:0;">
                                  ${actionsHtml}
                                </div>
                              ` : ``}
                            </div>
                        </div>
                      </div>
                    `;
  }).join("");

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
          <img class="brand-logo" src="images/lmsSquare5.jpg" alt="Polytechnic FC" />
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
      showPaymentDetailsModal_();
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

async function joinGame_(gameId, triggerBtn = null) {
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

  const game = (gamesList || []).find(g => String(g.id) === String(gameId));
  const entryFee = Number(game?.entryFee || 10);

  setBtnLoading(triggerBtn, true);

  try {
    await api(
      {
        action: "joinGame",
        email: sessionEmail,
        gameId
      },
      { timeoutMs: 30000 }
    );

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
          ${payInstructionsHtml_(entryFee)}
        </div>
      `,
      { showActions: false }
    );

    requestAnimationFrame(() => {
      setBtnLoading(triggerBtn, false);
    });

    setTimeout(async () => {
      try {
        await fetchMyEntries_();
        snapshotLobbyApprovalStates_();
        renderLobby_();
        refreshLobbyCounts_().catch(() => {});
      } catch (err) {
        console.warn("Post-join lobby refresh failed", err);
      }
    }, 50);

  } catch (err) {
    showSystemModal_(
      "Registration",
      `
        <div style="line-height:1.5;">
          <p style="margin:0;">${escapeHtml(String(err.message || err))}</p>
        </div>
      `,
      { showActions: false }
    );

    requestAnimationFrame(() => {
      setBtnLoading(triggerBtn, false);
    });
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
  activeGameId = String(gameId || "");
  activeEntry = sessionEmail ? getMyEntryForGame_(activeGameId) || null : null;

  showSplash(true);
  showGameView_();

  try {
    await initDataAndRenderGame_({ allowOutcomeModal: !!sessionEmail });

    // pending player -> open payment modal immediately
    if (sessionUser && sessionUser.approved === false) {
      showPaymentDetailsModal_();
    }
  } finally {
    showSplash(false);
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
  if (isWinner_()) {
    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  }
  if (isDeadUi_()) {
    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  }
  // Only manage button disabled state here. Do NOT toggle views.
  if (sessionUser?.alive === false) {
    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  }

  const curPick = getPickForGw(currentGwId);
  const locked = currentGwLocked();

  if (submitPickBtn) {
    submitPickBtn.disabled = locked || !sessionUser?.approved || !!curPick;
  }
}

/*******************************
 * PICK SUBMISSION
 *******************************/
async function savePick(team) {
  const gwId = currentGwId;
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

  if (now() >= gw.deadline && !isLateSubmit) {
    setBtnLoading(submitPickBtn, false);
    showFixturesMessage("Deadline has passed for this gameweek.", "bad");
    return;
  }

  if (isLateSubmit) {
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
      gwId: gwId,
      team
    });

    // ✅ Make sure we’re not stuck in editing mode after submit
    isEditingCurrentPick = false;
    setEditing(false);


    // ✅ Optimistic local update FIRST (this is the “state change”)
    upsertLocalPick(gwId, team);
    resetPickInputUi_();

    usedTeams = new Set(sessionPicks.filter(p => p.outcome === "WIN").map(p => p.team));

    // ✅ Immediately update UI so there is no “gap”
    showFixturesMessage("Selection submitted.", "good");
    renderCurrentPickBlock();
    renderStatusBox();
    renderPickCardState();

    // ✅ Show confirmation modal (use your single modal function)
    showSystemModal_(
      `${gwLabelShort(gwId)} selection confirmed: `,
      `
  <div style = "margin-top:12px;" >
          <div class="status-row pending" style="margin:0;">
            <div class="status-left" style="display:flex;align-items:center;gap:10px;">
              ${teamInlineHtml_(team, { size: 22, logoPosition: "before" })}
            </div>
            <div class="state good">✓</div>
          </div>

          <div class="muted small" style="margin-top:10px;line-height:1.4;">
            Good luck — you can edit your selection anytime before the submission deadline.
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
          ${fixtureTeamsHtml_(fx.home, fx.away)}
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
                onerror="this.onerror=null;this.src='images/competition-logos/default.png';"
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
    <div > <strong>${escapeHtml(gwLabelShort(convertFixtureGwToGameGw_(p.gwId, game)))} - ${escapeHtml(p.team)} - Won</strong></div >
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

      renderGameweekSelect();
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
  }, 8000);
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
    await fetchGames_();
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
    });

    setSession(data.user);
    sessionUser = data.user;

    await refreshAccountProfile_();
    await fetchGames_();
    await fetchMyEntries_();
    snapshotLobbyApprovalStates_();
    showLobby_();
    renderLobby_();
    refreshLobbyCounts_().catch(() => { });
    startLobbyPolling_();

    setTimeout(() => {
      const firstName = String(sessionUser?.firstName || "").trim() || "there";
      showSystemModal_(
        `Welcome back ${firstName}!`,
        `
          <div style="line-height:1.5;">
            <p style="margin:0;"></p>
          </div>
        `,
        { showActions: false }
      );
    }, 0);

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

gameweekSelect?.addEventListener("change", () => {
  viewingGwId = gameweekSelect.value;
  renderFixturesTab();
});



submitPickBtn?.addEventListener("click", () => {
  const typed = (teamSearch?.value || "").trim();
  if (!typed) return showFixturesMessage("Type a team first.", "bad");

  const gwTeams = getTeamsForSelectedGw();
  const match = gwTeams.find(t => t.toLowerCase() === typed.toLowerCase());
  if (!match) return showFixturesMessage("That team is not in this gameweek’s fixtures.", "bad");

  const existing = getPickForGw(currentGwId);

  if (usedTeams.has(match) && existing?.team !== match) {
    return showFixturesMessage("You already used that team in a previous gameweek.", "bad");
  }

  setBtnLoading(submitPickBtn, true);
  showPickConfirmModal_(match, currentGwId);
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

function renderGameweekSelect() {
  if (!gameweekSelect) return;

  gameweekSelect.innerHTML = "";

  for (const gw of gameweeks) {
    const opt = document.createElement("option");
    opt.value = gw.id;
    opt.textContent = `${gw.displayGwId} (${formatDateUK(gw.start)})`;
    gameweekSelect.appendChild(opt);
  }

  // If viewing not set, default to current
  if (!viewingGwId) viewingGwId = currentGwId;

  // If viewing is not a real option (e.g. data changed), fallback
  const ok = gameweeks.some(g => g.id === viewingGwId);
  if (!ok) viewingGwId = gameweeks[0].id;

  gameweekSelect.value = viewingGwId;
}

async function initDataAndRenderGame_({ allowOutcomeModal = true } = {}) {
  if (!activeGameId) return;

  try {
    await loadTeamLogosOnce_();
  } catch (e) {
    console.warn("Team logos failed to load:", e);
  }

  await loadFixturesAndDeadlines_();
  if (!gameweeks.length) {
    if (fixturesList) fixturesList.innerHTML = "";
    return;
  }

  if (sessionEmail) {
    await refreshProfile();
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

  renderGameweekSelect();
  syncViewingToCurrent();

  renderFixturesTab();
  renderGameTitleBox_();
  renderPaymentDetailsCard_();
  startDeadlineTimer();
  updateTeamDatalist();

  showVerifiedModalOnce_();
  applyOutcomeEffects_({ allowModal: !!allowOutcomeModal });

  setTab2("selection");

  // from here on, these are secondary/background
  refreshRemainingPlayersCount().catch(console.warn);
  renderGwReportCard_().catch?.(console.warn);
  startProfilePolling();
}


(async function boot() {
  // Start hidden until we decide where to go
  authView.classList.add("hidden");
  appView.classList.add("hidden");

  const sess = getSession();

  // No saved login -> show auth immediately, no splash
  if (!sess?.email) {
    sessionEmail = null;
    sessionUser = null;

    try {
      await fetchGames_();
      await loadFixturesAndDeadlines_();
      showLobby_();
      renderLobby_();
      refreshLobbyCounts_().catch(() => { });
      stopLobbyPolling_();
    } finally {
      showSplash(false);
    }
    return;
  }

  // Saved login -> show splash while we load
  showSplash(true);

  try {
    sessionEmail = sess.email;

    await refreshAccountProfile_();
    await fetchGames_();
    await fetchMyEntries_();
    snapshotLobbyApprovalStates_();
    await loadFixturesAndDeadlines_();
    showLobby_();
    renderLobby_();
    refreshLobbyCounts_().catch(() => { });
    startLobbyPolling_();

    // ✅ IMPORTANT: hide splash after successful init + enter
    showSplash(false);
  } catch (err) {
    console.error(err);

    if (String(err?.message || err).includes("User not found")) {
      clearSession();
    }

    // ✅ On any failure: hide splash AND show auth view
    showSplash(false);
    exitApp_();
  }
})();
