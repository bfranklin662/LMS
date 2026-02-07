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
];

const GAME_START_DATE = new Date("2026-01-01T00:00:00Z");


const DEADLINE_HOURS_BEFORE_FIRST_FIXTURE = 1;

const LS_SESSION = "cpfc_lms_session";

const TEAM_LOGOS_URL = "team-logos.json";
const DEFAULT_TEAM_LOGO = "images/team-default.png";



// --- DEBUG: force GW report UI on/off ---
const DEBUG_FORCE_GW_REPORT = false;   // set true to show the card even before deadline
const DEBUG_REPORT_GW_ID = null;       // e.g. "GW2" to force a specific GW, or null to use currentGwId




// ✅ Registration lock
const REGISTRATION_OPEN = false; // set true when you open entries again

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
const gwDateLabel = document.getElementById("gwDateLabel");
const clearPickBtn = document.getElementById("clearPickBtn");

const clubTeamEl = document.getElementById("clubTeam"); // or whatever your select id is
const connectionWrap = document.getElementById("connectionWrap");
const connectionInput = document.getElementById("connectionInput");

const daySelect = document.getElementById("daySelect");
let selectedDayKey = "ALL";

let entriesReqId = 0;
let activeTab2 = "fixtures"; // track current tab

let entriesLoading = false;
let lastEntriesSig = "";

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
const deadlineValueEl = document.getElementById("deadlineValue");


const gwTitle = document.getElementById("gwTitle");
const gwDeadline = document.getElementById("gwDeadline");
const deadlineTimer = document.getElementById("deadlineTimer");
const userStatusPill = document.getElementById("userStatusPill");
const usedTeamsPill = document.getElementById("usedTeamsPill");

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


/*******************************
 * STATE
 *******************************/
let fixtures = [];
let gameweeks = [];
let selectedGwId = null;
let pendingPick = null;
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

function hasPickForGw_(u, gwId) {
  // preferred: your API already provides this
  if (u?.submittedForGw === true) return true;

  // fallback: if API provides picks
  const picks = Array.isArray(u?.picks) ? u.picks : [];
  const gwKey = String(gwId || "").toUpperCase();
  return picks.some(p => String(p?.gwId || "").toUpperCase() === gwKey && String(p?.team || "").trim());
}

function outcomeLabel_(o) {
  const out = String(o || "PENDING").toUpperCase();
  if (out === "WIN") return "Won";
  if (out === "LOSS") return "Lost";
  return "TBC";
}

function outcomeCls_(o) {
  const out = String(o || "PENDING").toUpperCase();
  if (out === "WIN") return "good";
  if (out === "LOSS") return "bad";
  return "muted";
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
  const data = await api({ action: "getGwReport", gwId });
  return Array.isArray(data.rows) ? data.rows : [];
}

function simplifyClub_(club) {
  const s = String(club || "").trim().toLowerCase();
  if (s.includes("friend")) return "Friend";
  if (s.includes("relative")) return "Relative";
  return club || "—";
}

async function refreshGwReportCount_(gwId) {
  if (!gwId) return;
  const now = Date.now();

  // throttle (e.g. 20s) so it’s not hammering
  if (gwReportCountLoading) return;
  if (lastGwReportCountGwId === gwId && (now - lastGwReportCountFetchAt) < 20000) return;

  gwReportCountLoading = true;
  lastGwReportCountFetchAt = now;

  try {
    // 1) get report rows
    let rows = await fetchGwReportRows_(gwId);
    rows = Array.isArray(rows) ? rows : [];

    // 2) filter to alive only (same logic as modal)
    try {
      const entries = await api({ action: "getEntries", gwId });
      const aliveEmails = new Set(
        (entries.users || [])
          .filter(u => u && u.alive)
          .map(u => String(u.email || "").toLowerCase())
      );

      rows = rows.filter(r => aliveEmails.has(String(r.email || "").toLowerCase()));
    } catch {
      // if entries call fails, fall back to counting all rows
    }

    const count = rows.length;

    // ✅ only update cache if changed (prevents flicker)
    if (lastGwReportCountGwId !== gwId || lastGwReportCount !== count) {
      lastGwReportCountGwId = gwId;
      lastGwReportCount = count;

      const countEl = document.getElementById("gwReportCardCount");
      const dotsEl = document.getElementById("gwReportCardDots");
      if (countEl) countEl.textContent = String(count);
      if (dotsEl) dotsEl.style.display = "none";
    }
  } catch {
    // do nothing; importantly, do NOT clear the existing count
  } finally {
    gwReportCountLoading = false;
  }
}



