"use strict";

const STORE_KEY = "rpgLedgerCombined.v1";

const DENOMS = [
  { key: "pp", label: "PP" },
  { key: "gp", label: "GP" },
  { key: "sp", label: "SP" },
  { key: "cp", label: "CP" }
];

const DND5E = [
  [2,300],[3,900],[4,2700],[5,6500],[6,14000],[7,23000],[8,34000],
  [9,48000],[10,64000],[11,85000],[12,100000],[13,120000],[14,140000],
  [15,165000],[16,195000],[17,225000],[18,265000],[19,305000],[20,355000]
];

// character: { name, levels:{}, xp:{txns:[{id,ts,dir,xp,note}]}, coins:{txns:[{id,ts,dir,amounts,note}]} }
let state = { activeId: null, characters: {} };
let view = "xp";              // which ledger is showing; independent of character
let xpDir = "add", coinDir = "add";
let xpSearch = "", coinSearch = "";

// ---- Storage ----
function load() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORE_KEY], (res) => {
      const data = res[STORE_KEY];
      if (data && data.characters && Object.keys(data.characters).length) {
        state = data;
        normalizeAll();
        if (!state.characters[state.activeId]) state.activeId = Object.keys(state.characters)[0];
      } else {
        const id = mkId();
        state = { activeId: id, characters: { [id]: blankChar("Adventurer") } };
      }
      resolve();
    });
  });
}
function save() {
  return new Promise((resolve) => chrome.storage.local.set({ [STORE_KEY]: state }, resolve));
}
function mkId() {
  return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function blankChar(name) {
  return { name, levels: {}, xp: { txns: [] }, coins: { txns: [] } };
}
function normalizeChar(c) {
  return {
    name: c.name || "Unnamed",
    levels: c.levels && typeof c.levels === "object" ? c.levels : {},
    xp: { txns: Array.isArray(c.xp && c.xp.txns) ? c.xp.txns : [] },
    coins: { txns: Array.isArray(c.coins && c.coins.txns) ? c.coins.txns : [] }
  };
}
function normalizeAll() {
  for (const [id, c] of Object.entries(state.characters)) {
    state.characters[id] = normalizeChar(c);
  }
}
function active() { return state.characters[state.activeId]; }
function emptyAmounts() { return { pp: 0, gp: 0, sp: 0, cp: 0 }; }

// ---- XP / level logic ----
function levelForXp(total, levels) {
  let lvl = 1;
  const entries = Object.entries(levels || {})
    .map(([k, v]) => [parseInt(k, 10), Number(v)])
    .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v))
    .sort((a, b) => a[1] - b[1]);
  for (const [level, req] of entries) if (total >= req) lvl = Math.max(lvl, level);
  return lvl;
}
function xpRunning(txns, levels) {
  let total = 0; const out = [];
  for (const t of txns) {
    total += (t.dir === "sub" ? -1 : 1) * (Number(t.xp) || 0);
    out.push({ total, level: levelForXp(total, levels) });
  }
  return out;
}
function xpTotal() {
  let total = 0;
  for (const t of active().xp.txns) total += (t.dir === "sub" ? -1 : 1) * (Number(t.xp) || 0);
  return total;
}

// ---- Coin logic ----
function coinRunning(txns) {
  const totals = emptyAmounts(); const out = [];
  for (const t of txns) {
    for (const d of DENOMS) {
      const v = Number(t.amounts[d.key]) || 0;
      totals[d.key] += t.dir === "sub" ? -v : v;
    }
    out.push({ ...totals });
  }
  return out;
}
function coinTotals() {
  const totals = emptyAmounts();
  for (const t of active().coins.txns) {
    for (const d of DENOMS) {
      const v = Number(t.amounts[d.key]) || 0;
      totals[d.key] += t.dir === "sub" ? -v : v;
    }
  }
  return totals;
}

