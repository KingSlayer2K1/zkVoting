/* ═══════════════════════════════════════════════════════════════════════════
   zkVoting — Research Simulation Dashboard v3
   Full self-contained research workstation.
   ═══════════════════════════════════════════════════════════════════════════ */

const API = "http://localhost:4000";
const STORE = "zkvoting_v3";

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  election: null,
  activeVoter: null, // { voterId, identityTag, ckHash, pkid, ... }
  receipt: null,
  voters: [],
  logFilter: "all",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function log(msg, type = "system") {
  const now = new Date();
  const ts = now.toLocaleTimeString("en-GB", { hour12: false });
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;
  entry.dataset.type = type;
  entry.innerHTML = `<span class="log-time">${ts}</span><span class="log-msg">${esc(msg)}</span>`;
  if (state.logFilter !== "all" && type !== state.logFilter) entry.classList.add("log-hidden");
  $("logContainer").appendChild(entry);
  $("logContainer").scrollTop = $("logContainer").scrollHeight;
}

function esc(s) { return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function api(path, opts = {}) {
  const method = opts.method || "GET";
  log(`${method} ${path}`, "request");
  const t0 = performance.now();
  const res = await fetch(`${API}${path}`, opts);
  let body = {};
  try { body = await res.json(); } catch {}
  const dt = (performance.now() - t0).toFixed(0);
  if (!res.ok || body.ok === false) {
    log(`✗ ${res.status} — ${body.error || "unknown"} [${dt}ms]`, "error");
    throw new Error(body.error || `${res.status}`);
  }
  log(`✓ ${res.status} [${dt}ms]`, "success");
  return body;
}

function showOut(box, data) {
  box.classList.remove("hidden");
  if (typeof data === "string") box.innerHTML = data;
  else box.textContent = JSON.stringify(data, null, 2);
}

function fmt(label, value) {
  const s = typeof value === "string" && value.length > 32
    ? value.substring(0, 16) + "…" + value.substring(value.length - 8)
    : (value ?? "—");
  return `<span class="label">${esc(label)}:</span> <span class="val">${esc(String(s))}</span>`;
}

function copyable(val, len = 16) {
  if (!val) return "";
  const s = String(val);
  if (s.length <= len) return esc(s);
  return `<span class="copyable" data-full="${esc(s)}" title="Click to copy full text">${esc(s.substring(0, len))}…</span>`;
}

function btnLoad(btn, on) {
  if (on) { btn.classList.add("loading"); btn.disabled = true; }
  else { btn.classList.remove("loading"); btn.disabled = false; }
}

function genNonce() {
  return BigInt("0x" + crypto.getRandomValues(new Uint8Array(16))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")).toString();
}

// ── State Persistence ────────────────────────────────────────────────────────
function save() {
  if (!state.activeVoter) localStorage.removeItem(STORE);
  else localStorage.setItem(STORE, JSON.stringify(state.activeVoter));
}
function restore() {
  try {
    const r = localStorage.getItem(STORE);
    if (r) { const p = JSON.parse(r); if (p?.voterId) state.activeVoter = p; }
  } catch { localStorage.removeItem(STORE); }
}

// ── Tab Switching ────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
  document.querySelectorAll(".sub-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.parentElement.querySelectorAll(".sub-tab-btn").forEach(b => b.classList.remove("active"));
      btn.closest(".inspector-layout").querySelectorAll(".sub-tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $("subtab-" + btn.dataset.subtab).classList.add("active");
    });
  });
}

// ── Log Filters ──────────────────────────────────────────────────────────────
function initLogFilters() {
  document.querySelectorAll(".log-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".log-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.logFilter = btn.dataset.filter;
      document.querySelectorAll(".log-entry").forEach(entry => {
        if (state.logFilter === "all" || entry.dataset.type === state.logFilter) {
          entry.classList.remove("log-hidden");
        } else {
          entry.classList.add("log-hidden");
        }
      });
    });
  });
}

