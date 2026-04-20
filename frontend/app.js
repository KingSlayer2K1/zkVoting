/* ═══════════════════════════════════════════════════════════════════════════
   zkVoting — Protocol Dashboard (Research PoC)
   ═══════════════════════════════════════════════════════════════════════════ */

const API = "http://localhost:4000";
const STORE_KEY = "zkvoting_state_v3";

const state = { election: null, voter: null, receipt: null };

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const el = {
  backendDot:    () => $("backendIndicator").querySelector(".dot"),
  backendLabel:  $("backendLabel"),
  electionDot:   () => $("electionIndicator").querySelector(".dot"),
  electionLabel: $("electionLabel"),
  stateElection: $("stateElectionId"),
  stateMerkle:   $("stateMerkleRoot"),
  stateVoters:   $("stateVoterCount"),
  stateBallots:  $("stateBallotCount"),
  stateThreshold:$("stateThreshold"),
  stateGrace:    $("stateGrace"),
  registerForm:  $("registerForm"),
  registerBtn:   $("registerBtn"),
  identityTag:   $("identityTag"),
  registerOut:   $("registerOutput"),
  commitForm:    $("commitForm"),
  commitCkHash:  $("commitCkHash"),
  commitPkid:    $("commitPkid"),
  commitOut:     $("commitOutput"),
  candidateList: $("candidateList"),
  castBtn:       $("castBtn"),
  verifyBtn:     $("verifyBtn"),
  voteOut:       $("voteOutput"),
  auditBtn:      $("auditBtn"),
  totalProofBtn: $("totalProofBtn"),
  auditOut:      $("auditOutput"),
  tallyBtn:      $("tallyBtn"),
  legacyTallyBtn:$("legacyTallyBtn"),
  tallyOut:      $("tallyOutput"),
  logContainer:  $("logContainer"),
  clearLogBtn:   $("clearLogBtn"),
};

// ── Logger ───────────────────────────────────────────────────────────────────
function log(msg, type = "system") {
  const now = new Date();
  const ts = now.toLocaleTimeString("en-GB", { hour12: false });
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `<span class="log-time">${ts}</span><span class="log-msg">${msg}</span>`;
  el.logContainer.appendChild(entry);
  el.logContainer.scrollTop = el.logContainer.scrollHeight;
}

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const method = opts.method || "GET";
  log(`${method} ${path}`, "request");
  const t0 = performance.now();

  const res = await fetch(`${API}${path}`, opts);
  let body = {};
  try { body = await res.json(); } catch {}

  const dt = (performance.now() - t0).toFixed(0);

  if (!res.ok || body.ok === false) {
    log(`✗ ${res.status} — ${body.error || "unknown error"} [${dt}ms]`, "error");
    throw new Error(body.error || `${res.status}`);
  }

  log(`✓ ${res.status} [${dt}ms]`, "success");
  return body;
}

// ── Output Box Helpers ───────────────────────────────────────────────────────
function showOutput(box, data) {
  box.classList.remove("hidden");
  if (typeof data === "string") {
    box.innerHTML = data;
  } else {
    box.textContent = JSON.stringify(data, null, 2);
  }
}

function formatCrypto(label, value) {
  const short = typeof value === "string" && value.length > 32
    ? value.substring(0, 16) + "…" + value.substring(value.length - 8)
    : value;
  return `<span class="label">${label}:</span> <span class="val">${short}</span>`;
}

function btnLoad(btn, on) {
  if (on) { btn.classList.add("loading"); btn.disabled = true; }
  else    { btn.classList.remove("loading"); btn.disabled = false; }
}

// ── State Persistence ────────────────────────────────────────────────────────
function save() {
  if (!state.voter) { localStorage.removeItem(STORE_KEY); return; }
  localStorage.setItem(STORE_KEY, JSON.stringify(state.voter));
}

function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.voterId) state.voter = p;
    }
  } catch { localStorage.removeItem(STORE_KEY); }
}