async function openGwReportModal_(gwId) {
  const modal = document.getElementById("gwReportModal");
  const titleEl = document.getElementById("gwReportModalTitle");
  const bodyEl = document.getElementById("gwReportModalBody");
  if (!modal || !bodyEl) return;

  // Header title (same format as card)
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
  } catch {
    rows = [];
  }

  // ✅ Filter to ONLY alive players
  try {
    const entries = await api({ action: "getEntries", gwId });
    const aliveEmails = new Set(
      (entries.users || [])
        .filter(u => u && u.alive)
        .map(u => String(u.email || "").toLowerCase())
    );

    rows = (rows || []).filter(r => aliveEmails.has(String(r.email || "").toLowerCase()));
  } catch {
    // if entries call fails, fall back to showing all rows
  }


  const totalSelections = rows.length;

  const countEl = document.getElementById("gwReportModalCount");
  const dotsEl = document.getElementById("gwReportModalCountDots");

  if (countEl) countEl.textContent = String(totalSelections);
  if (dotsEl) dotsEl.style.display = "none";

  const tbodyHtml = (rows || []).map(r => {
    const name = r.name || r.email || "—";
    const club = simplifyClub_(r.clubTeam || "—");
    const sel = String(r.selection || "").trim();
    const resLabel = outcomeLabel_(r.outcome); // TBC/Won/Lost
    const resCls = outcomeCls_(r.outcome);     // muted/good/bad etc

    return `
      <tr>
        <td title="${escapeAttr(name)}">${escapeHtml(name)}</td>
        <td class="muted" title="${escapeAttr(club)}">${escapeHtml(club)}</td>
        <td class="gw-cell-selection">
          ${sel
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

  // Replace tbody only (prevents layout jump / flicker)
  const tbody = bodyEl.querySelector(".gw-table tbody");
  if (tbody) tbody.innerHTML = tbodyHtml || `<tr><td colspan="4" class="muted small" style="padding:10px 6px;">No selections.</td></tr>`;
}


async function renderGwReportCard_() {
  const card = document.getElementById("gwReportCard");
  if (!card) return;

  const gwId = (DEBUG_REPORT_GW_ID || GW_REPORT_GW_ID || currentGwId);
  if (!gwId) {
    card.classList.add("hidden");
    return;
  }

  // ✅ show only once GW1 deadline has passed (unless debug)
  const locked = isGwLockedById_(gwId);
  const shouldShow = DEBUG_FORCE_GW_REPORT || locked;

  if (!shouldShow) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");
  card.classList.add("gw-report-card");

  // ✅ bind click once
  if (!card.dataset.bound) {
    card.dataset.bound = "1";
    card.addEventListener("click", () => openGwReportModal_(gwId));
  }

  // ✅ build instantly (so it appears immediately)
  if (!card.dataset.built) {
    card.dataset.built = "1";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="min-width:0;">
          <div style="font-weight:900; display:flex; align-items:baseline; gap:6px; min-width:0;">
            <span id="gwReportCardPrefix" style="white-space:nowrap;">
              ${escapeHtml(gwLabelLong(gwId))} - Selections
            </span>
            <span id="gwReportCardDots" class="muted" style="display:inline-flex;">
              <span class="dots" aria-label="Loading"></span>
            </span>
            <span id="gwReportCardCount" style="white-space:nowrap;"></span>
          </div>
          <div class="muted small gw-modal-text">Tap to expand</div>
        </div>
        <div class="state muted">›</div>
      </div>
    `;
  }

  // ✅ keep prefix correct
  const prefixEl = document.getElementById("gwReportCardPrefix");
  if (prefixEl) prefixEl.textContent = `${gwLabelLong(gwId)} - Selections`;

  const dotsEl = document.getElementById("gwReportCardDots");
  const countEl = document.getElementById("gwReportCardCount");

  // ✅ stable display (no flicker)
  if (lastGwReportCountGwId === gwId && typeof lastGwReportCount === "number") {
    if (countEl) countEl.textContent = String(lastGwReportCount);
    if (dotsEl) dotsEl.style.display = "none";
  } else {
    if (countEl) countEl.textContent = "";
    if (dotsEl) dotsEl.style.display = "inline-flex";
  }

  refreshGwReportCount_(gwId);
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
  // GW1 is locked = competition started
  return isGwLockedById_("GW1");
}

function setSession(email) {
  sessionEmail = email;
  localStorage.setItem(LS_SESSION, JSON.stringify({ email }));
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
  localStorage.removeItem(LS_SESSION);
}

function now() {
  return new Date();
}

function setIconBtnLoadingReplace(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add("icon-loading");
    btn.innerHTML = `<span class="icon-spinner" aria - hidden="true" ></span > `;
  } else {
    btn.disabled = false;
    btn.classList.remove("icon-loading");
    btn.innerHTML = btn.dataset.originalHtml || "✏️";
  }
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
  <button type = "button" class="suggest-item" data-team="${escapeAttr(t)}" > ${ escapeHtml(t) }</button >
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


function setGwLabelFromSelected() {
  const gw = gameweeks.find(g => g.id === currentGwId);
  if (!gw) return;

  const title = `Gameweek ${ gw.num } `;

  const lastKickoff = gw.fixtures[gw.fixtures.length - 1]?.kickoff || gw.firstKickoff;
  const endDay = startOfDay(lastKickoff);

  // 🔁 CHANGE THIS LINE
  const range = `${ formatDateWithOrdinalShortUK(gw.start) } - ${ formatDateWithOrdinalShortUK(endDay) } `;

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

  return `${ weekday } ${ dayNum }${ suffix } ${ month } `;
}