// ── Active Voter Display ─────────────────────────────────────────────────────
function renderActiveVoter() {
  const ind = $("activeVoterIndicator");
  const label = $("activeVoterLabel");
  const dot = ind.querySelector(".dot");
  if (state.activeVoter) {
    dot.className = "dot dot-on";
    label.textContent = `voter: ${state.activeVoter.identityTag || state.activeVoter.voterId.substring(0, 8)}`;
    $("castBtn").disabled = false;
    $("fakeKeyBtn").disabled = false;
    $("simProveBtn").disabled = false;
  } else {
    dot.className = "dot dot-off";
    label.textContent = "no active voter";
    $("castBtn").disabled = true;
    $("fakeKeyBtn").disabled = true;
    $("simProveBtn").disabled = true;
  }
}

// ── Protocol State ───────────────────────────────────────────────────────────
async function refreshState() {
  try {
    const e = await api("/api/election");
    state.election = e.election;
    $("stElectionId").textContent = e.election?.electionId || "—";
    $("stThreshold").textContent = e.election?.thresholdConfig
      ? `(${e.election.thresholdConfig.t}, ${e.election.thresholdConfig.n})` : "—";
    $("stGrace").textContent = e.election?.graceMinutes ? `${e.election.graceMinutes}min` : "—";
    const elDot = $("electionIndicator").querySelector(".dot");
    elDot.className = "dot dot-on";
    $("electionLabel").textContent = `election #${e.election.electionId}`;
    renderCandidates();
  } catch {
    $("stElectionId").textContent = "—";
    $("electionIndicator").querySelector(".dot").className = "dot dot-off";
    $("electionLabel").textContent = "no election";
  }
  try {
    const bb = await api("/api/bulletin-board");
    $("stMerkleRoot").textContent = bb.bulletinBoard?.merkleRoot || "—";
    $("stMerkleRoot").title = bb.bulletinBoard?.merkleRoot || "";
    $("stVoterCount").textContent = bb.bulletinBoard?.totalEntries || 0;
    if (bb.bulletinBoard?.merkleRoot) {
      log(`rt = ${String(bb.bulletinBoard.merkleRoot).substring(0, 24)}…`, "crypto");
    }
  } catch { $("stMerkleRoot").textContent = "—"; $("stVoterCount").textContent = "0"; }
  try {
    const st = await api("/api/votes/stats");
    $("stBallotCount").textContent = st.stats?.totalBallots || 0;
  } catch { $("stBallotCount").textContent = "0"; }
}

// ── Candidates ───────────────────────────────────────────────────────────────
function renderCandidates() {
  const el = $("candidateList");
  if (!state.election?.candidates?.length) {
    el.innerHTML = '<span class="dim">init election first</span>';
    return;
  }
  el.innerHTML = state.election.candidates.map((c, i) => `
    <label class="candidate-chip ${i === 0 ? 'selected' : ''}">
      <input type="radio" name="candidate" value="${c.id}" ${i === 0 ? 'checked' : ''} />
      ${esc(c.name)} <span class="dim">[${c.id}]</span>
    </label>`).join("");
  el.querySelectorAll("input[type=radio]").forEach(r => {
    r.addEventListener("change", () => {
      el.querySelectorAll(".candidate-chip").forEach(ch => ch.classList.remove("selected"));
      r.closest(".candidate-chip").classList.add("selected");
    });
  });
}

// ── Voter Table ──────────────────────────────────────────────────────────────
async function refreshVoterTable() {
  try {
    const data = await api("/api/admin/voters");
    state.voters = data.voters || [];
    const tbody = $("voterTableBody");
    if (!state.voters.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="dim">No voters registered.</td></tr>';
      return;
    }
    tbody.innerHTML = state.voters.map(v => {
      const isActive = state.activeVoter?.voterId === v.voterId;
      return `<tr class="${isActive ? 'voter-active' : ''}" data-vid="${esc(v.voterId)}">
        <td title="${esc(v.voterId)}">${esc(v.identityTag)}</td>
        <td>${esc(v.keyType)}${v.hasFakeKeys ? ' <span class="tag tag-err" style="margin-left:4px">FAKE AVLB</span>' : ''}</td>
        <td>${v.bbIndex}</td>
        <td>${v.hasSubmittedBallot ? '✓' : '—'}</td>
        <td><button class="btn btn-xs select-voter-btn ${isActive ? 'btn-alt' : 'btn-outline'}" data-voterid="${esc(v.voterId)}">${isActive ? 'ACTIVE' : 'SELECT'}</button></td>
      </tr>`;
    }).join("");

    // Attach event listeners dynamically to avoid inline onclick CSP issues
    tbody.querySelectorAll(".select-voter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        window.selectVoter(btn.dataset.voterid);
      });
    });
  } catch (err) { log(`Voter table: ${err.message}`, "error"); }
}