// ── Protocol State Update ────────────────────────────────────────────────────
async function refreshProtocolState() {
  try {
    const eData = await api("/api/election");
    state.election = eData.election;
    el.stateElection.textContent = eData.election?.electionId || "—";
    el.stateThreshold.textContent = eData.election?.threshold
      ? `(${eData.election.threshold.t}, ${eData.election.threshold.n})`
      : "—";

    const elDot = el.electionDot();
    elDot.className = "dot dot-on";
    el.electionLabel.textContent = `election #${eData.election.electionId}`;

    // Grace period
    el.stateGrace.textContent = eData.election?.graceMinutes
      ? `${eData.election.graceMinutes} min (hidden)`
      : "not configured";
  } catch {
    el.stateElection.textContent = "—";
    const elDot = el.electionDot();
    elDot.className = "dot dot-off";
    el.electionLabel.textContent = "no election";
  }

  // Bulletin board
  try {
    const bb = await api("/api/bulletin-board");
    const root = bb.bulletinBoard?.merkleRoot || "—";
    el.stateMerkle.textContent = root;
    el.stateMerkle.title = root;
    el.stateVoters.textContent = bb.bulletinBoard?.totalEntries || 0;
    log(`Merkle root: ${typeof root === "string" ? root.substring(0, 24) : root}…`, "crypto");
  } catch {
    el.stateMerkle.textContent = "—";
    el.stateVoters.textContent = "0";
  }

  // Stats
  try {
    const st = await api("/api/votes/stats");
    el.stateBallots.textContent = st.stats?.totalBallots || 0;
  } catch {
    el.stateBallots.textContent = "0";
  }

  // Candidates
  renderCandidates();
}

// ── Render Candidates ────────────────────────────────────────────────────────
function renderCandidates() {
  if (!state.election?.candidates?.length) {
    el.candidateList.innerHTML = '<span class="dim">no candidates — init election first</span>';
    return;
  }
  el.candidateList.innerHTML = state.election.candidates.map((c, i) => `
    <label class="candidate-chip ${i === 0 ? 'selected' : ''}">
      <input type="radio" name="candidate" value="${c.id}" ${i === 0 ? 'checked' : ''} />
      ${c.name} <span class="dim">[${c.id}]</span>
    </label>
  `).join("");

  // Selection styling
  el.candidateList.querySelectorAll("input[type=radio]").forEach(radio => {
    radio.addEventListener("change", () => {
      el.candidateList.querySelectorAll(".candidate-chip").forEach(ch => ch.classList.remove("selected"));
      radio.closest(".candidate-chip").classList.add("selected");
    });
  });
}

// ── Render Voter State ───────────────────────────────────────────────────────
function renderVoter() {
  if (!state.voter) {
    el.castBtn.disabled = true;
    el.verifyBtn.disabled = true;
    el.commitCkHash.value = "";
    el.commitPkid.value = "";
    return;
  }
  el.castBtn.disabled = false;
  el.commitCkHash.value = state.voter.castingKey?.ckHash || "";
  el.commitPkid.value = state.voter.pkid || "";
}

// ── HANDLERS ─────────────────────────────────────────────────────────────────

// Register
async function handleRegister(e) {
  e.preventDefault();
  const tag = el.identityTag.value.trim();
  if (!tag) return;

  btnLoad(el.registerBtn, true);
  log(`Registering voter: "${tag}"`, "request");

  try {
    const data = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityTag: tag }),
    });

    state.voter = {
      voterId: data.voter.voterId,
      identityTag: data.voter.identityTag,
      castingKey: data.castingKey,
      pkid: data.voter.pkid,
      voterSecret: data.privateCredentials?.voterSecret,
    };
    save();
    renderVoter();

    const ck = data.castingKey || {};
    const lines = [
      `<span class="ok">✓ Voter registered: ${data.voter.voterId}</span>`,
      "",
      formatCrypto("ckHash", ck.ckHash),
      formatCrypto("ckHashE (election-scoped)", ck.ckHashE),
      formatCrypto("pkid", data.voter.pkid),
      formatCrypto("voterSecret", data.privateCredentials?.voterSecret),
      formatCrypto("keyType", ck.keyType),
      "",
      `<span class="label">Merkle leaf:</span> <span class="val">Poseidon(ckHashₑ, pkid)</span>`,
      `<span class="label">BB index:</span> <span class="val">${data.bulletinBoard?.bbIndex}</span>`,
    ];
    showOutput(el.registerOut, lines.join("\n"));

    log(`ckHash = ${(ck.ckHash || "").substring(0, 20)}…`, "crypto");
    log(`pkid   = ${(data.voter.pkid || "").substring(0, 20)}…`, "crypto");

    await refreshProtocolState();
  } catch (err) {
    showOutput(el.registerOut, `<span class="err">✗ ${err.message}</span>`);
  } finally {
    btnLoad(el.registerBtn, false);
  }
}

