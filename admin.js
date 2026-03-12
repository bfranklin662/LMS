// admin.js

const API_URL = "https://lms-api.nick-horne123.workers.dev";
const LS_ADMIN_KEY = "lms_admin_key";


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

let bulkResolveOnConfirm = null;

function openBulkResolveModal({ title, html, onConfirm }) {
  if (!bulkResolveModal) return;

  if (bulkResolveModalTitle) bulkResolveModalTitle.textContent = title || "Confirm";
  if (bulkResolveModalBody) bulkResolveModalBody.innerHTML = html || "";
  bulkResolveOnConfirm = onConfirm || null;

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

bulkResolveCancelBtn?.addEventListener("click", closeBulkResolveModal);

bulkResolveConfirmBtn?.addEventListener("click", async () => {
  const fn = bulkResolveOnConfirm;
  if (!fn) return;
  closeBulkResolveModal();
  await fn();
});

bulkResolveModal?.addEventListener("click", (e) => {
  if (e.target === bulkResolveModal) closeBulkResolveModal();
});

function ensureResolvedList_() {
  let list = document.getElementById("resolvedSubmissionsList");
  if (list) return list;

  const resolvedCard = Array.from(subsContainer.querySelectorAll(".fixtures-card"))
    .find(card => card.querySelector("h3")?.textContent?.trim() === "Resolved");

  if (!resolvedCard) return null;

  list = document.createElement("div");
  list.id = "resolvedSubmissionsList";
  list.className = "list";
  resolvedCard.appendChild(list);
  return list;
}

function removeEmptyPendingGroups_() {
  subsContainer.querySelectorAll("[data-pending-day-group='1']").forEach(group => {
    const list = group.querySelector(".list");
    if (!list || !list.children.length) {
      group.remove();
    }
  });
}

function updateSubmissionSummaryCounts_() {
  let pending = 0;
  let resolved = 0;

  for (const v of seenSubs.values()) {
    if (v.isResolved) resolved++;
    else pending++;
  }

  if (subsPendingCount) subsPendingCount.textContent = "";
  if (subsResolvedCount) subsResolvedCount.textContent = "";

  const game = adminGames.find(g => String(g.id) === String(selectedGameId));
  const gameLabel = game?.title || selectedGameId;

  if (subsMeta) {
    subsMeta.textContent = `${gameLabel} • Pending: ${pending} • Resolved: ${resolved} • Total: ${pending + resolved}`;
  }
}



/*******************************
 * STATE
 *******************************/
let adminKey = "";

const seenSubs = new Map();   // key -> { outcome, el, gwId, isResolved }

let selectedGameId = "";
let adminGames = [];

const FIXTURE_SOURCES = [
  { league: "Premier League", url: "premier-league.json" },
  { league: "Championship", url: "championship.json" },
  { league: "League One", url: "league-one.json" },
  { league: "League Two", url: "league-two.json" },
];

let adminFixtures = [];

/*******************************
 * Tabs
 *******************************/
async function setTab(name) {
  tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  approvalsPanel?.classList.toggle("hidden", name !== "approvals");
  subsPanel?.classList.toggle("hidden", name !== "submissions");

  if (name === "approvals") {
    try {
      await loadApprovals();
    } catch (e) {
      showMsg(String(e.message || e), false);
    }
  }

  if (name === "submissions") {
    try {
      submissionsLoadedOnce = true;
      await refreshSubmissionsIncremental({ full: true });
    } catch (e) {
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

/*******************************
 * Submissions helpers
 *******************************/


function getResolvedFixtureGroupRows_(rowData, outcome) {
  const gwKey = String(rowData.gwId || "").toUpperCase();
  const pickKey = normTeamKey_(rowData.pick || "");
  const wantedOutcome = String(outcome || "").toUpperCase();

  return Array.from(seenSubs.values())
    .filter(v => {
      if (!v?.rowData) return false;
      if (!v.isResolved) return false;

      const r = v.rowData;
      const sameGw = String(r.gwId || "").toUpperCase() === gwKey;
      const samePick = normTeamKey_(r.pick || "") === pickKey;
      const sameOutcome = String(v.outcome || "").toUpperCase() === wantedOutcome;

      const a = findFixtureForPick_(r.gwId, r.pick);
      const b = findFixtureForPick_(rowData.gwId, rowData.pick);

      const sameFixture =
        (!!a && !!b &&
          normTeamKey_(a.home) === normTeamKey_(b.home) &&
          normTeamKey_(a.away) === normTeamKey_(b.away)) ||
        (!a && !b);

      return sameGw && samePick && sameOutcome && sameFixture;
    })
    .map(v => v.rowData);
}

function ensurePendingWrap_() {
  let pendingWrap = document.getElementById("pendingSubmissionsWrap");
  if (pendingWrap) return pendingWrap;

  pendingWrap = document.createElement("div");
  pendingWrap.className = "fixtures-card";
  pendingWrap.style.marginBottom = "12px";
  pendingWrap.id = "pendingSubmissionsWrap";

  const pendingTitle = document.createElement("h3");
  pendingTitle.style.marginTop = "0";
  pendingTitle.textContent = "Pending submissions";
  pendingWrap.appendChild(pendingTitle);

  subsContainer.prepend(pendingWrap);
  return pendingWrap;
}

function ensurePendingDayGroup_(dayKey, dayLabel) {
  const pendingWrap = ensurePendingWrap_();

  let dayGroup = pendingWrap.querySelector(`[data-day-key="${CSS.escape(dayKey)}"]`);
  if (dayGroup) return dayGroup;

  dayGroup = document.createElement("div");
  dayGroup.setAttribute("data-pending-day-group", "1");
  dayGroup.setAttribute("data-day-key", dayKey);

  const dayTitle = document.createElement("div");
  dayTitle.className = "muted small";
  dayTitle.style.margin = "14px 0 8px";
  dayTitle.innerHTML = `<strong>${escapeHtml(dayLabel)}</strong>`;
  dayGroup.appendChild(dayTitle);

  // insert in date order
  const existingGroups = Array.from(pendingWrap.querySelectorAll('[data-pending-day-group="1"]'));
  let inserted = false;

  for (const existing of existingGroups) {
    const existingKey = existing.getAttribute("data-day-key") || "";
    if (dayKey < existingKey) {
      pendingWrap.appendChild(dayGroup);
      inserted = true;
      break;
    }
    if (dayKey > existingKey) {
      pendingWrap.insertBefore(dayGroup, existing);
      inserted = true;
      break;
    }
  }

  if (!inserted) pendingWrap.appendChild(dayGroup);

  return dayGroup;
}

function ensurePendingFixtureBlockForRows_(rows) {
  if (!rows?.length) return null;

  const first = rows[0];
  const dayGroup = ensurePendingDayGroup_(first.dayKey, first.dayLabel);
  const fixtureGroupKey = getPendingFixtureGroupKey_(first);

  let existingBlock = dayGroup.querySelector(`[data-fixture-group-key="${CSS.escape(fixtureGroupKey)}"]`);
  if (existingBlock) return existingBlock;

  const block = renderPendingFixtureBlock_(rows);
  block.setAttribute("data-fixture-group-key", fixtureGroupKey);

  // insert by kickoff within the day
  const existingBlocks = Array.from(dayGroup.querySelectorAll('[data-pending-fixture-block="1"]'));
  let inserted = false;

  for (const existing of existingBlocks) {
    const existingKey = existing.getAttribute("data-fixture-group-key") || "";
    if (fixtureGroupKey < existingKey) {
      dayGroup.appendChild(block);
      inserted = true;
      break;
    }
    if (fixtureGroupKey > existingKey) {
      dayGroup.insertBefore(block, existing);
      inserted = true;
      break;
    }
  }

  if (!inserted) dayGroup.appendChild(block);

  return block;
}


const DEFAULT_TEAM_LOGO = "images/team-default.png";
const TEAM_LOGOS_URL = "team-logos.json";
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
      .map(x => [normTeamKeyLogo_(x.team), String(x.logo)])
  );
}

function getTeamLogo_(teamName) {
  const key = normTeamKeyLogo_(teamName);
  return TEAM_LOGO_MAP.get(key) || DEFAULT_TEAM_LOGO;
}

function normTeamKey_(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseKickoffUK(dateStr, timeStr) {
  const t = (timeStr && String(timeStr).trim()) ? String(timeStr).trim() : null;
  const iso = t ? `${dateStr}T${t}:00Z` : `${dateStr}T12:00:00Z`;
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
  };
}

async function loadAdminFixtures_() {
  const loaded = [];

  for (const source of FIXTURE_SOURCES) {
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
  const res = await fetch("gameweek-deadlines.json", { cache: "no-store" });
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


function isResolved(outcome) {
  const o = String(outcome || "PENDING").toUpperCase();
  return o === "WIN" || o === "LOSS";
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

function applyResolvedStateToRow_(targetRow, newOutcome) {
  const key = makeSubKey(targetRow, targetRow.gwId);
  const cached = seenSubs.get(key);
  if (!cached || !cached.el) return;

  cached.outcome = newOutcome;
  cached.isResolved = true;

  if (cached.rowData) {
    cached.rowData.outcome = newOutcome;
  }

  applyOutcomeStyles(cached.el, newOutcome);

  const controls = cached.el.querySelector(".admin-controls");
  if (controls) {
    controls.innerHTML = `
      <div class="admin-submission-actions">
        <span class="state ${newOutcome === "WIN" ? "good" : "bad"}">${newOutcome === "WIN" ? "✓" : "✕"}</span>
        <button class="btn btn-ghost" data-unresolve="1" type="button">Unresolve</button>
      </div>
    `;
  }

  const resolvedList = ensureResolvedList_();
  if (resolvedList) {
    resolvedList.prepend(cached.el);
  }

  bindResolvedRowEvents_(cached.el, targetRow, newOutcome);
}

function bindResolvedRowEvents_(rowEl, rowData, currentOutcome) {
  const unresolveBtn = rowEl.querySelector('button[data-edit="1"], button[data-unresolve="1"]');
  if (!unresolveBtn) return;

  unresolveBtn.textContent = "Unresolve";
  unresolveBtn.setAttribute("data-unresolve", "1");
  unresolveBtn.removeAttribute("data-edit");
  unresolveBtn.className = "btn btn-ghost";

  unresolveBtn.onclick = () => {
    const rowsToUnresolve = Array.from(seenSubs.values())
      .filter(v => {
        const r = v.rowData;
        return v.isResolved &&
          r &&
          String(r.gwId || "").toUpperCase() === String(rowData.gwId || "").toUpperCase() &&
          normTeamKey_(r.pick) === normTeamKey_(rowData.pick);
      })
      .map(v => v.rowData);

    const count = rowsToUnresolve.length;
    const teamName = rowData.pick || "this team";

    openBulkResolveModal({
      title: "Confirm unresolve",
      html: `
        <p style="margin:0;line-height:1.5;">
          Are you sure you want to unresolve <strong>${escapeHtml(teamName)}</strong>?
        </p>
      `,
      onConfirm: async () => {
        const buttonsToSpin = [];

        try {
          rowsToUnresolve.forEach(r => {
            const key = makeSubKey(r, r.gwId);
            const cached = seenSubs.get(key);
            const btn = cached?.el?.querySelector('button[data-unresolve="1"]');
            if (btn) {
              buttonsToSpin.push(btn);
              setBtnLoading(btn, true);
            }
          });

          await Promise.all(
            rowsToUnresolve.map(r => setPickOutcomeDirect_(r, "PENDING"))
          );

          await refreshSubmissionsIncremental({ full: true });
          showMsg(`${rowsToUnresolve.length} ${teamName} pick(s) unresolved`, true);
        } catch (e) {
          showMsg(String(e.message || e), false);
        } finally {
          buttonsToSpin.forEach(btn => setBtnLoading(btn, false));
        }
      }
    });
  };
}


function renderSubmissionRow(row) {
  const div = document.createElement("div");
  div.className = "list-item admin-submission-row";

  let outcome = String(row.outcome || "PENDING").toUpperCase();

  const fixture = findFixtureForPick_(row.gwId, row.pick);
  const kickoff = fixture?.kickoff || null;

  let fixtureLine = "Fixture not found";
  let dateTimeLine = "";

  if (fixture) {
    const isHome = normTeamKey_(fixture.home) === normTeamKey_(row.pick);
    const opponent = isHome ? fixture.away : fixture.home;

    fixtureLine = `vs ${opponent}`;

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

    dateTimeLine = `${datePart} ${timePart}`;
  }

  const renderResolvedControls = (o) => `
    <div class="admin-submission-actions">
      <span class="state ${o === "WIN" ? "good" : "bad"}">${o === "WIN" ? "✓" : "✕"}</span>
      <button class="btn btn-ghost" data-unresolve="1" type="button">Unresolve</button>
    </div>
  `;

  div.innerHTML = `
    <div class="admin-submission-main">
      <div class="admin-submission-head">
        <div class="admin-submission-name">
          ${escapeHtml(row.name || "")}
          <span class="admin-submission-gw">- ${escapeHtml(row.gwId || "")}</span>
        </div>
        <div class="admin-controls">
          ${isResolved(outcome) ? renderResolvedControls(outcome) : ""}
        </div>
      </div>

      <div class="admin-submission-pickline">
        <img
          class="admin-submission-logo"
          src="${escapeHtml(getTeamLogo_(row.pick || ""))}"
          alt="${escapeHtml(row.pick || "")} logo"
          onerror="this.onerror=null;this.src='images/team-default.png';"
        />
        <span class="admin-submission-pick">${escapeHtml(row.pick || "—")}</span>
      </div>

      <div class="admin-submission-fixtureline">
        <span class="admin-submission-fixture">${escapeHtml(fixtureLine)}</span>
        <span class="admin-submission-time">${escapeHtml(dateTimeLine)}</span>
      </div>
    </div>
  `;

  applyOutcomeStyles(div, outcome);

  if (isResolved(outcome)) {
    bindResolvedRowEvents_(div, row, outcome);
  }

  return {
    el: div,
    outcome,
    isResolved: isResolved(outcome),
    kickoff
  };
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
  let canResolve = false;

  if (fixture) {
    const isHomePick = normTeamKey_(fixture.home) === pickedTeamKey;
    const isAwayPick = normTeamKey_(fixture.away) === pickedTeamKey;

    if (isHomePick) opponent = fixture.away;
    else if (isAwayPick) opponent = fixture.home;

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

    dateTimeLine = `${datePart} ${timePart}`;
    canResolve =
      !!fixture.kickoff && Date.now() >= fixture.kickoff.getTime();
  }

  const winBtnClass = canResolve ? "btn btn-ghost" : "btn btn-ghost is-disabled";
  const lossBtnClass = canResolve ? "btn btn-primary" : "btn btn-primary is-disabled";

  wrap.innerHTML = `
    <div class="admin-fixture-resolve-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">

      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <img
            src="${escapeHtml(getTeamLogo_(pickedTeam))}"
            alt="${escapeHtml(pickedTeam)} logo"
            style="width:22px;height:22px;object-fit:contain;flex:0 0 auto;"
            onerror="this.onerror=null;this.src='images/team-default.png';"
          />
          <div style="font-weight:800;line-height:1.15;">
            ${escapeHtml(pickedTeam || "Unknown team")}
          </div>
        </div>

        <div class="muted" style="margin-top:6px;">
          vs ${escapeHtml(opponent)}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;gap:12px;flex:0 0 auto;">
        <div class="admin-submission-actions">
          <button class="${winBtnClass}" data-fixture-o="WIN" type="button" ${canResolve ? "" : "disabled aria-disabled='true'"}>Won</button>
          <button class="${lossBtnClass}" data-fixture-o="LOSS" type="button" ${canResolve ? "" : "disabled aria-disabled='true'"}>Lost</button>
        </div>

        <div class="muted small" style="white-space:nowrap;">
          ${escapeHtml(dateTimeLine)}
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
        <div class="list-title" style="font-weight:700;">${escapeHtml(row.name || "")} - ${escapeHtml(row.gwId || "")}</div>
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

  const fixtureButtons = wrap.querySelectorAll("button[data-fixture-o]");
  fixtureButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const outcome = btn.getAttribute("data-fixture-o");
      const clickedBtn = btn;

      if (!canResolve) return;

      const matchRows = rows.filter(r => !isResolved(r.outcome));
      if (!matchRows.length) return;

      fixtureButtons.forEach(b => {
        b.disabled = true;
        if (b === clickedBtn) setBtnLoading(b, true);
      });

      try {
        await Promise.all(matchRows.map(r => api({
          action: "adminSetPickOutcome",
          adminKey,
          email: r.email,
          gameId: selectedGameId,
          gwId: r.gwId,
          outcome
        })));

        const resolvedList = ensureResolvedList_();

        for (const r of matchRows) {
          const key = makeSubKey(r, r.gwId);
          const cached = seenSubs.get(key);
          if (!cached) continue;

          cached.outcome = outcome;
          cached.isResolved = true;
          cached.rowData.outcome = outcome;

          const rendered = renderSubmissionRow({
            ...r,
            outcome
          });

          cached.el.replaceWith(rendered.el);
          cached.el = rendered.el;

          if (resolvedList) resolvedList.prepend(rendered.el);

          seenSubs.set(key, cached);
        }

        wrap.remove();
        removeEmptyPendingGroups_();
        updateSubmissionSummaryCounts_();
        showMsg(`${matchRows.length} ${pickedTeam} picks marked ${outcome}`, true);
      } catch (e) {
        showMsg(String(e.message || e), false);
      } finally {
        fixtureButtons.forEach(b => {
          b.disabled = false;
          if (b === clickedBtn) setBtnLoading(b, false);
        });
      }
    });
  });

  return wrap;
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

    const gwIds = await loadGwListFromDeadlines();
    if (!gwIds.length) {
      subsContainer.innerHTML = `<div class="muted">No gameweeks found.</div>`;
      if (subsMeta) subsMeta.textContent = "No gameweeks found.";
      if (subsPendingCount) subsPendingCount.textContent = `(0)`;
      if (subsResolvedCount) subsResolvedCount.textContent = `(0)`;
      return;
    }

    let allRows = [];

    await mapWithConcurrency(gwIds, 4, async (gwId) => {
      const data = await api({
        action: "adminGetGwPicks",
        adminKey,
        gameId: selectedGameId,
        gwId
      });

      const rows = Array.isArray(data.rows) ? data.rows : [];
      allRows.push(...rows.map(r => ({
        ...r,
        gameId: selectedGameId,
        gwId: String(r.gwId || gwId).toUpperCase()
      })));
    });

    const deduped = new Map();

    allRows.forEach(r => {
      const key = `${String(r.email || "").trim().toLowerCase()}::${String(r.gwId || "").trim().toUpperCase()}`;
      if (!deduped.has(key)) deduped.set(key, r);
    });

    allRows = Array.from(deduped.values());

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

    window.__adminSubmissionRows = enriched;

    const pendingRows = enriched
      .filter(r => !r.resolved)
      .sort((a, b) => {
        const at = a.kickoff ? a.kickoff.getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.kickoff ? b.kickoff.getTime() : Number.MAX_SAFE_INTEGER;
        if (at !== bt) return at - bt;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    const resolvedRows = enriched
      .filter(r => r.resolved)
      .sort((a, b) => {
        const at = a.kickoff ? a.kickoff.getTime() : 0;
        const bt = b.kickoff ? b.kickoff.getTime() : 0;
        if (bt !== at) return bt - at;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

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

    const resolvedWrap = document.createElement("div");
    resolvedWrap.className = "fixtures-card";

    const resolvedTitle = document.createElement("h3");
    resolvedTitle.style.marginTop = "0";
    resolvedTitle.textContent = "Resolved";
    resolvedWrap.appendChild(resolvedTitle);

    if (!resolvedRows.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No resolved submissions.";
      resolvedWrap.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "list";
      list.id = "resolvedSubmissionsList";

      for (const row of resolvedRows) {
        const rendered = renderSubmissionRow(row);
        list.appendChild(rendered.el);

        const key = makeSubKey(row, row.gwId);
        seenSubs.set(key, {
          outcome: rendered.outcome,
          el: rendered.el,
          gwId: row.gwId,
          isResolved: rendered.isResolved,
          rowData: row
        });
      }

      resolvedWrap.appendChild(list);
    }

    subsContainer.appendChild(resolvedWrap);

    const pending = pendingRows.length;
    const resolved = resolvedRows.length;

    const game = adminGames.find(g => String(g.id) === String(selectedGameId));
    const gameLabel = game?.title || selectedGameId;

    if (subsPendingCount) subsPendingCount.textContent = `(${pending})`;
    if (subsResolvedCount) subsResolvedCount.textContent = `(${resolved})`;
    if (subsMeta) {
      subsMeta.textContent = `${gameLabel} • Pending: ${pending} • Resolved: ${resolved} • Total: ${pending + resolved}`;
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

    submissionsLoadedOnce = false;
    seenSubs.clear();
    if (subsContainer) subsContainer.innerHTML = "";

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

  submissionsLoadedOnce = false;
  seenSubs.clear();

  exitPanel();
  showMsg("Logged out.", true);
}

/*******************************
 * Events
 *******************************/

adminGameSelect?.addEventListener("change", async () => {
  selectedGameId = adminGameSelect.value || "";
  submissionsLoadedOnce = false;
  seenSubs.clear();
  subsContainer && (subsContainer.innerHTML = "");

  try {
    await loadApprovals();

    if (!subsPanel?.classList.contains("hidden")) {
      submissionsLoadedOnce = true;
      await refreshSubmissionsIncremental({ full: true });
    }
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
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
    localStorage.removeItem(LS_ADMIN_KEY);
    exitPanel();
    showMsg(String(e.message || e), false);
  }
})();