window.selectVoter = function(voterId) {
  const v = state.voters.find(x => x.voterId === voterId);
  if (!v) return;
  state.activeVoter = v;
  save();
  renderActiveVoter();
  refreshVoterTable();
  log(`Active voter → ${v.identityTag} (${v.voterId.substring(0, 8)}…)`, "system");
};

// ── Election Init ────────────────────────────────────────────────────────────
async function handleInitElection() {
  const t = $("initT").value;
  const n = $("initN").value;
  const grace = $("initGrace").value;
  btnLoad($("initElectionBtn"), true);
  try {
    await api("/api/election/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: +t, n: +n, graceMinutes: +grace, votingDurationMinutes: 1440 }),
    });
    log("Election initialised.", "success");
    await refreshState();
  } catch (err) { log(`Init failed: ${err.message}`, "error"); }
  finally { btnLoad($("initElectionBtn"), false); }
}

// ── Reset All ────────────────────────────────────────────────────────────────
async function handleReset() {
  if (!confirm("Wipe ALL data and start fresh?")) return;
  try {
    await api("/api/admin/reset", { method: "POST" });
    state.activeVoter = null;
    state.receipt = null;
    state.election = null;
    state.voters = [];
    save();
    renderActiveVoter();
    log("All data wiped.", "warn");
    await refreshState();
    await refreshVoterTable();
  } catch (err) { log(`Reset failed: ${err.message}`, "error"); }
}