// Commit (Improvement V)
async function handleCommit(e) {
  e.preventDefault();
  const ckHash = el.commitCkHash.value.trim();
  const pkid = el.commitPkid.value.trim();
  if (!ckHash || !pkid) {
    showOutput(el.commitOut, '<span class="err">Register first to get ckHash and pkid.</span>');
    return;
  }

  // Generate a random nonce for the commitment
  const nonce = BigInt("0x" + crypto.getRandomValues(new Uint8Array(16))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")).toString();

  log(`Publishing registration commit (nonce=${nonce.substring(0, 12)}…)`, "request");

  try {
    const data = await api("/api/register/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ckHash, pkid, nonce }),
    });

    const lines = [
      `<span class="ok">✓ Commit published to append-only log</span>`,
      "",
      formatCrypto("regCommit", data.regCommit),
      formatCrypto("nonce", nonce),
      formatCrypto("commitIndex", data.commitIndex),
      `<span class="label">timestamp:</span> <span class="val">${data.timestamp}</span>`,
      "",
      `<span class="label">Formula:</span> <span class="val">regCommit = Poseidon(ckHash, pkid, nonce)</span>`,
      `<span class="label">Note:</span> <span class="val">Save nonce for reveal phase verification.</span>`,
    ];
    showOutput(el.commitOut, lines.join("\n"));
    log(`regCommit = ${(data.regCommit || "").substring(0, 24)}…`, "crypto");
  } catch (err) {
    showOutput(el.commitOut, `<span class="err">✗ ${err.message}</span>`);
  }
}

// Cast Vote
async function handleCast() {
  if (!state.voter) {
    showOutput(el.voteOut, '<span class="err">Register first.</span>');
    return;
  }
  const selected = document.querySelector('input[name="candidate"]:checked');
  if (!selected) {
    showOutput(el.voteOut, '<span class="err">Select a candidate.</span>');
    return;
  }

  btnLoad(el.castBtn, true);
  log(`Generating Groth16 proof for vote=${selected.value}…`, "request");
  log(`Circuit: enhanced_vote.circom · 5216 non-linear constraints · Poseidon(4) snHasher`, "system");

  const t0 = performance.now();

  try {
    const data = await api("/api/votes/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voterId: state.voter.voterId, vote: selected.value }),
    });

    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    state.receipt = data.receipt;
    el.verifyBtn.disabled = false;

    const r = data.receipt || {};
    const lines = [
      `<span class="ok">✓ Ballot accepted</span> <span class="time">[proof: ${dt}s]</span>`,
      "",
      formatCrypto("serialNumber (sn)", r.serialNumber),
      formatCrypto("proofHash", r.proofHash || r.proof?.pi_a?.[0]?.substring(0, 32)),
      formatCrypto("commitment (cm)", r.commitment),
      "",
      `<span class="label">sn = Poseidon(eId, ckHashₑ, sk_id, σₑ)</span>`,
      `<span class="label">σₑ generated ephemerally — delete after voting for forward secrecy</span>`,
    ];
    showOutput(el.voteOut, lines.join("\n"));

    log(`sn = ${(r.serialNumber || "").substring(0, 24)}…`, "crypto");
    log(`Proof generation: ${dt}s`, "success");

    await refreshProtocolState();
  } catch (err) {
    showOutput(el.voteOut, `<span class="err">✗ ${err.message}</span>`);
  } finally {
    btnLoad(el.castBtn, false);
  }
}

// Verify Receipt
async function handleVerify() {
  if (!state.receipt?.serialNumber) {
    log("No receipt to verify.", "warn");
    return;
  }
  try {
    const data = await api(`/api/votes/receipt/${encodeURIComponent(state.receipt.serialNumber)}`);
    log(`Receipt verified on bulletin board. Status: ${data.receipt?.status}`, "success");
    showOutput(el.voteOut, `<span class="ok">✓ Receipt found on board — status: ${data.receipt?.status}</span>`);
  } catch (err) {
    log(`Receipt verification failed: ${err.message}`, "error");
  }
}