function formatKickoffLineUK(d) {
  // "Sat 31 Jan, 15:00"
  const day = formatDateUK(d);
  const time = formatTimeUK(d);
  return `${ day }, ${ time } `;
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
    const k = `session_seen_verified::${ emailKey } `;
    if (sessionStorage.getItem(k) !== "1") {
      sessionStorage.setItem(k, "1");
      showVerifiedModalNow_();
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


async function refreshRemainingPlayersCount() {
  const myReq = ++entriesReqId;

  // Only show the loader if we have never loaded a number yet
  const firstLoad = (lastRemainingPlayers == null || lastTotalPlayers == null);
  remainingLoading = firstLoad;

  if (firstLoad) renderStatusBox(); // show dots immediately only first time

  try {
    const data = await api({ action: "getEntries", gwId: currentGwId });
    if (myReq !== entriesReqId) return;

    const users = data.users || [];

    const alive = users.filter(u => u.alive);

    lastRemainingPlayers = alive.length;
    lastTotalPlayers = users.length;

    // If I'm dead, also compute my finishing position for footer
    if (sessionUser?.alive === false) {
      await refreshMyPlacingIfDead_();
    }

  } catch {
    // ignore
  } finally {
    remainingLoading = false;
    renderStatusBox(); // update display (number if we have it)
  }
}

function payInstructionsHtml_() {
  return `
  <div class="pay-modal" >
      <div class="muted" style="margin-bottom:12px;">
        Please pay the £10 entry fee to verify your account.
      </div>

      <div class="pay-card">
        <div><strong>Entry fee:</strong> £10</div>

        <div class="pay-details" style="margin-top:8px;line-height:1.5;">
          <strong>Bank transfer details:</strong><br>
          Account name: Nicholas Horne<br>
          Account number: 78664226<br>
          Sort code: 60-83-71<br>
          Reference: <strong>Poly LMS</strong>
        </div>
      </div>
    </div>
  `;
}



function showVerifiedModalIfNeeded() {
  if (!sessionUser) return;
  if (!sessionUser.approved) return;

  const emailKey = String(sessionUser.email || "").toLowerCase();
  const key = `lms_verified_seen::${emailKey}`;
  if (localStorage.getItem(key) === "1") return;
  localStorage.setItem(key, "1");

  // ✅ Always use the dynamic getter + your working modal function
  showSystemModal_(
    "Verification complete ✅",
    `
      <div style="line-height:1.5;">
        <p class="muted">Your account is now approved. You can now submit your first team selection.</p>
      </div>
    `, { showActions: false }
  );
}


function showVerifiedModalNow_() {
  showSystemModal_(
    "Verification complete ✅",
    `
      <div style="line-height:1.5;">
        <p style="margin:0 0 10px;"><strong>Your account is now approved.</strong></p>
        <p style="margin:0;">You can now submit your first team selection.</p>
      </div>
    `, { showActions: false }
  );
}

function showConfirmModal_(title, html, { confirmText = "Confirm", cancelText = "Cancel", onConfirm } = {}) {
  if (!modalReady_()) return;

  closeAllModals();

  const titleEl = document.getElementById("systemModalTitle");
  const bodyEl = document.getElementById("systemModalBody");
  const modalEl = document.getElementById("systemModal");
  const actionsEl = document.getElementById("systemModalActions");

  titleEl.textContent = title;
  bodyEl.innerHTML = html;

  if (actionsEl) {
    actionsEl.innerHTML = `
      <button class="btn btn-ghost" type="button" id="sysCancelBtn">${cancelText}</button>
      <button class="btn btn-primary" type="button" id="sysConfirmBtn">${confirmText}</button>
    `;

    document.getElementById("sysCancelBtn")?.addEventListener("click", () => closeModal(modalEl));
    document.getElementById("sysConfirmBtn")?.addEventListener("click", async () => {
      closeModal(modalEl);
      await onConfirm?.();
    });
  }

  openModal(modalEl);
}

function showSystemModal_(title, html, { showActions = true } = {}) {
  const systemModal = document.getElementById("systemModal");
  const titleEl = document.getElementById("systemModalTitle");
  const bodyEl = document.getElementById("systemModalBody");
  const actionsEl = document.getElementById("systemModalActions");

  if (!systemModal || !titleEl || !bodyEl) return;

  closeAllModals?.();

  titleEl.textContent = title || "";
  bodyEl.innerHTML = html || "";
  if (actionsEl) actionsEl.classList.toggle("hidden", !showActions);

  // ✅ Use the same modal system everywhere
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
  const p = getLastResolvedPick?.();

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

  const k = `seen_outcome_sig_session::${String(sessionUser.email).toLowerCase()}`;
  if (sessionStorage.getItem(k) === sig) return false;
  sessionStorage.setItem(k, sig);

  const [gwId, outcome] = sig.split("::");
  const pick = (sessionPicks || []).find(p => p.gwId === gwId);

  if (outcome === "WIN" && pick) { showWinModal_(pick); return true; }
  if (outcome === "LOSS") { showLoseModal_(); return true; }

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


function showPaymentDetailsModal_({ context = "card" } = {}) {
  const isRegister = context === "register";

  showSystemModal_(
    isRegister ? "Account created ✅" : "",
    payInstructionsHtml_(),
    { showActions: true }
  );

  if (!isRegister) {
    const titleEl = document.getElementById("systemModalTitle");
    if (titleEl) titleEl.textContent = "";
  }
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
  const el = document.getElementById("paymentDetailsCard");
  if (!el) return;

  const show = !!sessionUser && !sessionUser.approved;
  el.classList.toggle("hidden", !show);
  if (!show) return;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div>
        <div style="font-weight:900;">Payment details</div>
        <div class="muted small">Tap to view bank transfer info</div>
      </div>
      <div class="state warn">…</div>
    </div>
  `;

  if (!el.dataset.bound) {
    el.dataset.bound = "1";
    el.addEventListener("click", () => showPaymentDetailsModal_({ context: "card" }));
  }
}

function normalizeOutcome_(o) {
  const out = String(o || "").trim().toUpperCase();
  if (out === "WIN" || out === "WON") return "WIN";
  if (out === "LOSS" || out === "LOST" || out === "LOSE") return "LOSS";
  return "PENDING";
}


function outcomeIcon_(o) {
  const out = String(o || "").toUpperCase();
  if (out === "WIN") return { icon: "✓", cls: "good", label: "Won" };
  if (out === "LOSS") return { icon: "✕", cls: "bad", label: "Lost" };
  return { icon: "…", cls: "warn", label: "Pending" };
}

function userStatePill_(user) {
  if (!user) return { label: "—", cls: "muted", icon: "—" };
  if (!user.approved) return { label: "Pending", cls: "warn", icon: "…" };
  if (user.alive === false) return { label: "Dead", cls: "bad", icon: "✕" };
  return { label: "Alive", cls: "good", icon: "✓" };
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
      const resp = await api({ action: "getUserPicks", email: player.email });
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
            ${escapeHtml(gwLabelShort(p.gwId))} - ${teamInlineHtml_(p.team || "—", { size: 16, logoPosition: "before" })}
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
    const data = await api({ action: "getEntries", gwId: gwIdForRank });
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
  const m = String(gwId || "").match(/^GW(\d+)$/i);
  return m ? `GW${Number(m[1])}` : gwId;
}

function gwLabelLong(gwId) {
  const n = gwNumFromId(gwId);
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

  const name = `${sessionUser.firstName || ""} ${sessionUser.lastName || ""}`.trim() || "Player";

  const isPending = !sessionUser.approved;
  const isDead = sessionUser.alive === false;
  const isAlive = !isPending && !isDead;

  // clear all 3, then set the right one
  box.classList.remove("status-alive", "status-dead", "status-pending");
  if (isPending) box.classList.add("status-pending");
  else if (isDead) box.classList.add("status-dead");
  else box.classList.add("status-alive");

  const picksAsc = sortPicksByGw(sessionPicks);
  const curPick = picksAsc.find(p => p.gwId === currentGwId) || null;

  let rowsHtml = "";

  if (!picksAsc.length || !picksAsc.some(p => p.team)) {
    const pendingLine = isPending
      ? "Awaiting approval..."
      : "Make a selection…";

    rowsHtml = `
        <div class="status-row pending">
          <div>${escapeHtml(gwLabelShort(currentGwId))} - ${escapeHtml(pendingLine)}</div>
          <div class="state">…</div>
        </div>
      `;
  } else {
    rowsHtml = picksAsc
      .filter(p => p.team)
      .map(p => {
        const o = String(p.outcome || "PENDING").toUpperCase();
        return `
          <div class="status-row ${rowClass(o)}">
            <div>
              ${escapeHtml(gwLabelShort(p.gwId))} - ${teamInlineHtml_(p.team, { size: 16, logoPosition: "before" })}
            </div>
            <div class="state ${o === "WIN" ? "good" : o === "LOSS" ? "bad" : "warn"}">${stepIcon(o)}</div>
          </div>
        `;
      })
      .join("");

    // Only prompt "make a selection" if approved+alive
    if (!curPick && isAlive) {
      rowsHtml += `
        <div class="status-row neutral">
          <div>${escapeHtml(gwLabelShort(currentGwId))} - Make a selection…</div>
          <div class="state warn">…</div>
        </div>
      `;
    }
  }

  const hasCount = (lastRemainingPlayers != null && lastTotalPlayers != null);
  const countText = hasCount
    ? `${lastRemainingPlayers}/${lastTotalPlayers}`
    : (remainingLoading ? `<span class="dots" aria-label="Loading"></span>` : "—");

  const stateLabel = isPending ? "Pending" : isDead ? "Dead" : "Alive";
  const stateClass = isPending ? "warn" : isDead ? "bad" : "good";
  const stateIcon = isPending ? "…" : isDead ? "✕" : "✓";

  const finishedText =
    (sessionUser?.alive === false && lastMyPlacing && lastMyTotalPlayers)
      ? `Finished: ${lastMyPlacing}${ordinalSuffix_(lastMyPlacing)} of ${lastMyTotalPlayers}`
      : "";

  box.innerHTML = `
    <div class="status-head">
      <div class="status-name">${escapeHtml(name)}</div>
      <div class="status-state">
        <span class="player-status-pill ${isAlive ? "alive" : isDead ? "dead" : ""}">
          <span>${stateLabel}</span>
          <span class="state ${stateClass}">${stateIcon}</span>
        </span>
      </div>
    </div>

    <div class="status-rows">
      ${rowsHtml}
    </div>

    <div class="status-foot status-foot--split">
      <div>Remaining players: ${countText}</div>
      ${finishedText ? `<div class="status-finish">${escapeHtml(finishedText)}</div>` : ``}
  </div>
`;
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
    await api({ action: "clearPick", email: sessionEmail, gwId: currentGwId });

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



function secondsToHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${ hh }:${ mm }:${ ss } `;
}

function startOfWeekFriday(date) {
  const d = new Date(date);
  const day = d.getDay(); // Fri=5
  const diffToFriday = (day - 5 + 7) % 7;
  d.setDate(d.getDate() - diffToFriday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function hideFixturesMessage() {
  const el = document.getElementById("fixturesMsg");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("good", "bad");
}


function toGwId(fridayDate) {
  const y = fridayDate.getFullYear();
  const m = String(fridayDate.getMonth() + 1).padStart(2, "0");
  const da = String(fridayDate.getDate()).padStart(2, "0");
  return `GW - ${ y } -${ m } -${ da } `;
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
}


/*******************************
 * FIXTURES: LOAD + NORMALIZE
 *******************************/
function detectGwId(raw) {
  // 1) Prefer explicit gwId in JSON
  const direct = String(raw.gwId || "").trim();
  if (direct) return direct.toUpperCase(); // "GW1"

  // 2) Try round like "GW1" or "Gameweek 1"
  const round = String(raw.round || "").trim();
  const m = round.match(/GW\s*([0-9]+)/i) || round.match(/Gameweek\s*([0-9]+)/i);
  if (m) return `GW${ Number(m[1]) } `;

  // 3) No gwId available
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
    gwId,
    league: leagueName,
    kickoff,
    kickoffHasTime: !!hasTime,
    home: String(home),
    away: String(away),
    round: raw.round || ""
  };
}

async function loadAllFixtures() {
  const loaded = [];
  const errors = [];

  for (const source of FIXTURE_SOURCES) {
    try {
      const res = await fetch(source.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${ source.url } returned ${ res.status } `);

      const data = await res.json();
      const arr = Array.isArray(data.matches) ? data.matches : null;
      if (!arr) throw new Error(`${ source.url } has no matches array`);

      for (const item of arr) {
        const n = normalizeFixture(item, source.league);
        if (n) loaded.push(n);
      }
    } catch (e) {
      errors.push(`${ source.league }: ${ e.message || e } `);
    }
  }

  // 1) Filter + sort fixtures FIRST
  fixtures = loaded
    .filter(f => f.kickoff >= GAME_START_DATE)
    .sort((a, b) => a.kickoff - b.kickoff);

  // 2) Build gameweeks from fixtures
  gameweeks = buildGameweeks(fixtures);

  // 3) Apply manual deadlines AFTER gameweeks exist
  const deadlineMap = await loadDeadlines();
  if (deadlineMap.size) {
    gameweeks = gameweeks.map(gw => {
      const iso = deadlineMap.get(String(gw.id).toUpperCase());
      if (!iso) return gw;

      const manual = new Date(iso);
      if (isNaN(manual.getTime())) return gw;

      return { ...gw, deadline: manual };
    });
  }

  // 4) UI message
  if (!fixtures.length) {
    const msg = errors.length
      ? `No fixtures loaded.\n\n${ errors.join("\n") } `
      : "No fixtures loaded. Check your JSON files/paths.";
    showFixturesMessage(msg, "bad");
  } else {
    if (fixturesMsg) fixturesMsg.classList.add("hidden");
  }
}


function findGwIndexById(gwId) {
  return gameweeks.findIndex(g => g.id === gwId);
}

function getNextGwId(afterGwId) {
  const idx = findGwIndexById(afterGwId);
  if (idx < 0) return null;
  return gameweeks[idx + 1]?.id || null;
}

function computeCurrentGwId() {
  if (!gameweeks.length) return null;

  // If eliminated, currentGwId can stay at last played (you can show eliminated UI)
  if (sessionUser && sessionUser.alive === false) {
    // try to show the gw they were knocked out in, else last pick
    if (sessionUser.knockedOutGw) return sessionUser.knockedOutGw;
    const lastPick = sessionPicks[sessionPicks.length - 1];
    return lastPick?.gwId || gameweeks[0].id;
  }

  // Get picks sorted by GW index
  const picksSorted = [...sessionPicks].sort((a, b) => findGwIndexById(a.gwId) - findGwIndexById(b.gwId));
  const lastPick = picksSorted.length ? picksSorted[picksSorted.length - 1] : null;


  if (!lastPick) {
    // No picks yet -> next upcoming GW by deadline
    const n = now();
    return (gameweeks.find(g => g.deadline > n) || gameweeks[0]).id;
  }

  // If last pick is LOSS => eliminated (handled above)
  if (lastPick.outcome === "LOSS") return lastPick.gwId;

  // If last pick is WIN => move to next gw (if exists), else stay
  if (lastPick.outcome === "WIN") {
    return getNextGwId(lastPick.gwId) || lastPick.gwId;
  }

  // Otherwise pending: remain on the GW they picked
  return lastPick.gwId;
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

function buildGameweeks(fixturesArr) {
  const map = new Map();

  for (const f of fixturesArr) {
    if (!map.has(f.gwId)) map.set(f.gwId, { id: f.gwId, fixtures: [] });
    map.get(f.gwId).fixtures.push(f);
  }

  const gws = Array.from(map.values()).map(gw => {
    gw.fixtures.sort((a, b) => a.kickoff - b.kickoff);

    const firstKickoff = gw.fixtures[0].kickoff;
    const start = startOfDay(firstKickoff);

    const deadline = new Date(firstKickoff.getTime() - DEADLINE_HOURS_BEFORE_FIRST_FIXTURE * 3600 * 1000);

    const num = gwNumFromId(gw.id);

    return {
      ...gw,
      num: num ?? gw.id, // fallback if someone uses GW-A etc
      start,
      firstKickoff,
      deadline
    };
  });

  // sort by numeric GW where possible, else by date
  gws.sort((a, b) => {
    const an = typeof a.num === "number" ? a.num : 999999;
    const bn = typeof b.num === "number" ? b.num : 999999;
    if (an !== bn) return an - bn;
    return a.start - b.start;
  });

  return gws;
}

async function loadDeadlines() {
  const res = await fetch("gameweek-deadlines.json", { cache: "no-store" });
  if (!res.ok) return new Map();

  const data = await res.json();
  const map = new Map();

  for (const d of (data.deadlines || [])) {
    const gwId = String(d.gwId || "").trim().toUpperCase();
    const date = String(d.date || "").trim();       // "2026-01-31"
    const time = String(d.deadline || "").trim();   // "14:00"
    if (!gwId || !date || !time) continue;

    // Treat as UTC, consistent with your fixture parsing that also uses "Z"
    map.set(gwId, `${ date }T${ time }:00Z`);
  }

  return map;
}



/*******************************
 * DATA: LOAD USER PROFILE FROM API
 *******************************/
async function refreshProfile() {
  if (!sessionEmail) return;

  const data = await api({ action: "getProfile", email: sessionEmail });
  sessionUser = data.user;
  sessionUser.approved = isApproved_(sessionUser);
  sessionPicks = Array.isArray(data.picks) ? data.picks : [];

  // normalize outcomes + ids
  sessionPicks = sessionPicks.map(p => ({
    ...p,
    gwId: String(p.gwId || "").toUpperCase(),
    outcome: normalizeOutcome_(p.outcome)
  }));

  usedTeams = new Set(sessionPicks.filter(p => p.outcome === "WIN").map(p => p.team));
}







function startDeadlineTimer() {
  if (deadlineInterval) clearInterval(deadlineInterval);

  const timeLeftText = document.getElementById("timeLeftText");

  const tick = () => {
    const gw = gameweeks.find(g => g.id === currentGwId);
    if (!gw) return;

    const diffMs = gw.deadline.getTime() - Date.now();
    const locked = diffMs <= 0;

    if (timeLeftText) {
      if (locked) {
        const gw = gameweeks.find(g => g.id === currentGwId);
        const gwNum = gw?.num ?? gwLabelShort(currentGwId).replace(/^GW/i, "");
        timeLeftText.textContent = `Submissions closed`;
        timeLeftText.classList.remove("good");
      } else {

        timeLeftText.textContent = formatTimeLeft(diffMs);
        timeLeftText.classList.remove("good");
      }
    }

    if (submitPickBtn) submitPickBtn.disabled = locked || !sessionUser?.approved;
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

    for (const leagueName of ["Premier League", "Championship", "League One", "League Two"]) {
      const list = leagueMap.get(leagueName);
      if (!list || !list.length) continue;

      const details = document.createElement("details");
      details.className = "league-details";
      details.open = false; // ✅ start collapsed

      const summary = document.createElement("summary");
      summary.className = "league-summary";
      summary.textContent = `${ leagueName } (${ list.length })`;
      details.appendChild(summary);


      const container = document.createElement("div");
      container.className = "league-group";

      for (const f of list.sort((a, b) => a.kickoff - b.kickoff)) {
        const row = document.createElement("div");
        row.className = "fixture-row";

        const timeHtml = f.kickoffHasTime
          ? `<div class="fixture-time muted" > ${ formatTimeUK(f.kickoff) }</div > `
          : "";

        const dateLine = f.kickoffHasTime
          ? `${ escapeHtml(formatDateUK(f.kickoff)) } · ${ escapeHtml(formatTimeUK(f.kickoff)) } `
          : `${ escapeHtml(formatDateUK(f.kickoff)) } `;

        row.innerHTML = `
  <div class="fixture-main" >
    ${ fixtureTeamsHtml_(f.home, f.away) }
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
function parseGwDate(gwId) {
  // expects GW-YYYY-MM-DD
  const m = String(gwId || "").match(/^GW-(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(`${ m[1] } -${ m[2] } -${ m[3] } T00:00:00`);
}

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
    const data = await api({ action: "getEntries", gwId: gwIdForEntries });

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
        const koLine = `${ u.knockedOutGw || "—" } - ${ u.knockedOutTeam || "—" } `;
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
    aliveList.innerHTML = leftHtml || `<div class="muted" > ${ started ? "No alive players." : "No approved players." }</div > `;
    outList.innerHTML = rightHtml || `<div class="muted" > ${ started ? "No knocked out players." : "No pending approvals." }</div > `;

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




function renderPickCardState() {
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
 * RENDER: PROFILE TAB
 *******************************/
function renderProfileTab() {
  if (!sessionUser) return;

  profileName.textContent = `${ sessionUser.firstName } ${ sessionUser.lastName } `;
  profileMeta.textContent = `${ sessionUser.email } • ${ sessionUser.clubTeam } • ${ sessionUser.phone } `;

  profileStatus.textContent = sessionUser.alive
    ? `Status: Still Alive`
    : `Status: Knocked Out(${ sessionUser.knockedOutGw || "—" })`;

  profileSelections.innerHTML = "";

  if (!sessionPicks.length) {
    profileSelections.innerHTML = `<div class="sel-card" > <div class="muted">No selections yet.</div></div > `;
    return;
  }

  for (const p of sessionPicks) {
    const outcome = p.outcome || "PENDING";
    const icon = outcome === "WIN" ? "✓" : outcome === "LOSS" ? "✕" : "…";
    const cls = outcome === "WIN" ? "good" : outcome === "LOSS" ? "bad" : "warn";

    let line = "Result: Pending";
    if (p.fixture) {
      line = `${ p.fixture.team1 } ${ p.fixture.score1 } vs ${ p.fixture.score2 } ${ p.fixture.team2 } `;
    }

    const div = document.createElement("div");
    div.className = "sel-card";
    div.innerHTML = `
  <div class="sel-top" >
        <div class="sel-gw">${escapeHtml(p.gwId)}</div>
        <div class="sel-pick">${escapeHtml(p.team)} <span class="state ${cls}">${icon}</span></div>
      </div >
  <div class="sel-meta">${escapeHtml(line)}</div>
`;
    profileSelections.appendChild(div);
  }
}

/*******************************
 * PICK SUBMISSION
 *******************************/
async function savePick(team) {
  const gwId = currentGwId;
  const gw = gameweeks.find(g => g.id === gwId);
  if (!gw) return;

  if (!sessionUser?.approved) {
    showFixturesMessage("You are not approved yet. Please pay entry fee and wait for approval.", "bad");
    return;
  }
  if (now() >= gw.deadline) {
    showFixturesMessage("Deadline has passed for this gameweek.", "bad");
    return;
  }

  setBtnLoading(submitPickBtn, true);

  try {
    await api({ action: "submitPick", email: sessionEmail, gwId, team });

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
      `${ gwLabelShort(gwId) } selection confirmed: `,
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
  // ----- DEAD UI (global “out” state) -----
  if (isDeadUi_()) {
    renderWinBox(); // hides itself when dead
    renderLossBoxAndHidePickCard();
    return;
  }

  // Always update header/pill
  setGwLabelFromSelected();
  renderStatusPill();

  // If user is mid-edit flow, force input mode (but still respect locked later)
  if (isEditingCurrentPick) {
    const pickModeInput = document.getElementById("pickModeInput");
    const pickModeSubmitted = document.getElementById("pickModeSubmitted");
    pickModeSubmitted?.classList.add("hidden");
    pickModeInput?.classList.remove("hidden");
    return;
  }

  // DEAD: show loss container only + hide pick card
  if (sessionUser?.alive === false) {
    renderWinBox(); // will hide itself when dead
    renderLossBoxAndHidePickCard();
    return;
  }

  // ALIVE: normal UI
  showPickCardAndHideLossBox();
  renderWinBox();

  // ----- CURRENT GW CONTEXT -----
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

  // ✅ Always define these so they exist in every branch
  const team = String(pick?.team || "").trim();
  const outcome = String(pick?.outcome || "PENDING").toUpperCase();
  const hasPick = !!team;

  // ✅ Deterministic view toggles (fixes “input still showing after submit”)
  // Input should show only if NOT locked AND no pick exists
  pickModeInput?.classList.toggle("hidden", locked || hasPick);
  // Submitted panel shows only if a pick exists
  pickModeSubmitted?.classList.toggle("hidden", !hasPick);

  // ----- LOCKED (deadline hit): no input, no edit, show in-progress if pick exists -----
  if (locked) {
    // hide pencil entirely
    editPickBtn?.classList.add("hidden");
    // disable submit
    if (submitPickBtn) submitPickBtn.disabled = true;

    // If they have a pick, show “In progress” (as requested)
    if (hasPick) {
      if (gwPickTitle) {
        gwPickTitle.innerHTML = `
  <span class="pick-title-inline" >
    ${ teamInlineHtml_(team, { size: 20 }) }
            <span class="dash">—</span>
            <span class="muted">In progress</span>
          </span >
  `;
      }

      if (gwPickIcon) {
        gwPickIcon.textContent = "…";
        gwPickIcon.className = "state warn";
      }

      // Match info (still useful after lock)
      const fx = findFixtureForTeam(curGw, team);
      if (submittedMeta) {
        if (fx) {
          const when = fx.kickoffHasTime ? formatKickoffLineUK(fx.kickoff) : formatDateUK(fx.kickoff);
          submittedMeta.innerHTML = `
  <div class="fixture-main fixture-main--compact" >
    ${ fixtureTeamsHtml_(fx.home, fx.away) }
<div class="fixture-datetime muted">${escapeHtml(when)}</div>
            </div >
  `;
        } else {
          submittedMeta.textContent = "Match not found for this gameweek";
        }
      }
    } else {
      // No pick and locked: clear submitted meta
      if (submittedMeta) submittedMeta.textContent = "";
    }

    return;
  }

  // ----- UNLOCKED (before deadline): edit may be available -----
  editPickBtn?.classList.remove("hidden");

  // No pick yet -> input mode only
  if (!hasPick) {
    if (editPickBtn) editPickBtn.disabled = true;
    if (submittedMeta) submittedMeta.textContent = "";
    return;
  }

  // Has pick: submitted view
  // Default edit rule
  if (editPickBtn) {
    editPickBtn.disabled = !sessionUser?.approved || sessionUser?.alive === false || outcome !== "PENDING";
  }

  // Copy rules:
  // - Before deadline: DO NOT show “- In progress” for pending
  // - Keep “Won/Lost” if resolved (shouldn’t happen while alive+picking, but safe)
  if (outcome === "WIN") {
    if (gwPickTitle) gwPickTitle.textContent = `${ gwLabelShort(pick.gwId) } - ${ team } - Won`;
    if (gwPickIcon) {
      gwPickIcon.textContent = "✓";
      gwPickIcon.className = "state good";
    }
    if (editPickBtn) editPickBtn.disabled = true;
  } else if (outcome === "LOSS") {
    if (gwPickTitle) gwPickTitle.textContent = `${ gwLabelShort(pick.gwId) } - ${ team } - Lost`;
    if (gwPickIcon) {
      gwPickIcon.textContent = "✕";
      gwPickIcon.className = "state bad";
    }
    if (submittedMeta) submittedMeta.innerHTML = `<div class="muted" > <strong>Lost — you are out!</strong></div > `;
    if (editPickBtn) editPickBtn.disabled = true;
    if (submitPickBtn) submitPickBtn.disabled = true;
    return;
  } else {
    // PENDING + unlocked: “Selection confirmed: …” (no “In progress”)
    if (gwPickTitle) {
      gwPickTitle.innerHTML = `
  <span class="pick-title-inline" >
    ${ teamInlineHtml_(team, { size: 20 }) }
        </span >
  `;
    }

    if (gwPickIcon) {
      gwPickIcon.textContent = "✓";
      gwPickIcon.className = "state good";
    }
  }

  // Match info (works both pending/resolved)
  const fx = findFixtureForTeam(curGw, team);
  if (submittedMeta) {
    if (fx) {
      const when = fx.kickoffHasTime ? formatKickoffLineUK(fx.kickoff) : formatDateUK(fx.kickoff);
      const whenLine = fx.kickoffHasTime
        ? `${ formatDateUK(fx.kickoff) } · ${ formatTimeUK(fx.kickoff) } `
        : `${ formatDateUK(fx.kickoff) } `;

      submittedMeta.innerHTML = `
  <div class="fixture-row" >
    <div class="fixture-main">
      ${fixtureTeamsHtml_(fx.home, fx.away, { highlightTeam: team })}
      <div class="fixture-datetime muted">${escapeHtml(whenLine)}</div>
    </div>
        </div >
  `;

    } else {
      submittedMeta.textContent = "Match not found for this gameweek";
    }
  }
  renderGwReportCard_();
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

function renderGwResultBanner() {
  const el = document.getElementById("gwResultBanner");
  if (!el) return;

  const p = getLastResolvedPick();
  if (!p) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }

  const outcome = (p.outcome || "").toUpperCase();
  const isWin = outcome === "WIN";

  el.classList.remove("hidden");
  el.classList.toggle("win", isWin);
  el.classList.toggle("loss", !isWin);

  el.innerHTML = `
  <div class="result-left" >
    <div class="result-title"><strong>${escapeHtml(gwLabelShort(p.gwId))} - ${escapeHtml(p.team)} - ${isWin ? "Won" : "Lost"}</strong></div>
    </div >
  <div class="state ${isWin ? " good" : "bad"}" > ${ isWin ? "✓" : "✕" }</div >
    `;
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
    <div > <strong>${escapeHtml(gwLabelShort(p.gwId))} - ${escapeHtml(p.team)} - Won</strong></div >
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

function renderResultsBox() {
  const box = document.getElementById("resultsBox");
  if (!box) return;

  const picksAsc = sortPicksByGwAsc(sessionPicks);
  const curPick = picksAsc.find(p => p.gwId === currentGwId) || null;

  // Build timeline pills from picks (only those with a team)
  const stepsHtml = picksAsc
    .filter(p => p.team)
    .map(p => {
      const o = String(p.outcome || "PENDING").toUpperCase();
      const label = `${ gwLabelShort(p.gwId) } ${ stepIcon(o) } `;
      return `<span class="step-pill ${stepClass(o)}" > ${ escapeHtml(label) }</span > `;
    })
    .join("");

  // Title logic
  let title = "Make your first selection";
  let meta = "";
  let showPencil = false;

  if (sessionUser?.alive === false) {
    // dead: show last known KO info if available
    const last = picksAsc[picksAsc.length - 1];
    const koGw = sessionUser.knockedOutGw || last?.gwId || "—";
    const koTeam = sessionUser.knockedOutTeam || last?.team || "—";
    title = `${ gwLabelShort(koGw) } - ${ koTeam } - Lost`;
  } else if (curPick?.team) {
    const label = formatOutcomeLabel(curPick.outcome);
    title = `${ gwLabelShort(curPick.gwId) } - ${ curPick.team } - ${ label } `;

    const out = String(curPick.outcome || "PENDING").toUpperCase();
    // allow edit only if pending + not locked
    if (out === "PENDING" && !currentGwLocked()) showPencil = true;
  }

  // If dead we’ll add position when we have it
  box.innerHTML = `
  <div class="results-left" >
    <div class="results-title">${escapeHtml(title)}</div>
      ${ stepsHtml ? `<div class="results-steps">${stepsHtml}</div>` : `` }
      ${ meta ? `<div class="results-meta">${escapeHtml(meta)}</div>` : `` }
<div id="finishLine" class="results-meta"></div>
    </div >
  <div class="results-actions">
    ${showPencil ? `<button id="resultsEditBtn" class="icon-btn" type="button" title="Edit pick">✏️</button>` : ``}
  </div>
`;

  // bind edit
  const editBtn = document.getElementById("resultsEditBtn");
  if (editBtn) editBtn.addEventListener("click", openPickEditor);
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

      const openedOutcomeModal = applyOutcomeEffects_({ allowModal: true });

      // ✅ If an outcome modal opened, don’t open other modals this tick
      if (!openedOutcomeModal) {
        handleAccountStateChange_();
      }

      // ✅ Move gameweek if needed (e.g. after a WIN)
      const nextCurrent = computeCurrentGwId();
      if (nextCurrent && nextCurrent !== currentGwId) {
        currentGwId = nextCurrent;
        viewingGwId = currentGwId;

        resetPickInputUi_();
        renderGameweekSelect();
        syncViewingToCurrent();
      }

      renderTopUIOnly();

      renderPaymentDetailsCard_();   // show/hide payment details card
      startDeadlineTimer();

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



function renderLastWinBox() {
  const box = document.getElementById("lastWinBox");
  if (!box) return;

  // find latest WIN pick
  const wins = sessionPicks.filter(p => p.outcome === "WIN");
  if (!wins.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  wins.sort((a, b) => findGwIndexById(b.gwId) - findGwIndexById(a.gwId));
  const last = wins[0];

  box.innerHTML = `
  <div > ${ escapeHtml(last.gwId) } - ${ escapeHtml(last.team) }</div >
    <div class="state good">✓</div>
`;
  box.classList.remove("hidden");
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
          <p style="margin:0 0 10px;"><strong>Thank you for registering.</strong></p>
          <p style="margin:0 0 10px;">However, the game is now closed to new entries.</p>
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

    setSession(emailLower);
    await initDataAndRender_();
    enterApp_();

    setTimeout(() => {
      showPaymentDetailsModal_({ context: "register" });
    }, 0);

    localStorage.removeItem(`lms_verified_seen::${ emailLower } `);
    sessionStorage.removeItem(`session_seen_verified::${ emailLower } `);

    showAuthMessage("Registered! Now pay £10 — your entry will be approved after payment.", "good");
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

    setSession(data.user.email);
    sessionUser = data.user;

    await initDataAndRender_();
    enterApp_();
  } catch (err) {
    showAuthMessage(String(err.message || err), "bad");
  } finally {
    setBtnLoading(loginBtn, false);
  }
});

function renderStatusPill() {
  const el = document.getElementById("statusPill");
  if (!el || !sessionUser) return;

  // assumes you have CSS classes: good, bad, warn
  el.classList.remove("good", "bad", "warn");

  const isPending = !sessionUser.approved;
  const isDead = !isPending && sessionUser.alive === false;
  const isAlive = !isPending && !isDead;

  if (isPending) {
    el.textContent = "Pending";
    el.classList.add("warn");
  } else if (isDead) {
    el.textContent = "Dead";
    el.classList.add("bad");
  } else if (isAlive) {
    el.textContent = "Alive";
    el.classList.add("good");
  }
}

function setBtnLoadingKeepHtml(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add("btn-loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("btn-loading");
    btn.disabled = false;
  }
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
  if (body && sessionUser) {

    const statusLabel = !sessionUser.approved
      ? "Pending"
      : (sessionUser.alive ? "Alive" : "Dead");

    const statusCls = !sessionUser.approved
      ? "warn"
      : (sessionUser.alive ? "good" : "bad");

    const statusIcon = !sessionUser.approved
      ? "…"
      : (sessionUser.alive ? "✓" : "✕");

    body.innerHTML = `
  <div style = "display:flex;justify-content:space-between;gap:6px;align-items:flex-start;" >

      </div >

  <div style="margin-top:12px" class="fixtures-card">
    <div class="muted small"><strong>Name</strong></div>
    <div style="margin:4px 0px;">${escapeHtml(sessionUser.firstName)} ${escapeHtml(sessionUser.lastName)}</div>

    <div style="margin-top:10px" class="muted small"><strong>Email</strong></div>
    <div style="margin-top:4px;">${escapeHtml(sessionUser.email || "")}</div>

    <div style="margin-top:10px" class="muted small"><strong>Phone</strong></div>
    <div style="margin-top:4px;">${escapeHtml(sessionUser.phone || "—")}</div>

    <div style="margin-top:10px" class="muted small"><strong>Team / Connection</strong></div>
    <div style="margin-top:4px;">${escapeHtml(sessionUser.clubTeam || "—")}</div>
  </div>
`;
  }
  openModal(profileModal);
});


document.getElementById("infoBtn")?.addEventListener("click", () => {
  openModal(infoModal);
});

function getAccountLabel_(user) {
  if (!user) return "—";
  if (!user.approved) return "Pending";
  return user.alive ? "Alive" : "Dead";
}

function getAccountStateClass_(user) {
  if (!user) return "state muted";
  if (!user.approved) return "state warn"; // orange-ish
  return user.alive ? "state good" : "state bad";
}


function formatTimeLeft(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const plural = (n, word) => `${ n } ${ word }${ n === 1 ? "" : "s" } `;

  // Days away -> "X days Y hours"
  if (days > 0) return `${ plural(days, "day") } ${ plural(hours, "hour") } `;

  // Hours away -> "X hours Y minutes"
  if (hours > 0) return `${ plural(hours, "hour") } ${ plural(mins, "minute") } `;

  // Minutes away -> "X minutes Y seconds"
  if (mins > 0) return `${ plural(mins, "minute") } ${ plural(secs, "second") } `;

  // Seconds only -> "X seconds"
  return `${ plural(secs, "second") } `;
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


function doLogout() {
  clearSession();
  exitApp_();
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

  const existing = getPickForGw(currentGwId); // ✅

  if (usedTeams.has(match) && existing?.team !== match) {
    return showFixturesMessage("You already used that team in a previous gameweek.", "bad");
  }
  savePick(match);
});


/*******************************
 * APP START/STOP
 *******************************/
function enterApp_() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  logoutBtnOuter?.classList.add("hidden");
  logoutBtnApp?.classList.remove("hidden");

  setTab2("selection");
renderGwReportCard_(); // ✅ immediate render on first load
startProfilePolling();
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
    opt.textContent = `${ gw.id } (${ formatDateUK(gw.start) })`;
    gameweekSelect.appendChild(opt);
  }

  // If viewing not set, default to current
  if (!viewingGwId) viewingGwId = currentGwId;

  // If viewing is not a real option (e.g. data changed), fallback
  const ok = gameweeks.some(g => g.id === viewingGwId);
  if (!ok) viewingGwId = gameweeks[0].id;

  gameweekSelect.value = viewingGwId;
}

async function initDataAndRender_({ allowOutcomeModal = true } = {}) {
  try {
    await loadTeamLogosOnce_();
  } catch (e) {
    console.warn("Team logos failed to load:", e);
  }
  // 1) Fixtures + gameweeks
  await loadAllFixtures();
  if (!gameweeks.length) {
    if (fixturesList) fixturesList.innerHTML = "";
    return;
  }

  // 2) Profile
  await refreshProfile();

  // Track approval transition state for polling
  lastApprovedState = !!sessionUser?.approved;

  // 3) Compute current + viewing
  currentGwId = computeCurrentGwId();
  if (!currentGwId || !gameweeks.some(g => g.id === currentGwId)) {
    currentGwId = gameweeks[0].id;
  }

  viewingGwId = currentGwId;
  if (!viewingGwId || !gameweeks.some(g => g.id === viewingGwId)) {
    viewingGwId = gameweeks[0].id;
  }

  // 4) Render dropdown + sync
  renderGameweekSelect();
  syncViewingToCurrent();

  // 5) Render main UI (fast)
  renderFixturesTab();          // this already calls renderCurrentPickBlock/status/pick state
  renderPaymentDetailsCard_();  // show "Payment details" card if pending
  startDeadlineTimer();
  updateTeamDatalist();

  // 6) Async counts (non-blocking)
  refreshRemainingPlayersCount();

  // 7) One-time modals (never spam)
  // - registration: only shown after register submit flow (you already do that)
  // - verified: show once ever per account/device
  showVerifiedModalOnce_();

  // 8) Outcome effects (UI then modal once per resolved sig per session)
  applyOutcomeEffects_({ allowModal: !!allowOutcomeModal });
}


(async function boot() {
  // Start hidden until we decide where to go
  authView.classList.add("hidden");
  appView.classList.add("hidden");

  const sess = getSession();

  // No saved login -> show auth immediately, no splash
  if (!sess?.email) {
    showSplash(false);
    exitApp_();
    return;
  }

  // Saved login -> show splash while we load
  showSplash(true);

  try {
    sessionEmail = sess.email;

    await initDataAndRender_();

    enterApp_();

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