// ── Register ─────────────────────────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  const tag = $("identityTag").value.trim();
  if (!tag) return;
  btnLoad($("registerBtn"), true);
  try {
    const data = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityTag: tag }),
    });
    // Auto-select as active voter
    state.activeVoter = {
      voterId: data.voter.voterId,
      identityTag: data.voter.identityTag,
      ckHash: data.castingKey.ckHash,
      ckHashE: data.castingKey.ckHashE,
      pkid: data.voter.pkid,
      keyType: data.castingKey.keyType,
    };
    save();
    renderActiveVoter();
    const lines = [
      `<span class="ok">✓ Registered: ${esc(data.voter.voterId)}</span>`,
      "", fmt("ckHash", data.castingKey.ckHash),
      fmt("ckHashE", data.castingKey.ckHashE),
      fmt("pkid", data.voter.pkid),
      fmt("keyType", data.castingKey.keyType),
      fmt("bbIndex", data.bulletinBoard?.bbIndex),
    ];
    showOut($("registerOut"), lines.join("\n"));
    log(`ckHash = ${(data.castingKey.ckHash || "").substring(0, 20)}…`, "crypto");
    $("identityTag").value = "";
    await refreshState();
    await refreshVoterTable();
  } catch (err) { showOut($("registerOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
  finally { btnLoad($("registerBtn"), false); }
}

// ── Commit ───────────────────────────────────────────────────────────────────
async function handleCommit() {
  if (!state.activeVoter?.ckHash || !state.activeVoter?.pkid) {
    showOut($("commitOut"), '<span class="err">Select a registered voter first.</span>');
    return;
  }
  const nonce = genNonce();
  try {
    const data = await api("/api/register/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ckHash: state.activeVoter.ckHash, pkid: state.activeVoter.pkid, nonce }),
    });
    const lines = [
      `<span class="ok">✓ Commit published</span>`,
      "", fmt("regCommit", data.regCommit), fmt("nonce", nonce),
      fmt("autoMatched", data.autoMatched), fmt("index", data.commitIndex),
    ];
    showOut($("commitOut"), lines.join("\n"));
    log(`regCommit = ${(data.regCommit || "").substring(0, 24)}…`, "crypto");
  } catch (err) { showOut($("commitOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── Cast Vote ────────────────────────────────────────────────────────────────
async function handleCast() {
  if (!state.activeVoter) { showOut($("voteOut"), '<span class="err">Select a voter first.</span>'); return; }
  const sel = document.querySelector('input[name="candidate"]:checked');
  if (!sel) { showOut($("voteOut"), '<span class="err">Pick a candidate.</span>'); return; }
  btnLoad($("castBtn"), true);
  log(`Groth16 proof gen for voter=${state.activeVoter.identityTag}, vote=${sel.value}`, "request");
  const t0 = performance.now();
  try {
    const data = await api("/api/votes/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voterId: state.activeVoter.voterId, vote: sel.value }),
    });
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    state.receipt = data.receipt;
    $("verifyBtn").disabled = false;
    const r = data.receipt || {};
    const lines = [
      `<span class="ok">✓ Ballot accepted</span> <span class="time">[${dt}s]</span>`,
      "", fmt("serialNumber", r.serialNumber), fmt("ballotId", r.ballotId),
      fmt("proofHash", r.proofHash || r.proof?.pi_a?.[0]?.substring(0, 32)),
      "", `<span class="label">sn = Poseidon(eId, ckHash, sk_id, σₑ)</span>`,
    ];
    showOut($("voteOut"), lines.join("\n"));
    log(`sn = ${(r.serialNumber || "").substring(0, 24)}…`, "crypto");
    log(`Proof: ${dt}s`, "success");
    await refreshState();
    await refreshVoterTable();
  } catch (err) { showOut($("voteOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
  finally { btnLoad($("castBtn"), false); }
}

// ── Verify Receipt ───────────────────────────────────────────────────────────
async function handleVerify() {
  if (!state.receipt?.serialNumber) { log("No receipt.", "warn"); return; }
  try {
    const d = await api(`/api/votes/receipt/${encodeURIComponent(state.receipt.serialNumber)}`);
    showOut($("voteOut"), `<span class="ok">✓ Receipt on board — status: ${d.receipt?.status}</span>`);
  } catch (err) { log(`Receipt verify: ${err.message}`, "error"); }
}

// ── Tally ────────────────────────────────────────────────────────────────────
async function handleTally() {
  try {
    const d = await api("/api/results/tally");
    const t = d.tally;
    let h = `<span class="ok">✓ Nullification Tally</span>\n\n`;
    h += `<span class="label">Real ballots:</span> <span class="val">${t.realBallots}</span>  `;
    h += `<span class="label">Fake:</span> <span class="warn">${t.fakeBallots}</span>  `;
    h += `<span class="label">Errors:</span> <span class="val">${t.decryptErrors}</span>\n\n`;
    h += `<table class="tally-table"><thead><tr><th>Candidate</th><th>Votes</th></tr></thead><tbody>`;
    (t.results||[]).forEach(r => { h += `<tr><td>${esc(r.candidateName)}</td><td class="vote-count">${r.votes}</td></tr>`; });
    h += `</tbody></table>`;
    showOut($("tallyOut"), h);
  } catch (err) { showOut($("tallyOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

async function handleLegacyTally() {
  try {
    const d = await api("/api/results/legacy-tally");
    showOut($("tallyOut"), JSON.stringify(d.tally, null, 2));
  } catch (err) { showOut($("tallyOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── Batch Register ───────────────────────────────────────────────────────────
async function handleBatchRegister() {
  const count = parseInt($("batchCount").value) || 3;
  btnLoad($("batchRegisterBtn"), true);
  showOut($("batchOut"), `Registering ${count} voters…`);
  let ok = 0;
  for (let i = 0; i < count; i++) {
    try {
      await api("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityTag: `batch-voter-${Date.now()}-${i}` }),
      });
      ok++;
    } catch {}
  }
  showOut($("batchOut"), `<span class="ok">✓ Registered ${ok}/${count} voters.</span>`);
  await refreshState();
  await refreshVoterTable();
  btnLoad($("batchRegisterBtn"), false);
}

// ── Batch Vote ───────────────────────────────────────────────────────────────
async function handleBatchVote() {
  if (!state.voters.length) { showOut($("batchOut"), '<span class="err">No voters to vote with.</span>'); return; }
  if (!state.election?.candidates?.length) { showOut($("batchOut"), '<span class="err">No election.</span>'); return; }
  btnLoad($("batchVoteBtn"), true);
  const candidates = state.election.candidates;
  let ok = 0, fail = 0;
  showOut($("batchOut"), `Casting votes for ${state.voters.length} voters…`);
  for (const v of state.voters) {
    if (v.hasSubmittedBallot) { continue; }
    const cid = candidates[Math.floor(Math.random() * candidates.length)].id;
    try {
      await api("/api/votes/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voterId: v.voterId, vote: cid }),
      });
      ok++;
    } catch { fail++; }
  }
  showOut($("batchOut"), `<span class="ok">✓ Voted: ${ok} success, ${fail} failed.</span>`);
  await refreshState();
  await refreshVoterTable();
  btnLoad($("batchVoteBtn"), false);
}

// ── Data Inspector: Merkle ───────────────────────────────────────────────────
async function refreshMerkle() {
  try {
    const d = await api("/api/bulletin-board");
    const bb = d.bulletinBoard;
    $("mkRoot").textContent = bb.merkleRoot || "—";
    $("mkRoot").title = bb.merkleRoot || "";
    $("mkDepth").textContent = bb.merkleDepth || 16;
    $("mkEntries").textContent = bb.totalEntries || 0;
    const tbody = $("merkleTableBody");
    if (!bb.entries?.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="dim">No entries.</td></tr>';
      return;
    }
    tbody.innerHTML = bb.entries.map((e, i) =>
      `<tr><td>${i}</td><td>${copyable(e.ckHash, 24)}</td><td>${copyable(e.pkid, 24)}</td></tr>`
    ).join("");
  } catch (err) { log(`Merkle: ${err.message}`, "error"); }
}

// ── Data Inspector: Ballots ──────────────────────────────────────────────────
async function refreshBallots() {
  try {
    const d = await api("/api/admin/raw/votes.json");
    const votes = d.data || [];
    const tbody = $("ballotTableBody");
    if (!votes.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="dim">No ballots.</td></tr>';
      return;
    }
    tbody.innerHTML = votes.map(v =>
      `<tr>
        <td>${copyable(v.ballotId, 12)}</td>
        <td>${copyable(v.serialNumber, 16)}</td>
        <td>${esc(v.status)}</td>
        <td>${copyable(v.voteCommitment, 16)}</td>
        <td><button class="btn btn-xs btn-outline inspect-ballot-btn" data-ballotid="${esc(v.ballotId)}">INSPECT</button></td>
      </tr>`
    ).join("");

    // Attach event listeners dynamically
    tbody.querySelectorAll(".inspect-ballot-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        window.inspectBallot(btn.dataset.ballotid);
      });
    });
  } catch (err) { log(`Ballots: ${err.message}`, "error"); }
}

// ── Data Inspector: Raw JSON ─────────────────────────────────────────────────
async function loadRawJson() {
  const file = $("rawFileSelect").value;
  try {
    const d = await api(`/api/admin/raw/${file}`);
    $("rawJsonOut").textContent = JSON.stringify(d.data, null, 2);
  } catch (err) { $("rawJsonOut").textContent = `Error: ${err.message}`; }
}

window.inspectBallot = async function(ballotId) {
  try {
    const d = await api(`/api/results/nullify/${ballotId}`);
    const cls = d.nullifiedToNonZero ? "ok" : "err";
    const statusText = d.nullifiedToNonZero ? "REAL VOTE (tallied for candidate " + esc(d.vote) + ")" : "FAKE KEY (discarded)";
    const lines = [
      `<span class="label">Nullification Audit for Ballot:</span> <span class="mono">${esc(ballotId)}</span>`, "",
      `<span class="dim">cm:</span> (${esc(d.cm[0])}, ${esc(d.cm[1])})`,
      `<span class="dim">cm*:</span> ${esc(String(d.cmStar).substring(0, 48))}...`,
      `<span class="${cls}">Verdict: ${statusText}</span>`
    ];
    const outBox = $("ballotInspectOut");
    showOut(outBox, lines.join("\n"));
    outBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) { showOut($("ballotInspectOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
};

// ── Audit ────────────────────────────────────────────────────────────────────
async function handleAudit() {
  try {
    const d = await api("/api/register/audit");
    const cls = d.censored ? "err" : "ok";
    const verdict = d.censored ? "⚠ CENSORSHIP DETECTED" : "✓ CLEAN";
    const lines = [
      `<span class="${cls}">${verdict}</span>`, "",
      `<span class="label">Commits:</span> <span class="val">${d.totalCommits}</span>`,
      `<span class="label">Matched:</span> <span class="val">${d.matchedCommits}</span>`,
      `<span class="label">Unmatched:</span> <span class="${d.unmatchedCommits?.length ? 'err' : 'val'}">${d.unmatchedCommits?.length || 0}</span>`,
      `<span class="label">Registrations w/o commit:</span> <span class="val">${d.registrationsWithoutCommit}</span>`,
    ];
    showOut($("auditOut"), lines.join("\n"));
  } catch (err) { showOut($("auditOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── πtotal ───────────────────────────────────────────────────────────────────
async function handleTotalProof() {
  try {
    const d = await api("/api/election/total-proof");
    const lines = [
      `<span class="ok">✓ πtotal proof generated & verified</span>`, "",
      fmt("nvReal", d.nvReal),
      fmt("cmAgg.C1.x", d.cmAgg?.C1?.x),
      fmt("cmStar.x", d.cmStar?.x),
      "", `<span class="label">Schnorr response k:</span> <span class="val">${String(d.proof?.k || "").substring(0, 32)}…</span>`,
    ];
    showOut($("totalProofOut"), lines.join("\n"));
  } catch (err) { showOut($("totalProofOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── Threshold Info ───────────────────────────────────────────────────────────
async function handleThresholdInfo() {
  try {
    const d = await api("/api/election/threshold-info");
    showOut($("thresholdOut"), JSON.stringify(d, null, 2));
  } catch (err) { showOut($("thresholdOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── Ballot Inspect ───────────────────────────────────────────────────────────
window.inspectBallot = async function(ballotId) {
  const isFromTable = !!ballotId;
  const targetId = ballotId || $("inspectBallotId")?.value?.trim();
  if (!targetId) {
    showOut($("inspectOut") || $("ballotInspectOut"), '<span class="err">Enter a ballot ID.</span>');
    return;
  }
  
  try {
    const d = await api(`/api/results/nullify/${encodeURIComponent(targetId)}`);
    const lines = [
      `<span class="${d.opensToVote ? 'ok' : 'warn'}">${esc(d.classification)}</span>`, "",
      fmt("ballotId", d.ballotId),
      fmt("serialNumber", d.serialNumber),
      fmt("opensToVote", d.opensToVote),
      fmt("opensToZero", d.opensToZero),
      "", fmt("nullified.x", d.nullifiedCommitment?.x),
    ];

    if (isFromTable) {
      const b1 = $("ballotInspectOut");
      if (b1) {
        showOut(b1, `<span class="label">Nullification Audit for </span><span class="mono">${copyable(targetId, 12)}</span>\n\n` + lines.join("\n"));
        b1.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      const b2 = $("inspectOut");
      if (b2) showOut(b2, `<span class="ok">✓ Automatically loaded from Ballot Board interaction</span>\n\n` + lines.join("\n"));
    } else {
      const b2 = $("inspectOut");
      if (b2) showOut(b2, lines.join("\n"));
      const b1 = $("ballotInspectOut");
      if (b1) showOut(b1, `<span class="ok">✓ Inspector Sync (Triggered via Audit Tab)</span>\n\n` + lines.join("\n"));
    }
  } catch (err) {
    const box = isFromTable ? $("ballotInspectOut") : $("inspectOut");
    if (box) showOut(box, `<span class="err">✗ ${esc(err.message)}</span>`);
  }
}

// ── Fake Key ─────────────────────────────────────────────────────────────────
async function handleFakeKey() {
  if (!state.activeVoter) return;
  try {
    const d = await api("/api/register/fake-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voterId: state.activeVoter.voterId }),
    });
    
    // Auto-swap active voter's keys to use this fake key
    state.activeVoter.ckHash = d.fakeKey.ckHash;
    state.activeVoter.ckHashE = d.fakeKey.ckHashE;
    save();

    const lines = [
      `<span class="ok">✓ Fake casting key issued and injected into Active Voter State!</span>`, "",
      fmt("ckHash", String(d.fakeKey?.ckHash).substring(0, 32) + "..."),
      fmt("keyType", d.fakeKey?.keyType),
      fmt("bbIndex", d.bulletinBoard?.bbIndex),
      "", `<span class="label">Your active voter is now carrying the FAKE key. Go Cast Ballot to test coercion.</span>`,
    ];
    showOut($("fakeKeyOut"), lines.join("\n"));
    await refreshVoterTable(); // Update table to show 'FAKE AVLB' badge
  } catch (err) { showOut($("fakeKeyOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── Sim Key Prove ────────────────────────────────────────────────────────────
async function handleSimProve() {
  const ckHash = $("simCkHash").value.trim();
  const claimedBit = $("simClaimedBit").value;
  if (!ckHash || !state.activeVoter) return;
  try {
    const d = await api("/api/register/sim-key-prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voterId: state.activeVoter.voterId, ckHash, claimedBit: +claimedBit }),
    });
    showOut($("simProveOut"), JSON.stringify(d, null, 2));
  } catch (err) { showOut($("simProveOut"), `<span class="err">✗ ${esc(err.message)}</span>`); }
}

// ── Attach All ───────────────────────────────────────────────────────────────
function attach() {
  $("initElectionBtn").addEventListener("click", handleInitElection);
  $("resetAllBtn").addEventListener("click", handleReset);
  $("registerForm").addEventListener("submit", handleRegister);
  $("commitBtn").addEventListener("click", handleCommit);
  $("castBtn").addEventListener("click", handleCast);
  $("verifyBtn").addEventListener("click", handleVerify);
  $("tallyBtn").addEventListener("click", handleTally);
  $("legacyTallyBtn").addEventListener("click", handleLegacyTally);
  $("batchRegisterBtn").addEventListener("click", handleBatchRegister);
  $("batchVoteBtn").addEventListener("click", handleBatchVote);
  $("refreshVotersBtn").addEventListener("click", refreshVoterTable);
  $("auditBtn").addEventListener("click", handleAudit);
  $("totalProofBtn").addEventListener("click", handleTotalProof);
  $("thresholdInfoBtn").addEventListener("click", handleThresholdInfo);
  $("inspectBallotBtn").addEventListener("click", () => inspectBallot());
  $("fakeKeyBtn").addEventListener("click", handleFakeKey);
  $("simProveBtn").addEventListener("click", handleSimProve);
  $("refreshMerkleBtn").addEventListener("click", refreshMerkle);
  $("refreshBallotsBtn").addEventListener("click", refreshBallots);
  $("loadRawBtn").addEventListener("click", loadRawJson);
  $("clearLogBtn").addEventListener("click", () => {
    $("logContainer").innerHTML = "";
    log("Log cleared.", "system");
  });
  $("fillActiveCkBtn").addEventListener("click", () => {
    if (state.activeVoter) $("simCkHash").value = state.activeVoter.ckHash;
  });

  // Global listener for copyables
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("copyable")) {
      const full = e.target.dataset.full;
      if (full) {
        navigator.clipboard.writeText(full).catch(()=>{});
        const orig = e.target.innerHTML;
        e.target.innerHTML = `<span style="color:var(--green)">📋 Copied!</span>`;
        setTimeout(() => { e.target.innerHTML = orig; }, 800);
      }
    }
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  initTabs();
  initLogFilters();
  attach();
  restore();
  renderActiveVoter();

  log("zkVoting Research Dashboard v3", "system");
  log("Circuit: enhanced_vote.circom · Poseidon(4) · Merkle depth 16 · 5459 constraints", "system");
  log("Improvements: I(πtotal) II(Threshold) III(Unlink) IV(FS) V(Censor) VI(Grace)", "system");

  try {
    const h = await api("/health");
    $("backendIndicator").querySelector(".dot").className = "dot dot-on";
    $("backendLabel").textContent = `online · ${new Date(h.timestamp).toLocaleTimeString("en-GB")}`;
  } catch {
    $("backendIndicator").querySelector(".dot").className = "dot dot-error";
    $("backendLabel").textContent = "offline";
    return;
  }

  await refreshState();
  await refreshVoterTable();
}

init();
