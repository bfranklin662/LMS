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

function pruneMissingSubmissions_(keysStillPresent) {
  // Remove cached rows that no longer exist on the sheet
  for (const [key, cached] of Array.from(seenSubs.entries())) {
    if (keysStillPresent.has(key)) continue;

    try { cached.el?.remove(); } catch { }
    seenSubs.delete(key);
  }

  // Remove empty GW sections (optional but nice)
  for (const [gw, sec] of Array.from(gwSections.entries())) {
    const hasAny = Array.from(seenSubs.values()).some(v => v.gwId === gw);
    if (!hasAny) {
      try { sec.wrapEl?.remove(); } catch { }
      gwSections.delete(gw);
    }
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

const subsPendingListEl = document.getElementById("subsPendingList");
const subsResolvedListEl = document.getElementById("subsResolvedList");

const subsPendingCount = document.getElementById("subsPendingCount");
const subsResolvedCount = document.getElementById("subsResolvedCount");


/*******************************
 * STATE
 *******************************/
let adminKey = "";
let submissionsLoadedOnce = false;

const seenSubs = new Map();   // key -> { outcome, el, gwId, isResolved }
const gwSections = new Map(); // gwId -> { wrapEl, pendingListEl, resolvedListEl, pendingCountEl, resolvedCountEl }

/*******************************
 * Tabs
 *******************************/
function setTab(name) {
  tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  approvalsPanel?.classList.toggle("hidden", name !== "approvals");
  subsPanel?.classList.toggle("hidden", name !== "submissions");

  // Auto-load submissions when tab is first opened
  if (name === "submissions" && !submissionsLoadedOnce) {
    submissionsLoadedOnce = true;
    refreshSubmissionsIncremental({ full: true }).catch(e => showMsg(String(e.message || e), false));
  }
}

tabButtons.forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

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

  if (pendingMeta) pendingMeta.textContent = "Refreshing…";


  const data = await api({ action: "adminListUsers", adminKey });
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
        <div class="list-sub">${escapeHtml(u.clubTeam || "")}</div>
      </div>
      <button class="btn btn-primary" type="button">Approve</button>
    `;

    const btn = row.querySelector("button");
    btn.addEventListener("click", async () => {
      setBtnLoading(btn, true);
      try {
        await api({ action: "adminApprove", adminKey, email: u.email });
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
        <div class="list-sub">${escapeHtml(u.clubTeam || "")}</div>
      </div>
      <span class="state good">✓</span>
    `;
    approvedList.appendChild(row);
  }

  if (pendingMeta) pendingMeta.textContent = `Pending: ${pending.length} • Approved: ${approved.length}`;
}

/*******************************
 * Submissions helpers
 *******************************/
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
  return `${gw}::${email}`;
}


function applyOutcomeStyles(rowEl, outcome) {
  rowEl.classList.remove("row-win", "row-loss");
  if (outcome === "WIN") rowEl.classList.add("row-win");
  if (outcome === "LOSS") rowEl.classList.add("row-loss");
}

function ensureGwSection(gwId) {
  const gw = String(gwId || "").toUpperCase();
  if (gwSections.has(gw)) return gwSections.get(gw);

  const wrap = document.createElement("div");

  const h = document.createElement("h3");
  h.style.marginTop = "16px";
  h.textContent = `${gw} submissions`;
  wrap.appendChild(h);

  const meta = document.createElement("div");
  meta.className = "muted small";
  meta.style.margin = "4px 0 10px";
  meta.innerHTML = `Pending <span class="gw-pending-count">(0)</span> • Resolved <span class="gw-resolved-count">(0)</span>`;
  wrap.appendChild(meta);

  const pendingTitle = document.createElement("div");
  pendingTitle.className = "muted small";
  pendingTitle.style.margin = "10px 0 6px";
  pendingTitle.innerHTML = `<strong>Pending</strong>`;
  wrap.appendChild(pendingTitle);

  const pendingListEl = document.createElement("div");
  pendingListEl.className = "list";
  wrap.appendChild(pendingListEl);

  const resolvedTitle = document.createElement("div");
  resolvedTitle.className = "muted small";
  resolvedTitle.style.margin = "12px 0 6px";
  resolvedTitle.innerHTML = `<strong>Resolved</strong>`;
  wrap.appendChild(resolvedTitle);

  const resolvedListEl = document.createElement("div");
  resolvedListEl.className = "list";
  wrap.appendChild(resolvedListEl);

  const pendingCountEl = meta.querySelector(".gw-pending-count");
  const resolvedCountEl = meta.querySelector(".gw-resolved-count");

  // Insert newest GW first
  const children = Array.from(subsContainer.children);
  let inserted = false;
  for (const child of children) {
    const title = child.querySelector("h3")?.textContent || "";
    const m = title.match(/^(GW\d+)/i);
    const existingGw = m ? m[1].toUpperCase() : null;
    if (!existingGw) continue;

    if (gwNum(existingGw) < gwNum(gw)) {
      subsContainer.insertBefore(wrap, child);
      inserted = true;
      break;
    }
  }
  if (!inserted) subsContainer.appendChild(wrap);

  const section = { wrapEl: wrap, pendingListEl, resolvedListEl, pendingCountEl, resolvedCountEl };
  gwSections.set(gw, section);
  return section;
}