// ---- Dates ----
function fmtDate(ts) {
  const dt = new Date(ts);
  return `${dt.getDate()} ${dt.toLocaleDateString(undefined, { month: "short" })} ${dt.getFullYear()}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Rendering: shared ----
function renderCharSelect() {
  const sel = document.getElementById("charSelect");
  sel.innerHTML = "";
  for (const [id, c] of Object.entries(state.characters)) {
    const opt = document.createElement("option");
    opt.value = id; opt.textContent = c.name;
    if (id === state.activeId) opt.selected = true;
    sel.appendChild(opt);
  }
}

function setView(next) {
  view = next;
  document.getElementById("tabXp").classList.toggle("active", next === "xp");
  document.getElementById("tabCoins").classList.toggle("active", next === "coins");
  document.getElementById("tabXp").setAttribute("aria-selected", next === "xp");
  document.getElementById("tabCoins").setAttribute("aria-selected", next === "coins");
  document.getElementById("xpView").hidden = next !== "xp";
  document.getElementById("coinsView").hidden = next !== "coins";
}

// ---- Rendering: XP ----
function renderXpHead() {
  document.getElementById("xpHead").innerHTML =
    `<th class="c">Lvl</th><th class="l">Date</th><th class="l">Note</th><th>XP Δ</th><th>Total</th><th></th>`;
}
function renderXpBalances() {
  const total = xpTotal();
  const level = levelForXp(total, active().levels);
  document.getElementById("xpTotal").textContent = total.toLocaleString();
  document.getElementById("xpLevel").textContent = level;
  const higher = Object.entries(active().levels || {})
    .map(([k, v]) => [parseInt(k, 10), Number(v)])
    .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v) && v > total)
    .sort((a, b) => a[1] - b[1]);
  let hint;
  if (higher.length) hint = `${(higher[0][1] - total).toLocaleString()} XP to L${higher[0][0]}`;
  else if (Object.keys(active().levels || {}).length) hint = "Max level reached";
  else hint = "No level table set";
  document.getElementById("xpNext").textContent = hint;
}
function renderXpLog() {
  const body = document.getElementById("xpBody");
  const txns = active().xp.txns;
  const running = xpRunning(txns, active().levels);
  body.innerHTML = "";
  const rows = txns.map((t, i) => ({ t, run: running[i] }))
    .filter(({ t }) => !xpSearch || (t.note || "").toLowerCase().includes(xpSearch))
    .reverse();
  document.getElementById("xpEmpty").hidden = txns.length !== 0;
  for (const { t, run } of rows) {
    const sign = t.dir === "sub" ? -1 : 1;
    const v = Number(t.xp) || 0;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="c"><span class="lvl-badge">${run.level}</span></td>` +
      `<td class="l ts">${fmtDate(t.ts)}</td>` +
      `<td class="l note-cell" title="${escapeHtml(t.note || "")}">${escapeHtml(t.note || "")}</td>` +
      `<td class="${sign < 0 ? "delta-neg" : "delta-pos"}">${sign > 0 ? "+" : ""}${(sign * v).toLocaleString()}</td>` +
      `<td class="run">${run.total.toLocaleString()}</td>` +
      `<td><button class="del-row" data-kind="xp" data-id="${t.id}" title="Delete">✕</button></td>`;
    body.appendChild(tr);
  }
}

