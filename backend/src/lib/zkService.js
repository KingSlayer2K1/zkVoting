const fs = require("fs/promises");
const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
const WASM_PATH = path.join(
  ROOT_DIR,
  "circuits",
  "build",
  "vote_validity_js",
  "vote_validity.wasm",
);
const ZKEY_PATH = path.join(
  ROOT_DIR,
  "circuits",
  "keys",
  "vote_validity_final.zkey",
);
const VERIFICATION_KEY_PATH = path.join(
  ROOT_DIR,
  "circuits",
  "keys",
  "verification_key.json",
);

let poseidonInstancePromise;
let verificationKeyPromise;

function toBigInt(value) {
  return BigInt(String(value));
}

function toStringArray(values) {
  return values.map((value) => String(value));
}

async function getPoseidon() {
  if (!poseidonInstancePromise) {
    poseidonInstancePromise = buildPoseidon();
  }
  return poseidonInstancePromise;
}

async function loadVerificationKey() {
  if (!verificationKeyPromise) {
    verificationKeyPromise = fs
      .readFile(VERIFICATION_KEY_PATH, "utf8")
      .then((raw) => JSON.parse(raw));
  }
  return verificationKeyPromise;
}

async function poseidonHash(values) {
  const poseidon = await getPoseidon();
  const field = poseidon.F;
  const hash = poseidon(values.map(toBigInt));
  return field.toString(hash);
}

function toCandidateIdList(election) {
  return election.candidates.map((candidate) => String(candidate.id));
}

async function computeSerialNumber({ electionId, castingKey, voterSecret }) {
  return poseidonHash([electionId, castingKey, voterSecret]);
}

async function computeVoteCommitment({ vote, voteSalt }) {
  return poseidonHash([vote, voteSalt]);
}

async function computePublicSignals({
  electionId,
  candidateList,
  serialNumber,
  voteCommitment,
}) {
  return toStringArray([
    electionId,
    ...candidateList,
    serialNumber,
    voteCommitment,
  ]);
}

function assertArtifactsExist() {
  return Promise.all([
    fs.access(WASM_PATH),
    fs.access(ZKEY_PATH),
    fs.access(VERIFICATION_KEY_PATH),
  ]);
}

async function generateProof(input) {
  await assertArtifactsExist();
  return snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
}

async function verifyProof(publicSignals, proof) {
  const verificationKey = await loadVerificationKey();
  return snarkjs.groth16.verify(verificationKey, publicSignals, proof);
}

async function validatePublicSignalLayout({
  publicSignals,
  election,
  serialNumber,
  voteCommitment,
}) {
  const candidateList = toCandidateIdList(election);
  const expected = await computePublicSignals({
    electionId: election.electionId,
    candidateList,
    serialNumber,
    voteCommitment,
  });

  if (!Array.isArray(publicSignals)) {
    return {
      ok: false,
      error: "publicSignals must be an array.",
    };
  }

  if (publicSignals.length !== expected.length) {
    return {
      ok: false,
      error: `publicSignals length mismatch. Expected ${expected.length}, got ${publicSignals.length}.`,
    };
  }

  const normalized = publicSignals.map((value) => String(value));
  for (let i = 0; i < expected.length; i += 1) {
    if (normalized[i] !== expected[i]) {
      return {
        ok: false,
        error: `publicSignals mismatch at index ${i}.`,
      };
    }
  }

  return {
    ok: true,
  };
}

module.exports = {
  toCandidateIdList,
  computeSerialNumber,
  computeVoteCommitment,
  computePublicSignals,
  generateProof,
  verifyProof,
  validatePublicSignalLayout,
};