function updateCounts() {
  let pending = 0, resolved = 0;

  for (const v of seenSubs.values()) {
    if (v.isResolved) resolved++;
    else pending++;
  }

  if (subsPendingCount) subsPendingCount.textContent = `(${pending})`;
  if (subsResolvedCount) subsResolvedCount.textContent = `(${resolved})`;

  for (const [gw, sec] of gwSections.entries()) {
    let p = 0, r = 0;
    for (const v of seenSubs.values()) {
      if (v.gwId !== gw) continue;
      if (v.isResolved) r++; else p++;
    }
    if (sec.pendingCountEl) sec.pendingCountEl.textContent = `(${p})`;
    if (sec.resolvedCountEl) sec.resolvedCountEl.textContent = `(${r})`;
  }
}

function renderResolvedActions(outcome) {
  const icon = outcome === "WIN" ? "✓" : "✕";
  const cls = outcome === "WIN" ? "good" : "bad";
  return `
    <span class="state ${cls}">${icon}</span>
    <button class="icon-btn" type="button" data-edit title="Edit outcome">✏️</button>
  `;
}

function renderPendingActions(outcome) {
  return `
    <button class="btn btn-ghost" data-o="WIN" type="button">Won</button>
    <button class="btn btn-primary" data-o="LOSS" type="button">Lost</button>
  `;
}

function isResolved(outcome) {
  const o = String(outcome || "PENDING").toUpperCase();
  return o === "WIN" || o === "LOSS";
}

function renderSubmissionRow(row, gwIdForDisplay, section) {
  const div = document.createElement("div");
  div.className = "list-item";

  let outcome = String(row.outcome || "PENDING").toUpperCase();

  const renderPendingControls = () => `
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn-ghost" data-o="WIN" type="button">Won</button>
      <button class="btn btn-primary" data-o="LOSS" type="button">Lost</button>
    </div>
  `;

  const renderResolvedControls = (o) => `
    <div style="display:flex;gap:8px;align-items:center;">
      <span class="state ${o === "WIN" ? "good" : "bad"}">${o === "WIN" ? "✓" : "✕"}</span>
      <button class="icon-btn" data-edit="1" type="button" title="Edit outcome">✏️</button>
    </div>
  `;

  const renderControls = () =>
    isResolved(outcome) ? renderResolvedControls(outcome) : renderPendingControls();

  div.innerHTML = `
    <div class="list-left">
      <div class="list-title">${escapeHtml(row.name || "")} - ${escapeHtml(row.pick || "")}</div>
      <div class="list-sub">${escapeHtml(gwIdForDisplay)}</div>
    </div>
    <div class="admin-controls">
      ${renderControls()}
    </div>
  `;

  applyOutcomeStyles(div, outcome);

  // helper: move DOM node to correct list
  const moveIntoCorrectList = () => {
    // If we're in flat mode, just leave it where it is (refresh rebuilds the list anyway)
    if (!section) return;

    const resolvedNow = isResolved(outcome);
    if (resolvedNow) section.resolvedListEl.appendChild(div);
    else section.pendingListEl.appendChild(div);
  };


  const setOutcomeViaApi = async (newOutcome, clickedBtn) => {
    const btns = Array.from(div.querySelectorAll("button"));
    if (clickedBtn) setBtnLoading(clickedBtn, true);
    btns.forEach(b => (b.disabled = true));

    try {
      await api({
        action: "adminSetPickOutcome",
        adminKey,
        email: row.email,
        gwId: row.gwId || gwIdForDisplay,
        outcome: newOutcome
      });

      outcome = newOutcome;
      applyOutcomeStyles(div, outcome);

      // update controls and move to correct column
      div.querySelector(".admin-controls").innerHTML = renderResolvedControls(outcome);
      moveIntoCorrectList();
      wire();

      // cache so refresh doesn't visually undo
      const key = makeSubKey(row, gwIdForDisplay);
      const cached = seenSubs.get(key);
      if (cached) {
        cached.outcome = outcome;
        cached.isResolved = isResolved(outcome);
      }

      updateCounts();
      showMsg(`${row.name}: marked ${outcome}`, true);
    } catch (e) {
      showMsg(String(e.message || e), false);
      btns.forEach(b => (b.disabled = false));
    } finally {
      if (clickedBtn) setBtnLoading(clickedBtn, false);
    }
  };

  const wire = () => {
    // Won/Lost buttons
    const wonLostBtns = Array.from(div.querySelectorAll('button[data-o]'));
    wonLostBtns.forEach(btn => {
      btn.addEventListener("click", async () => {
        const newOutcome = btn.getAttribute("data-o");
        await setOutcomeViaApi(newOutcome, btn);
      });
    });

    // Pencil button: switch UI back to choice mode (no backend "PENDING")
    const pencil = div.querySelector('button[data-edit="1"]');
    if (pencil) {
      pencil.addEventListener("click", () => {
        div.querySelector(".admin-controls").innerHTML = `
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-ghost" data-o="WIN" type="button">Won</button>
            <button class="btn btn-primary" data-o="LOSS" type="button">Lost</button>
            <button class="icon-btn" data-cancel="1" type="button" title="Cancel">✕</button>
          </div>
        `;

        // cancel returns to resolved controls
        const cancel = div.querySelector('button[data-cancel="1"]');
        cancel?.addEventListener("click", () => {
          div.querySelector(".admin-controls").innerHTML = renderResolvedControls(outcome);
          wire();
        });

        wire();
      });
    }
  };

  wire();

  return { el: div, outcome, isResolved: isResolved(outcome) };
}

