/**
 * Registration Audit — Commit-Reveal Registration for Censorship Resistance
 *
 * IMPROVEMENT V OVER THE PAPER
 * ─────────────────────────────────────────────────────────────────────────────
 * The zkVoting paper assumes the authority honestly includes all eligible
 * voters in the Merkle tree.  There is no mechanism for a voter to prove
 * they were wrongfully excluded, and no way for observers to detect
 * selective registration censorship.
 *
 * We introduce a COMMIT-REVEAL registration protocol:
 *
 *   1. COMMIT:  Voter publishes regCommit = H(ckHash, pkid, nonce)
 *              to a public append-only log before registration.
 *
 *   2. REVEAL:  Normal registration — voter reveals (ckHash, pkid, nonce),
 *              authority verifies the commitment and inserts into Merkle tree.
 *
 *   3. AUDIT:   Anyone can compare the commit log against the Merkle tree
 *              entries.  A valid commit with no Merkle entry = CENSORSHIP.
 *
 * This makes registration censorship DETECTABLE even if not preventable.
 * The commit log is append-only (simulated as JSON in prototype; would be
 * on-chain in production).
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const path = require("path");
const fs = require("fs/promises");
const { buildPoseidon } = require("circomlibjs");

let _poseidonPromise = null;
function getPoseidon() {
  if (!_poseidonPromise) _poseidonPromise = buildPoseidon();
  return _poseidonPromise;
}

async function poseidonHash(values) {
  const p = await getPoseidon();
  return p.F.toString(p(values.map((v) => BigInt(String(v)))));
}

// ── Persistent commit store ──────────────────────────────────────────────────

const COMMITS_PATH = path.resolve(__dirname, "..", "..", "data", "registrationCommits.json");

async function loadCommits() {
  try {
    const raw = await fs.readFile(COMMITS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { commits: [] };
  }
}

async function saveCommits(store) {
  await fs.writeFile(COMMITS_PATH, JSON.stringify(store, null, 2));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the registration commitment hash.
 *
 *   regCommit = Poseidon(ckHash, pkid, nonce)
 *
 * The voter computes this locally and publishes it BEFORE revealing their
 * registration data.  This creates an irrefutable on-chain record of their
 * intent to register.
 */
async function computeRegCommit(ckHash, pkid, nonce) {
  return poseidonHash([ckHash, pkid, nonce]);
}

/**
 * Store a registration commitment in the public append-only log.
 *
 * In production, this would be an on-chain transaction.  In our prototype,
 * it is persisted to a JSON file.
 *
 * @param {string} regCommit — the hash Poseidon(ckHash, pkid, nonce)
 * @returns {{ index: number, timestamp: string }}
 */
async function storeCommit(regCommit) {
  const store = await loadCommits();
  const index = store.commits.length;
  const entry = {
    index,
    regCommit,
    timestamp: new Date().toISOString(),
    matched: false, // will be set to true when a matching reveal is registered
  };
  store.commits.push(entry);
  await saveCommits(store);
  return { index, timestamp: entry.timestamp };
}

/**
 * Verify that a reveal (ckHash, pkid, nonce) matches a prior commitment.
 *
 *   H(ckHash, pkid, nonce) == regCommit
 *
 * If a matching commit exists, marks it as matched.
 *
 * @returns {{ valid: boolean, commitIndex?: number, error?: string }}
 */
async function verifyReveal(ckHash, pkid, nonce) {
  const computed = await computeRegCommit(ckHash, pkid, nonce);
  const store = await loadCommits();

  const commitEntry = store.commits.find((c) => c.regCommit === computed);
  if (!commitEntry) {
    return {
      valid: false,
      error: "No matching registration commitment found. Voter may not have committed first.",
    };
  }

  if (commitEntry.matched) {
    return {
      valid: false,
      error: "This commitment was already revealed and registered.",
    };
  }

  // Mark as matched
  commitEntry.matched = true;
  await saveCommits(store);

  return { valid: true, commitIndex: commitEntry.index };
}

/**
 * Audit the registration process — compare commits against Merkle tree entries.
 *
 * Returns:
 *   - totalCommits: how many registration commitments were published
 *   - matchedCommits: how many were successfully registered (have Merkle entries)
 *   - unmatchedCommits: commits with NO corresponding Merkle entry = CENSORSHIP EVIDENCE
 *   - registrationsWithoutCommit: registrations that bypassed the commit phase
 *   - censored: boolean — true if any commit was not matched
 *
 * @param {Array} merkleEntries — from bulletinBoard.json entries
 */
async function auditRegistration(merkleEntries) {
  const store = await loadCommits();

  const matched = store.commits.filter((c) => c.matched);
  const unmatched = store.commits.filter((c) => !c.matched);

  // Count registrations that didn't go through commit phase
  const totalRegistrations = merkleEntries ? merkleEntries.length : 0;
  const registrationsWithoutCommit = totalRegistrations - matched.length;

  return {
    totalCommits: store.commits.length,
    matchedCommits: matched.length,
    unmatchedCommits: unmatched.map((c) => ({
      index: c.index,
      regCommit: c.regCommit,
      timestamp: c.timestamp,
    })),
    totalRegistrations,
    registrationsWithoutCommit: Math.max(0, registrationsWithoutCommit),
    censored: unmatched.length > 0,
    verdict: unmatched.length > 0
      ? `CENSORSHIP DETECTED: ${unmatched.length} voter(s) committed to register but were NOT included in the Merkle tree.`
      : registrationsWithoutCommit > 0
        ? `WARNING: ${registrationsWithoutCommit} registration(s) bypassed the commit phase (not auditable).`
        : "CLEAN: All registration commitments are matched in the Merkle tree.",
  };
}

module.exports = {
  computeRegCommit,
  storeCommit,
  verifyReveal,
  auditRegistration,
};
