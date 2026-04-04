/**
 * ZK service — proof generation and verification.
 *
 * Enhanced to support the new public signal layout from enhanced_vote.circom:
 *
 *   [0]       electionId
 *   [1..5]    candidateList[0..4]
 *   [6]       serialNumber
 *   [7]       voteCommitment
 *   [8]       publicKey      ← NEW: pkid = H(voterSecret)
 *   [9]       merkleRoot     ← NEW: Merkle root of the casting-key set
 *
 * The circuit artifacts (wasm + zkey) for the enhanced circuit must be
 * compiled before using generateProof.  See circuits/README.md for the
 * compilation and trusted-setup steps.
 *
 * Falls back to the original vote_validity circuit for legacy ballots.
 */

"use strict";

const fs   = require("fs/promises");
const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");

// ── Artifact paths ────────────────────────────────────────────────────────────
//
// Primary: enhanced_vote (supports pkid + Merkle membership)
// Fallback: vote_validity (original, for backwards compatibility)

const ENHANCED = {
  WASM: path.join(ROOT_DIR, "circuits", "build", "enhanced_vote_js", "enhanced_vote.wasm"),
  ZKEY: path.join(ROOT_DIR, "circuits", "keys",  "enhanced_vote_final.zkey"),
  VKEY: path.join(ROOT_DIR, "circuits", "keys",  "enhanced_verification_key.json"),
};

const LEGACY = {
  WASM: path.join(ROOT_DIR, "circuits", "build", "vote_validity_js", "vote_validity.wasm"),
  ZKEY: path.join(ROOT_DIR, "circuits", "keys",  "vote_validity_final.zkey"),
  VKEY: path.join(ROOT_DIR, "circuits", "keys",  "verification_key.json"),
};

// ── Lazy singletons ───────────────────────────────────────────────────────────

let _poseidonPromise = null;
let _enhancedVkeyPromise = null;
let _legacyVkeyPromise   = null;
let _useEnhanced = null; // null means "not yet checked"

function getPoseidon() {
  if (!_poseidonPromise) _poseidonPromise = buildPoseidon();
  return _poseidonPromise;
}

async function detectCircuit() {
  if (_useEnhanced !== null) return _useEnhanced;
  try {
    await fs.access(ENHANCED.WASM);
    await fs.access(ENHANCED.ZKEY);
    await fs.access(ENHANCED.VKEY);
    _useEnhanced = true;
  } catch {
    _useEnhanced = false;
  }
  return _useEnhanced;
}

async function loadVerificationKey() {
  const useEnhanced = await detectCircuit();
  if (useEnhanced) {
    if (!_enhancedVkeyPromise) {
      _enhancedVkeyPromise = fs
        .readFile(ENHANCED.VKEY, "utf8")
        .then((r) => JSON.parse(r));
    }
    return _enhancedVkeyPromise;
  } else {
    if (!_legacyVkeyPromise) {
      _legacyVkeyPromise = fs
        .readFile(LEGACY.VKEY, "utf8")
        .then((r) => JSON.parse(r));
    }
    return _legacyVkeyPromise;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBigInt(v) { return BigInt(String(v)); }
function toStringArray(vals) { return vals.map((v) => String(v)); }

async function poseidonHash(values) {
  const p = await getPoseidon();
  return p.F.toString(p(values.map(toBigInt)));
}

function toCandidateIdList(election) {
  return election.candidates.map((c) => String(c.id));
}

// ── Public signal computation ─────────────────────────────────────────────────

/**
 * Compute the expected public signal array for the enhanced circuit.
 *
 * Layout (10 signals for 5 candidates):
 *   [0]    electionId
 *   [1..5] candidateList[0..4]
 *   [6]    serialNumber
 *   [7]    voteCommitment
 *   [8]    publicKey   (pkid = H(voterSecret))
 *   [9]    merkleRoot
 */
async function computePublicSignals({
  electionId,
  candidateList,
  serialNumber,
  voteCommitment,
  publicKey,
  merkleRoot,
}) {
  return toStringArray([
    electionId,
    ...candidateList,
    serialNumber,
    voteCommitment,
    ...(publicKey  !== undefined ? [publicKey]  : []),
    ...(merkleRoot !== undefined ? [merkleRoot] : []),
  ]);
}

/** Compute serial number using ckHash (enhanced) or castingKey scalar (legacy). */
async function computeSerialNumber({ electionId, castingKey, voterSecret, ckHash }) {
  const key = ckHash ?? castingKey; // prefer ckHash for the enhanced path
  return poseidonHash([electionId, key, voterSecret]);
}

async function computeVoteCommitment({ vote, voteSalt }) {
  return poseidonHash([vote, voteSalt]);
}

// ── Proof generation ──────────────────────────────────────────────────────────

async function generateProof(input) {
  const useEnhanced = await detectCircuit();
  const artifacts   = useEnhanced ? ENHANCED : LEGACY;

  await Promise.all([fs.access(artifacts.WASM), fs.access(artifacts.ZKEY)]);

  console.log(
    `[zkService] Generating proof with ${useEnhanced ? "enhanced" : "legacy"} circuit.`
  );
  return snarkjs.groth16.fullProve(input, artifacts.WASM, artifacts.ZKEY);
}

async function verifyProof(publicSignals, proof) {
  const vkey = await loadVerificationKey();
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// ── Public signal layout validation ─────────────────────────────────────────

/**
 * Validate the public signals from a submitted proof against what the server
 * expects.  Supports both the enhanced (10-signal) and legacy (8-signal) layouts.
 */
async function validatePublicSignalLayout({
  publicSignals,
  election,
  serialNumber,
  voteCommitment,
  publicKey,
  merkleRoot,
}) {
  const candidateList = toCandidateIdList(election);

  const expected = await computePublicSignals({
    electionId: election.electionId,
    candidateList,
    serialNumber,
    voteCommitment,
    publicKey,
    merkleRoot,
  });

  if (!Array.isArray(publicSignals)) {
    return { ok: false, error: "publicSignals must be an array." };
  }
  if (publicSignals.length !== expected.length) {
    return {
      ok: false,
      error: `publicSignals length mismatch. Expected ${expected.length}, got ${publicSignals.length}.`,
    };
  }

  const norm = publicSignals.map(String);
  for (let i = 0; i < expected.length; i++) {
    if (norm[i] !== expected[i]) {
      return { ok: false, error: `publicSignals mismatch at index ${i}.` };
    }
  }
  return { ok: true };
}

module.exports = {
  toCandidateIdList,
  computeSerialNumber,
  computeVoteCommitment,
  computePublicSignals,
  generateProof,
  verifyProof,
  validatePublicSignalLayout,
  detectCircuit,
};