let adminPoll = null;

function startAdminPolling() {
  if (adminPoll) return;
  adminPoll = setInterval(() => {
    loadPendingApprovals();
  }, 8000);
}

function stopAdminPolling() {
  if (adminPoll) clearInterval(adminPoll);
  adminPoll = null;
}


/*******************************
 * Submissions load
 *******************************/
async function refreshSubmissionsIncremental({ full = false } = {}) {
  if (!subsPendingListEl || !subsResolvedListEl) return;

  hideMsg();
  if (subsMeta) subsMeta.textContent = "Refreshing…";
  setBtnLoading(refreshSubsBtn, true);

  try {
    // Full refresh only when you explicitly want it (e.g. first load)
    if (full) {
      seenSubs.clear();
      gwSections.clear();
      if (subsContainer) subsContainer.innerHTML = "";
      subsPendingListEl.innerHTML = `<div class="muted">Loading submissions…</div>`;
      subsResolvedListEl.innerHTML = `<div class="muted">Loading submissions…</div>`;
    }

    const gwIds = await loadGwListFromDeadlines();
    if (!gwIds.length) {
      if (full) {
        subsPendingListEl.innerHTML = `<div class="muted">No pending submissions.</div>`;
        subsResolvedListEl.innerHTML = `<div class="muted">No resolved submissions.</div>`;
        if (subsMeta) subsMeta.textContent = "No gameweeks found.";
        if (subsPendingCount) subsPendingCount.textContent = `(0)`;
        if (subsResolvedCount) subsResolvedCount.textContent = `(0)`;
      } else {
        if (subsMeta) subsMeta.textContent = "No gameweeks found.";
      }
      return;
    }

    // newest first
    gwIds.sort((a, b) => gwNum(b) - gwNum(a));

    const keysStillPresent = new Set();

    let pending = 0;
    let resolved = 0;
    let total = 0;

    // If this is NOT full, keep current DOM and only add/replace
    await mapWithConcurrency(gwIds, 4, async (gwId) => {
      let rows = [];
      try {
        const data = await api({ action: "adminGetGwPicks", adminKey, gwId });
        rows = data.rows || [];
      } catch {
        rows = [];
      }

      for (const row of rows) {
        const outcome = String(row.outcome || "PENDING").toUpperCase();
        const key = makeSubKey(row, gwId);
        keysStillPresent.add(key);

        const existing = seenSubs.get(key);

        // ✅ New row: render & append
        if (!existing) {
          // Clear placeholders on first real insert
          const pendingTxt = (subsPendingListEl.textContent || "").toLowerCase();
          const resolvedTxt = (subsResolvedListEl.textContent || "").toLowerCase();

          if (pendingTxt.includes("loading submissions") || pendingTxt.includes("no pending submissions")) {
            subsPendingListEl.innerHTML = "";
          }
          if (resolvedTxt.includes("loading submissions") || resolvedTxt.includes("no resolved submissions")) {
            subsResolvedListEl.innerHTML = "";
          }


          const rendered = renderSubmissionRow(row, gwId, {
            pendingListEl: subsPendingListEl,
            resolvedListEl: subsResolvedListEl
          });

          if (isResolved(outcome)) subsResolvedListEl.appendChild(rendered.el);
          else subsPendingListEl.appendChild(rendered.el);

          seenSubs.set(key, {
            outcome,
            el: rendered.el,
            gwId: String(row.gwId || gwId).toUpperCase(),
            isResolved: isResolved(outcome)
          });
        }
        // ✅ Existing row: if outcome changed, replace element (simplest + reliable)
        else {
          if (String(existing.outcome).toUpperCase() !== outcome) {
            const rendered = renderSubmissionRow(row, gwId, {
              pendingListEl: subsPendingListEl,
              resolvedListEl: subsResolvedListEl
            });

            try { existing.el?.replaceWith(rendered.el); } catch { }

            // If it moved columns, ensure it lands correctly
            if (isResolved(outcome)) subsResolvedListEl.appendChild(rendered.el);
            else subsPendingListEl.appendChild(rendered.el);

            existing.el = rendered.el;
            existing.outcome = outcome;
            existing.isResolved = isResolved(outcome);
          }
        }

        if (isResolved(outcome)) resolved++; else pending++;
        total++;
      }
    });

    // ✅ Prune anything that disappeared on the sheet (optional but matches approvals “clean” feel)
    pruneMissingSubmissions_(keysStillPresent);

    // Empty states
    if (!pending && subsPendingListEl.innerHTML.trim() === "") {
      subsPendingListEl.innerHTML = `<div class="muted">No pending submissions.</div>`;
    }
    if (!resolved && subsResolvedListEl.innerHTML.trim() === "") {
      subsResolvedListEl.innerHTML = `<div class="muted">No resolved submissions.</div>`;
    }

    if (subsPendingCount) subsPendingCount.textContent = `(${pending})`;
    if (subsResolvedCount) subsResolvedCount.textContent = `(${resolved})`;
    if (subsMeta) subsMeta.textContent = `Pending: ${pending} • Resolved: ${resolved} • Total: ${total}`;
  } finally {
    setBtnLoading(refreshSubsBtn, false);
  }
}