// ---- Rendering: Coins ----
function renderCoinInputs() {
  const wrap = document.getElementById("coinInputs");
  wrap.innerHTML = "";
  for (const d of DENOMS) {
    const f = document.createElement("div");
    f.className = "coin-field " + d.key;
    f.innerHTML = `<label>${d.label}</label><input type="number" min="0" step="1" inputmode="numeric" id="cin_${d.key}" placeholder="0">`;
    wrap.appendChild(f);
  }
}
function renderCoinHead() {
  document.getElementById("coinHead").innerHTML =
    `<th class="l">Date</th><th class="l">Note</th>` +
    DENOMS.map((d) => `<th>${d.label} Δ</th>`).join("") +
    DENOMS.map((d) => `<th>${d.label} bal</th>`).join("") + `<th></th>`;
}
function renderCoinBalances() {
  const bal = coinTotals();
  const wrap = document.getElementById("coinBalances");
  wrap.className = "balances";
  wrap.innerHTML = "";
  for (const d of DENOMS) {
    const card = document.createElement("div");
    card.className = "bal-card " + d.key;
    card.innerHTML = `<div class="coin"><span class="dot">●</span> ${d.label}</div><div class="amt">${bal[d.key].toLocaleString()}</div>`;
    wrap.appendChild(card);
  }
}
function renderCoinLog() {
  const body = document.getElementById("coinBody");
  const txns = active().coins.txns;
  const running = coinRunning(txns);
  body.innerHTML = "";
  const rows = txns.map((t, i) => ({ t, run: running[i] }))
    .filter(({ t }) => !coinSearch || (t.note || "").toLowerCase().includes(coinSearch))
    .reverse();
  document.getElementById("coinEmpty").hidden = txns.length !== 0;
  for (const { t, run } of rows) {
    const sign = t.dir === "sub" ? -1 : 1;
    const deltas = DENOMS.map((d) => {
      const v = Number(t.amounts[d.key]) || 0;
      if (v === 0) return `<td class="run">·</td>`;
      return `<td class="${sign < 0 ? "delta-neg" : "delta-pos"}">${sign > 0 ? "+" : ""}${(sign * v).toLocaleString()}</td>`;
    }).join("");
    const bals = DENOMS.map((d) => `<td class="run">${run[d.key].toLocaleString()}</td>`).join("");
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="l ts">${fmtDate(t.ts)}</td>` +
      `<td class="l note-cell" title="${escapeHtml(t.note || "")}">${escapeHtml(t.note || "")}</td>` +
      deltas + bals +
      `<td><button class="del-row" data-kind="coin" data-id="${t.id}" title="Delete">✕</button></td>`;
    body.appendChild(tr);
  }
}

function renderAll() {
  renderCharSelect();
  renderXpBalances(); renderXpLog();
  renderCoinBalances(); renderCoinLog();
}

// ---- Actions: XP ----
async function recordXp() {
  const v = Math.abs(Math.floor(Number(document.getElementById("xpInput").value) || 0));
  if (v === 0) return toast("Enter an XP amount.");
  active().xp.txns.push({ id: mkId(), ts: Date.now(), dir: xpDir, xp: v, note: document.getElementById("xpNote").value.trim() });
  await save();
  document.getElementById("xpInput").value = "";
  document.getElementById("xpNote").value = "";
  renderXpBalances(); renderXpLog();
  toast(xpDir === "add" ? "XP gained." : "XP lost.");
}

// ---- Actions: Coins ----
async function recordCoin() {
  const amounts = emptyAmounts(); let any = false;
  for (const d of DENOMS) {
    const v = Math.max(0, Math.floor(Number(document.getElementById("cin_" + d.key).value) || 0));
    amounts[d.key] = v; if (v > 0) any = true;
  }
  if (!any) return toast("Enter at least one coin amount.");
  active().coins.txns.push({ id: mkId(), ts: Date.now(), dir: coinDir, amounts, note: document.getElementById("coinNote").value.trim() });
  await save();
  for (const d of DENOMS) document.getElementById("cin_" + d.key).value = "";
  document.getElementById("coinNote").value = "";
  renderCoinBalances(); renderCoinLog();
  toast(coinDir === "add" ? "Gain recorded." : "Spend recorded.");
}

async function deleteTxn(kind, id) {
  if (kind === "xp") active().xp.txns = active().xp.txns.filter((t) => t.id !== id);
  else active().coins.txns = active().coins.txns.filter((t) => t.id !== id);
  await save();
  renderAll();
}

// ---- Character management ----
async function newCharacter() {
  const name = prompt("Name for the new character:", "New Character");
  if (!name) return;
  const id = mkId();
  state.characters[id] = blankChar(name.trim() || "Unnamed");
  state.activeId = id;
  await save();
  renderAll();
}
async function renameCharacter() {
  const name = prompt("Rename:", active().name);
  if (!name) return;
  active().name = name.trim() || active().name;
  await save();
  renderCharSelect();
}
async function deleteCharacter() {
  if (Object.keys(state.characters).length <= 1) return toast("Can't delete the only character.");
  if (!confirm(`Delete "${active().name}" and all its data (XP and treasure)?`)) return;
  delete state.characters[state.activeId];
  state.activeId = Object.keys(state.characters)[0];
  await save();
  renderAll();
}

// ---- Levels editor ----
function openLevelsEditor() {
  document.querySelectorAll(".modal-backdrop").forEach((el) => el.remove());
  const rows = Object.entries(active().levels || {})
    .map(([k, v]) => [parseInt(k, 10), Number(v)])
    .filter(([k]) => Number.isFinite(k))
    .sort((a, b) => a[0] - b[0]);

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Level Thresholds — ${escapeHtml(active().name)}</h3>
      <div class="modal-body">
        <p class="hint">Cumulative total XP required to <em>reach</em> each level. Level 1 is assumed at 0 XP.</p>
        <table class="lvl-table">
          <thead><tr><th style="width:90px">Level</th><th>XP required</th><th style="width:32px"></th></tr></thead>
          <tbody id="lvlBody"></tbody>
        </table>
      </div>
      <div class="modal-foot">
        <div class="left">
          <button class="ghost" id="lvlAddRow">+ Add level</button>
          <button class="ghost" id="lvl5e">Load 5e</button>
        </div>
        <div class="left">
          <button class="ghost" id="lvlCancel">Cancel</button>
          <button class="btn-primary" id="lvlSave">Save</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const tbody = backdrop.querySelector("#lvlBody");
  function addRow(level = "", xp = "") {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><input type="number" class="lvl-l" min="2" step="1" value="${level}" placeholder="2"></td>` +
      `<td><input type="number" class="lvl-x" min="0" step="1" value="${xp}" placeholder="0"></td>` +
      `<td><button class="lvl-row-del" title="Remove">✕</button></td>`;
    tr.querySelector(".lvl-row-del").addEventListener("click", () => tr.remove());
    tbody.appendChild(tr);
  }
  if (rows.length) rows.forEach(([l, x]) => addRow(l, x)); else addRow();

  function closeModal() { document.removeEventListener("keydown", onKey); backdrop.remove(); }
  function onKey(e) { if (e.key === "Escape") closeModal(); }
  document.addEventListener("keydown", onKey);

  backdrop.querySelector("#lvlAddRow").addEventListener("click", () => addRow());
  backdrop.querySelector("#lvl5e").addEventListener("click", () => { tbody.innerHTML = ""; DND5E.forEach(([l, x]) => addRow(l, x)); });
  backdrop.querySelector("#lvlCancel").addEventListener("click", () => closeModal());
  backdrop.querySelector("#lvlSave").addEventListener("click", async () => {
    const next = {};
    for (const tr of tbody.querySelectorAll("tr")) {
      const l = parseInt(tr.querySelector(".lvl-l").value, 10);
      const x = Number(tr.querySelector(".lvl-x").value);
      if (Number.isFinite(l) && l >= 2 && Number.isFinite(x) && x >= 0) next[l] = x;
    }
    active().levels = next;
    await save();
    closeModal();
    renderAll();
    toast("Level thresholds saved.");
  });
}