// Audit (Improvement V)
async function handleAudit() {
  log("Running censorship audit: comparing commit log against Merkle tree…", "request");

  try {
    const data = await api("/api/register/audit");
    const verdict = data.censored ? "⚠ CENSORSHIP DETECTED" : "✓ CLEAN — no censorship";
    const cls = data.censored ? "err" : "ok";

    const lines = [
      `<span class="${cls}">${verdict}</span>`,
      "",
      `<span class="label">Total commits in log:</span>      <span class="val">${data.totalCommits}</span>`,
      `<span class="label">Matched in Merkle tree:</span>     <span class="val">${data.matchedCommits}</span>`,
      `<span class="label">Unmatched (censored):</span>       <span class="${data.unmatchedCommits?.length ? 'err' : 'val'}">${data.unmatchedCommits?.length || 0}</span>`,
      `<span class="label">Registrations without commit:</span> <span class="val">${data.registrationsWithoutCommit}</span>`,
    ];

    if (data.unmatchedCommits?.length) {
      lines.push("", '<span class="warn">Censored commits:</span>');
      data.unmatchedCommits.forEach(c => {
        lines.push(`  <span class="err">• ${c.commitHash?.substring(0, 32)}…</span>`);
      });
    }

    showOutput(el.auditOut, lines.join("\n"));
    log(verdict, data.censored ? "error" : "success");
  } catch (err) {
    showOutput(el.auditOut, `<span class="err">✗ ${err.message}</span>`);
  }
}

// πtotal Proof
async function handleTotalProof() {
  log("Fetching πtotal eligibility proof (DLEQ Schnorr)…", "request");

  try {
    const data = await api("/api/election/total-proof");
    showOutput(el.auditOut, JSON.stringify(data, null, 2));
    log(`πtotal verified: ${data.verified ? "VALID" : "INVALID"}`, data.verified ? "success" : "error");
  } catch (err) {
    showOutput(el.auditOut, `<span class="err">✗ ${err.message}</span>`);
  }
}

// Tally
async function handleTally() {
  log("Computing nullification tally: Nullify(msk, cm) for all ballots…", "request");

  try {
    const data = await api("/api/results/tally");
    const t = data.tally;

    let html = `<span class="ok">✓ Tally complete</span>\n\n`;
    html += `<span class="label">Valid votes:</span>   <span class="val">${t.validTalliedVotes}</span>\n`;
    html += `<span class="label">Total ballots:</span> <span class="val">${t.acceptedBallots}</span>\n`;
    html += `<span class="label">Invalid:</span>       <span class="${t.invalidEncryptedRecords ? 'warn' : 'val'}">${t.invalidEncryptedRecords}</span>\n\n`;

    html += `<table class="tally-table">`;
    html += `<thead><tr><th>Candidate</th><th>Votes</th></tr></thead><tbody>`;
    (t.results || []).forEach(r => {
      html += `<tr><td>${r.candidateName}</td><td class="vote-count">${r.votes}</td></tr>`;
    });
    html += `</tbody></table>`;

    showOutput(el.tallyOut, html);
    log(`Tally: ${t.validTalliedVotes} valid votes across ${t.results?.length} candidates`, "success");
  } catch (err) {
    showOutput(el.tallyOut, `<span class="err">✗ ${err.message}</span>`);
  }
}

// Legacy Tally
async function handleLegacyTally() {
  log("Fetching legacy (non-nullification) tally…", "request");
  try {
    const data = await api("/api/results/legacy-tally");
    showOutput(el.tallyOut, JSON.stringify(data, null, 2));
  } catch (err) {
    showOutput(el.tallyOut, `<span class="err">✗ ${err.message}</span>`);
  }
}

// ── ATTACH ───────────────────────────────────────────────────────────────────
function attach() {
  el.registerForm.addEventListener("submit", handleRegister);
  el.commitForm.addEventListener("submit", handleCommit);
  el.castBtn.addEventListener("click", handleCast);
  el.verifyBtn.addEventListener("click", handleVerify);
  el.auditBtn.addEventListener("click", handleAudit);
  el.totalProofBtn.addEventListener("click", handleTotalProof);
  el.tallyBtn.addEventListener("click", handleTally);
  el.legacyTallyBtn.addEventListener("click", handleLegacyTally);
  el.clearLogBtn.addEventListener("click", () => {
    el.logContainer.innerHTML = "";
    log("Log cleared.", "system");
  });
}

// ── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  attach();
  restore();
  renderVoter();

  log("zkVoting Protocol Dashboard v2.0", "system");
  log("Circuit: enhanced_vote.circom · Poseidon(4) · Merkle depth 16", "system");
  log("Improvements: I(πtotal) II(Threshold) III(Unlink) IV(FS) V(Censor) VI(Grace)", "system");

  // Backend check
  try {
    const h = await api("/health");
    el.backendDot().className = "dot dot-on";
    el.backendLabel.textContent = `backend online · ${new Date(h.timestamp).toLocaleTimeString("en-GB")}`;
    log(`Backend: ${h.service}`, "success");
  } catch {
    el.backendDot().className = "dot dot-error";
    el.backendLabel.textContent = "backend offline";
    log("Backend connection failed.", "error");
    return;
  }

  await refreshProtocolState();
}

init();