let adminReqId = 0;
let adminLoading = false;

async function loadPendingApprovals({ force = false } = {}) {
  if (adminLoading && !force) return;
  adminLoading = true;

  const myReq = ++adminReqId;

  // ✅ Show "Refreshing..." but DO NOT wipe counts/lists to 0
  setAdminRefreshStatus("Refreshing…"); // just text/spinner

  try {
    const data = await api({ action: "getPendingApprovals" }, { timeoutMs: 12000 });
    if (myReq !== adminReqId) return;

    // ✅ Render using actual data only
    renderPendingApprovals(data); // updates counts + list together
  } catch (e) {
    // keep old UI, just show an error line if you want
    console.warn(e);
  } finally {
    if (myReq === adminReqId) {
      setAdminRefreshStatus("");
      adminLoading = false;
    }
  }
}


/*******************************
 * LOGIN / LOGOUT
 *******************************/
async function loginWithKey(key) {
  adminKey = key;

  showSplash(true);
  setBtnLoading(adminLoginBtn, true);

  try {
    // validate key
    await api({ action: "adminListUsers", adminKey });

    sessionStorage.setItem(LS_ADMIN_KEY, adminKey);

    // reset submissions
    submissionsLoadedOnce = false;
    seenSubs.clear();
    gwSections.clear();

    if (subsContainer) subsContainer.innerHTML = "";
    if (subsMeta) subsMeta.textContent = "";
    if (subsPendingCount) subsPendingCount.textContent = "";
    if (subsResolvedCount) subsResolvedCount.textContent = "";


    enterPanel();
    setTab("approvals");

    // approvals auto load on entry
    await loadApprovals();
    showMsg("Logged in.", true);
  } finally {
    setBtnLoading(adminLoginBtn, false);
    showSplash(false);
  }
}

function logout() {
  adminKey = "";
  sessionStorage.removeItem(LS_ADMIN_KEY);

  pendingList && (pendingList.innerHTML = "");
  approvedList && (approvedList.innerHTML = "");
  pendingCount && (pendingCount.textContent = "");
  approvedCount && (approvedCount.textContent = "");

  subsContainer && (subsContainer.innerHTML = "");
  subsMeta && (subsMeta.textContent = "");

  submissionsLoadedOnce = false;
  seenSubs.clear();
  gwSections.clear();

  exitPanel();
  showMsg("Logged out.", true);
}

/*******************************
 * Events
 *******************************/

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("adminView")) {
    startAdminPolling();
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
(function boot() {
  exitPanel();

  const saved = sessionStorage.getItem(LS_ADMIN_KEY);
  if (saved) {
    adminKeyEl.value = saved;
    loginWithKey(saved).catch(() => {
      sessionStorage.removeItem(LS_ADMIN_KEY);
      exitPanel();
    });
  }
})();