// ---- Import / Export (combined format only) ----
function exportData() {
  const payload = { format: "rpg-ledger-combined", version: 1, exportedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `rpg-ledger-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast("Exported backup.");
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data && parsed.data.characters ? parsed.data : parsed;
      if (!incoming || !incoming.characters) throw new Error("No characters in file");
      const merge = confirm("OK = MERGE imported characters with existing.\nCancel = REPLACE everything with the imported file.");
      if (merge) {
        for (const c of Object.values(incoming.characters)) state.characters[mkId()] = normalizeChar(c);
      } else {
        const chars = {};
        for (const [id, c] of Object.entries(incoming.characters)) chars[id] = normalizeChar(c);
        state = { activeId: incoming.activeId && chars[incoming.activeId] ? incoming.activeId : Object.keys(chars)[0], characters: chars };
      }
      if (!state.characters[state.activeId]) state.activeId = Object.keys(state.characters)[0];
      await save();
      renderAll();
      toast("Import complete.");
    } catch (e) { toast("Import failed: " + e.message); }
  };
  reader.readAsText(file);
}

// ---- UI plumbing ----
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2200);
}
function setXpDir(d) {
  xpDir = d;
  document.getElementById("xpSegAdd").classList.toggle("active", d === "add");
  document.getElementById("xpSegSub").classList.toggle("active", d === "sub");
}
function setCoinDir(d) {
  coinDir = d;
  document.getElementById("coinSegAdd").classList.toggle("active", d === "add");
  document.getElementById("coinSegSub").classList.toggle("active", d === "sub");
}

function wire() {
  document.getElementById("charSelect").addEventListener("change", async (e) => {
    state.activeId = e.target.value;
    await save();
    renderAll();
  });
  document.getElementById("newCharBtn").addEventListener("click", newCharacter);
  document.getElementById("renameCharBtn").addEventListener("click", renameCharacter);
  document.getElementById("deleteCharBtn").addEventListener("click", deleteCharacter);
  document.getElementById("panelBtn").addEventListener("click", async () => {
    try {
      const win = await chrome.windows.getCurrent();
      if (win && win.id !== undefined) { await chrome.sidePanel.open({ windowId: win.id }); window.close(); }
    } catch (e) { toast("Open via right-click the icon → side panel."); }
  });

  document.getElementById("tabXp").addEventListener("click", () => setView("xp"));
  document.getElementById("tabCoins").addEventListener("click", () => setView("coins"));

  document.getElementById("xpSegAdd").addEventListener("click", () => setXpDir("add"));
  document.getElementById("xpSegSub").addEventListener("click", () => setXpDir("sub"));
  document.getElementById("xpRecord").addEventListener("click", recordXp);
  document.getElementById("xpInput").addEventListener("keydown", (e) => { if (e.key === "Enter") recordXp(); });
  document.getElementById("xpNote").addEventListener("keydown", (e) => { if (e.key === "Enter") recordXp(); });
  document.getElementById("levelsBtn").addEventListener("click", openLevelsEditor);
  document.getElementById("xpSearch").addEventListener("input", (e) => { xpSearch = e.target.value.trim().toLowerCase(); renderXpLog(); });

  document.getElementById("coinSegAdd").addEventListener("click", () => setCoinDir("add"));
  document.getElementById("coinSegSub").addEventListener("click", () => setCoinDir("sub"));
  document.getElementById("coinRecord").addEventListener("click", recordCoin);
  document.getElementById("coinNote").addEventListener("keydown", (e) => { if (e.key === "Enter") recordCoin(); });
  document.getElementById("coinSearch").addEventListener("input", (e) => { coinSearch = e.target.value.trim().toLowerCase(); renderCoinLog(); });

  // Shared delete handler for both logs
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest(".del-row");
    if (btn) deleteTxn(btn.dataset.kind, btn.dataset.id);
  });

  // Import/export buttons exist in both views
  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("exportBtn2").addEventListener("click", exportData);
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importBtn2").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
}

// ---- Boot ----
(async function init() {
  renderCoinInputs();
  renderXpHead();
  renderCoinHead();
  await load();
  wire();
  setView("xp");
  setXpDir("add");
  setCoinDir("add");
  renderAll();
})();
