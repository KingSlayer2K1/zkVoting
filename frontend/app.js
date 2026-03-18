const API_BASE = "http://localhost:4000";
const STORAGE_KEY = "zkvoting_voter_state_v1";

const state = {
  election: null,
  voter: null,
  receipt: null,
};

const elements = {
  backendStatus: document.getElementById("backendStatus"),
  electionName: document.getElementById("electionName"),
  electionMeta: document.getElementById("electionMeta"),
  candidateOptions: document.getElementById("candidateOptions"),
  registerForm: document.getElementById("registerForm"),
  identityTag: document.getElementById("identityTag"),
  registerMessage: document.getElementById("registerMessage"),
  credentialBox: document.getElementById("credentialBox"),
  credentialText: document.getElementById("credentialText"),
  voteForm: document.getElementById("voteForm"),
  castButton: document.getElementById("castButton"),
  voteMessage: document.getElementById("voteMessage"),
  receiptBox: document.getElementById("receiptBox"),
  receiptText: document.getElementById("receiptText"),
  verifyReceiptButton: document.getElementById("verifyReceiptButton"),
  receiptVerifyMessage: document.getElementById("receiptVerifyMessage"),
  statsText: document.getElementById("statsText"),
  refreshStatsButton: document.getElementById("refreshStatsButton"),
  loadTallyButton: document.getElementById("loadTallyButton"),
  tallyContainer: document.getElementById("tallyContainer"),
};

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    // Keep body as {} if server returns non-JSON.
  }

  if (!response.ok || body.ok === false) {
    const message = body.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return body;
}

function setStatusBadge(text, variant) {
  elements.backendStatus.textContent = text;
  elements.backendStatus.classList.remove("neutral", "ok", "bad");
  elements.backendStatus.classList.add(variant);
}

function renderElection() {
  if (!state.election) {
    elements.electionName.textContent = "Election unavailable";
    elements.electionMeta.textContent = "";
    elements.candidateOptions.innerHTML = "";
    return;
  }

  elements.electionName.textContent = `${state.election.name} (#${state.election.electionId})`;
  elements.electionMeta.textContent = `${state.election.candidates.length} candidates available`;

  const options = state.election.candidates
    .map(
      (candidate, index) => `
        <label class="optionRow">
          <input
            type="radio"
            name="candidate"
            value="${candidate.id}"
            ${index === 0 ? "checked" : ""}
          />
          <span>${candidate.name} (ID ${candidate.id})</span>
        </label>
      `,
    )
    .join("");

  elements.candidateOptions.innerHTML = options;
}

function saveVoterState() {
  if (!state.voter) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.voter));
}

function loadVoterState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.voterId && parsed.privateCredentials) {
      state.voter = parsed;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function renderVoter() {
  if (!state.voter) {
    elements.credentialBox.classList.add("hidden");
    elements.castButton.disabled = true;
    return;
  }

  elements.credentialBox.classList.remove("hidden");
  elements.castButton.disabled = false;
  elements.credentialText.textContent = JSON.stringify(
    {
      voterId: state.voter.voterId,
      identityTag: state.voter.identityTag,
      privateCredentials: state.voter.privateCredentials,
    },
    null,
    2,
  );
}

async function checkBackend() {
  try {
    const health = await apiRequest("/health");
    setStatusBadge(
      `Backend healthy (${new Date(health.timestamp).toLocaleTimeString()})`,
      "ok",
    );
  } catch (error) {
    setStatusBadge(`Backend unavailable: ${error.message}`, "bad");
  }
}

async function loadElection() {
  const body = await apiRequest("/api/election");
  state.election = body.election;
  renderElection();
}

async function refreshStats() {
  try {
    const body = await apiRequest("/api/votes/stats");
    elements.statsText.textContent = JSON.stringify(body.stats, null, 2);
  } catch (error) {
    elements.statsText.textContent = `Failed to load stats: ${error.message}`;
  }
}

async function loadTally() {
  elements.tallyContainer.textContent = "Loading tally...";
  try {
    const body = await apiRequest("/api/results/tally");
    const tally = body.tally;

    const rows = tally.results
      .map(
        (entry) =>
          `<tr><td>${entry.candidateName}</td><td>${entry.votes}</td></tr>`,
      )
      .join("");

    elements.tallyContainer.innerHTML = `
      <p><strong>Valid Tallied Votes:</strong> ${tally.validTalliedVotes}</p>
      <p><strong>Accepted Ballots:</strong> ${tally.acceptedBallots}</p>
      <p><strong>Invalid Encrypted Records:</strong> ${tally.invalidEncryptedRecords}</p>
      <table>
        <thead><tr><th>Candidate</th><th>Votes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (error) {
    elements.tallyContainer.textContent = `Failed to load tally: ${error.message}`;
  }
}

async function verifyReceipt() {
  if (!state.receipt?.serialNumber) {
    elements.receiptVerifyMessage.textContent = "No receipt available yet.";
    return;
  }

  try {
    const body = await apiRequest(
      `/api/votes/receipt/${encodeURIComponent(state.receipt.serialNumber)}`,
    );
    elements.receiptVerifyMessage.textContent = `Receipt found on board. Status: ${body.receipt.status}`;
  } catch (error) {
    elements.receiptVerifyMessage.textContent = `Receipt verification failed: ${error.message}`;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  elements.registerMessage.textContent = "Registering voter...";

  const identityTag = elements.identityTag.value.trim();
  if (!identityTag) {
    elements.registerMessage.textContent = "identityTag is required.";
    return;
  }

  try {
    const body = await apiRequest("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityTag }),
    });

    state.voter = {
      voterId: body.voter.voterId,
      identityTag: body.voter.identityTag,
      privateCredentials: body.privateCredentials,
    };

    saveVoterState();
    renderVoter();
    elements.registerMessage.textContent = "Registration successful.";
    await refreshStats();
  } catch (error) {
    elements.registerMessage.textContent = `Registration failed: ${error.message}`;
  }
}

async function handleVote(event) {
  event.preventDefault();
  elements.voteMessage.textContent = "Casting vote with proof generation...";
  elements.receiptVerifyMessage.textContent = "";

  if (!state.voter) {
    elements.voteMessage.textContent = "Register first.";
    return;
  }

  const selected = document.querySelector('input[name="candidate"]:checked');
  if (!selected) {
    elements.voteMessage.textContent = "Select a candidate first.";
    return;
  }

  try {
    const body = await apiRequest("/api/votes/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voterId: state.voter.voterId,
        vote: selected.value,
      }),
    });

    state.receipt = body.receipt;
    elements.voteMessage.textContent = body.message;
    elements.receiptBox.classList.remove("hidden");
    elements.receiptText.textContent = JSON.stringify(state.receipt, null, 2);
    elements.castButton.disabled = true;
    await refreshStats();
    await loadTally();
  } catch (error) {
    elements.voteMessage.textContent = `Vote failed: ${error.message}`;
  }
}

function attachHandlers() {
  elements.registerForm.addEventListener("submit", handleRegister);
  elements.voteForm.addEventListener("submit", handleVote);
  elements.refreshStatsButton.addEventListener("click", refreshStats);
  elements.loadTallyButton.addEventListener("click", loadTally);
  elements.verifyReceiptButton.addEventListener("click", verifyReceipt);
}

async function init() {
  attachHandlers();
  loadVoterState();
  renderVoter();
  await checkBackend();
  await loadElection();
  await refreshStats();
}

init();

