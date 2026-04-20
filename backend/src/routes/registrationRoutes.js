/**
 * Registration routes — enhanced with the nullifiable commitment scheme.
 *
 * Changes vs. the original implementation:
 *
 * 1. Voter secret (skid) is now generated CLIENT-SIDE (sent in the request).
 *    The backend only receives pkid = H(skid), never skid itself.
 *    If the client doesn't supply one, we fall back to server-generation for
 *    prototype convenience, but flag it clearly.
 *
 * 2. Casting keys are EC-based nullifiable commitment keys (Construction 1):
 *      b = 1  → real key (one per voter, required to cast a counting ballot)
 *      b = 0  → fake key (unlimited; for use under coercion)
 *
 * 3. Each issued key comes with a KeyProve proof (Schnorr, Fiat-Shamir) that
 *    the authority correctly generated the key for the claimed bit b.
 *
 * 4. The voter's (ckHash, pkid) pair is appended to the public Merkle tree so
 *    that eligibility can be verified zero-knowledge.
 *
 * Endpoints
 * ─────────
 *  POST /api/register
 *    Register and get a REAL casting key (once per identity).
 *    Body: { identityTag, pkid? }
 *
 *  POST /api/register/fake-key
 *    Request an additional FAKE casting key for coercion resistance.
 *    Body: { voterId }
 *
 *  POST /api/register/sim-key-prove
 *    Generate a simulated proof asserting any key is "real" (deniability).
 *    Body: { voterId, ckHash, claimedBit }
 *
 *  GET  /api/register/key-proof/:voterId
 *    Return the KeyProve proof for the voter's real casting key.
 */

"use strict";

const crypto = require("crypto");
const express = require("express");
const { readJson, writeJson } = require("../lib/jsonStore");
const { randomFieldElement } = require("../lib/cryptoUtils");
const nc = require("../lib/nullifiableCommitment");
const { appendEntry, getBulletinBoard } = require("../lib/merkleTree");
const { computeKeyContribution, aggregateCommitments } = require("../lib/totalProof");
const { buildPoseidon } = require("circomlibjs");
const regAudit = require("../lib/registrationAudit"); // Improvement V

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

let _poseidon = null;
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

async function poseidonHash(values) {
  const p = await getPoseidon();
  return p.F.toString(p(values.map((v) => BigInt(String(v)))));
}

/**
 * Load (or lazily initialise) the election-level NC master key pair from
 * election.json.  In a real deployment this would be created during Setup and
 * stored in an HSM; for the prototype we store it in the election config file.
 */
async function loadOrInitNcSetup() {
  const election = await readJson("election.json", {
    electionId: "1001",
    candidates: [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Charlie" },
      { id: "4", name: "Diana" },
      { id: "5", name: "Eve" },
    ],
  });

  if (!election.ncSetup) {
    // First call: run Setup and persist
    const setup = await nc.setup();
    election.ncSetup = setup;
    await writeJson("election.json", election);
  }

  return election;
}

// ── POST /api/register ───────────────────────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const identityTag = String(req.body.identityTag || "").trim();
    if (!identityTag) {
      return res.status(400).json({ ok: false, error: "identityTag is required." });
    }

    // pkid = H(skid).  The client should generate skid locally and send only
    // pkid.  For prototype fallback we also accept server-side generation.
    let pkid = req.body.pkid ? String(req.body.pkid).trim() : null;
    let voterSecret = null;   // skid — only known to the voter
    let serverGenerated = false;

    if (!pkid) {
      // Fallback: server generates skid (breaks privacy model but keeps
      // prototype usable without a JS client library).
      voterSecret = randomFieldElement();
      pkid = await poseidonHash([voterSecret]);
      serverGenerated = true;
    }

    const [voters, election] = await Promise.all([
      readJson("voters.json", []),
      loadOrInitNcSetup(),
    ]);

    // Duplicate check
    if (voters.find((v) => v.identityTag === identityTag)) {
      return res.status(409).json({ ok: false, error: "identityTag already registered." });
    }

    // Issue REAL casting key (b = 1)
    const { ck, ckHash } = await nc.keyGen(
      election.ncSetup.mpk,
      election.ncSetup.msk,
      1  // b = 1 → real key
    );

    // KeyProve — Schnorr proof that the key is correctly generated
    const { proof: keyProof } = await nc.keyProve(
      election.ncSetup.mpk,
      election.ncSetup.msk,
      ck,
      1
    );

    // Improvement 3: Cross-election unlinkability
    // Derive an election-scoped casting key hash:  ckHashE = H(ckHash, electionId)
    // The serial number will use ckHashE instead of raw ckHash, so the voter's
    // participation cannot be linked across different elections even if ck is reused.
    const ckHashE = await poseidonHash([ckHash, election.electionId]);

    // Append (ckHashE, pkid) to the public Merkle tree (election-scoped)
    const { index: bbIndex, root: merkleRoot, proof: merkleProof } =
      await appendEntry(ckHashE, pkid);

    // Improvement 1: πtotal accumulation
    // Compute per-key commitment: cm_key = NC.Commit(ck, 1; 0)
    // Add to the running aggregate commitment in election.json
    const keyCm = await computeKeyContribution(election.ncSetup.mpk, ck);
    election.cmAgg = election.cmAgg
      ? await aggregateCommitments(election.cmAgg, keyCm)
      : keyCm;
    election.nvReal = (election.nvReal || 0) + 1;
    await writeJson("election.json", election);

    const voter = {
      voterId: crypto.randomUUID(),
      identityTag,
      pkid,
      ck,
      ckHash,
      ckHashE,       // election-scoped key hash (Improvement 3)
      keyType: "real",
      bbIndex,
      merkleProofAtRegistration: merkleProof,
      hasSubmittedBallot: false,
      createdAt: new Date().toISOString(),
      // voterSecret stored ONLY if server-generated (privacy warning)
      ...(serverGenerated ? { voterSecret, serverGenerated: true } : {}),
    };

    voters.push(voter);
    await writeJson("voters.json", voters);

    const response = {
      ok: true,
      message: "Registration successful. Real casting key issued.",
      voter: {
        voterId: voter.voterId,
        identityTag: voter.identityTag,
        pkid: voter.pkid,
        createdAt: voter.createdAt,
      },
      castingKey: {
        ck:      voter.ck,
        ckHash:  voter.ckHash,
        ckHashE: voter.ckHashE,   // election-scoped hash (Improvement 3)
        keyType: "real",
      },
      // The voter can verify the key is genuine using this proof
      keyProof: {
        proof: keyProof,
        instruction:
          "Verify with POST /api/register/verify-key-proof. " +
          "You can also run SimKeyProve to generate a deniable fake proof.",
      },
      bulletinBoard: {
        bbIndex,
        merkleRoot,
        merkleProof,
        note: "Your (ckHash, pkid) is now entry #" + bbIndex + " in the public key set.",
      },
      election: {
        electionId: election.electionId,
        candidateIds: election.candidates.map((c) => c.id),
        mpk: election.ncSetup.mpk,
      },
    };

    if (serverGenerated) {
      response.privateCredentials = {
        voterSecret,
        warning:
          "Server-generated for prototype convenience. " +
          "In production the voter generates voterSecret locally and " +
          "only sends pkid = H(voterSecret) to the registrar.",
      };
    }

    return res.status(201).json(response);
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/register/fake-key ──────────────────────────────────────────────

router.post("/fake-key", async (req, res, next) => {
  try {
    const voterId = String(req.body.voterId || "").trim();
    if (!voterId) {
      return res.status(400).json({ ok: false, error: "voterId is required." });
    }

    const [voters, election] = await Promise.all([
      readJson("voters.json", []),
      loadOrInitNcSetup(),
    ]);

    const voter = voters.find((v) => v.voterId === voterId);
    if (!voter) {
      return res.status(404).json({ ok: false, error: "Voter not found." });
    }

    // Issue FAKE casting key (b = 0) — unlimited, for coercion scenarios
    const { ck: fakeKey, ckHash: fakeKeyHash } = await nc.keyGen(
      election.ncSetup.mpk,
      election.ncSetup.msk,
      0  // b = 0 → fake key
    );

    // KeyProve for the fake key (proves it was legitimately generated)
    const { proof: fakeKeyProof } = await nc.keyProve(
      election.ncSetup.mpk,
      election.ncSetup.msk,
      fakeKey,
      0
    );

    // Improvement 3: Cross-election unlinkability for fake keys
    const fakeKeyHashE = await poseidonHash([fakeKeyHash, election.electionId]);

    // Also append the fake key to the bulletin board (indistinguishable from real)
    const { index: bbIndex, root: merkleRoot, proof: merkleProof } =
      await appendEntry(fakeKeyHashE, voter.pkid);

    // Record on the voter (server privately knows it's fake via msk)
    if (!voter.fakeKeys) voter.fakeKeys = [];
    voter.fakeKeys.push({ ck: fakeKey, ckHash: fakeKeyHash, ckHashE: fakeKeyHashE, bbIndex });
    await writeJson("voters.json", voters);

    return res.status(201).json({
      ok: true,
      message:
        "Fake casting key issued. " +
        "Use this under coercion — it produces a ballot that tallies as zero.",
      fakeKey: {
        ck: fakeKey,
        ckHash: fakeKeyHash,
        ckHashE: fakeKeyHashE,
        keyType: "fake",
      },
      keyProof: {
        proof: fakeKeyProof,
        note: "This proof is indistinguishable from a real-key proof. " +
              "You can also run SimKeyProve to claim it is real.",
      },
      bulletinBoard: {
        bbIndex,
        merkleRoot,
        merkleProof,
        note: "Fake key is on the public bulletin board — coercer cannot tell it apart.",
      },
    });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/register/sim-key-prove ────────────────────────────────────────
//
// Key deniability: generate a SIMULATED proof asserting ck is a "real" key
// (even if it's fake, and vice versa).  This is what makes coercion futile —
// a voter can hand a fake key + simulated proof and the coercer cannot
// distinguish it from handing a real key + genuine proof.

router.post("/sim-key-prove", async (req, res, next) => {
  try {
    const voterId = String(req.body.voterId || "").trim();
    const ckHash = String(req.body.ckHash || "").trim();
    const claimedBit = req.body.claimedBit === 0 || req.body.claimedBit === "0" ? 0 : 1;

    if (!voterId || !ckHash) {
      return res.status(400).json({
        ok: false,
        error: "voterId and ckHash are required.",
      });
    }

    const [voters, election] = await Promise.all([
      readJson("voters.json", []),
      loadOrInitNcSetup(),
    ]);

    const voter = voters.find((v) => v.voterId === voterId);
    if (!voter) return res.status(404).json({ ok: false, error: "Voter not found." });

    // Find the key (real or fake) by ckHash
    const allKeys = [
      { ck: voter.ck, ckHash: voter.ckHash, type: "real" },
      ...(voter.fakeKeys || []).map((fk) => ({ ...fk, type: "fake" })),
    ];
    const keyEntry = allKeys.find((k) => k.ckHash === ckHash);
    if (!keyEntry) {
      return res.status(404).json({ ok: false, error: "Key not found for this voter." });
    }

    // SimKeyProve — no msk needed, runs entirely client-side in the paper
    const simProof = await nc.simKeyProve(election.ncSetup.mpk, keyEntry.ck, claimedBit);

    return res.json({
      ok: true,
      message: "Simulated key proof generated.",
      simProof,
      explanation:
        "This proof claims the key is of type b=" + claimedBit + ". " +
        "It is cryptographically indistinguishable from a genuine KeyProve. " +
        "A coercer who demands proof that this key is real cannot disprove it.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/register/verify-key-proof ─────────────────────────────────────

router.post("/verify-key-proof", async (req, res, next) => {
  try {
    const { ck, proof, claimedBit } = req.body;
    if (!ck || !proof) {
      return res.status(400).json({ ok: false, error: "ck and proof are required." });
    }
    const b = claimedBit === 0 || claimedBit === "0" ? 0 : 1;

    const election = await loadOrInitNcSetup();
    const valid = await nc.verifyKeyProof(election.ncSetup.mpk, ck, proof, b);

    return res.json({
      ok: true,
      valid,
      message: valid
        ? "Key proof is valid. The authority correctly generated this key for b=" + b + "."
        : "Key proof is INVALID.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── GET /api/register/merkle-proof/:voterId ───────────────────────────────────

router.get("/merkle-proof/:voterId", async (req, res, next) => {
  try {
    const voterId = req.params.voterId;
    const voters = await readJson("voters.json", []);
    const voter = voters.find((v) => v.voterId === voterId);

    if (!voter) return res.status(404).json({ ok: false, error: "Voter not found." });

    const { getProofForEntry } = require("../lib/merkleTree");
    const proof = await getProofForEntry(voter.bbIndex);

    return res.json({
      ok: true,
      merkleProof: proof,
      ckHash: voter.ckHash,
      pkid: voter.pkid,
      bbIndex: voter.bbIndex,
    });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/register/commit ─────────────────────────────────────────────
//
// Improvement V: Censorship-resistant registration commit.
// The voter publishes H(ckHash, pkid, nonce) BEFORE revealing their
// registration data.  This creates an irrefutable public record of their
// intent to register.  If the authority later excludes them from the
// Merkle tree, the censorship is detectable via /api/register/audit.

router.post("/commit", async (req, res, next) => {
  try {
    const { ckHash, pkid, nonce } = req.body;
    if (!ckHash || !pkid || nonce === undefined || nonce === null) {
      return res.status(400).json({
        ok: false,
        error: "ckHash, pkid, and nonce are required.",
      });
    }

    const regCommit = await regAudit.computeRegCommit(ckHash, pkid, nonce);
    const result = await regAudit.storeCommit(regCommit);

    // Prototype: if the voter with this ckHash is already registered in the
    // Merkle tree (i.e. commit was made AFTER registration), auto-match the
    // commit so the audit doesn't report a false-positive censorship.
    const voters = await readJson("voters.json", []);
    const alreadyRegistered = voters.find((v) => v.ckHash === ckHash && v.pkid === pkid);
    if (alreadyRegistered) {
      await regAudit.verifyReveal(ckHash, pkid, nonce);
    }

    return res.status(201).json({
      ok: true,
      message: "Registration commitment recorded on the public log." +
        (alreadyRegistered ? " (auto-matched: voter already registered)" : ""),
      regCommit,
      commitIndex: result.index,
      timestamp: result.timestamp,
      autoMatched: !!alreadyRegistered,
      instruction:
        alreadyRegistered
          ? "Commit auto-matched to existing registration. Audit will report clean."
          : "Now proceed with POST /api/register to reveal your registration. " +
            "Anyone can later verify your commitment was honored via GET /api/register/audit.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── GET /api/register/audit ───────────────────────────────────────────────
//
// Improvement V: Public censorship audit.
// Compares the registration commit log against the Merkle tree entries.
// Unmatched commits = voters who committed but were NOT registered = CENSORSHIP.

router.get("/audit", async (req, res, next) => {
  try {
    const bb = await getBulletinBoard();
    const auditResult = await regAudit.auditRegistration(bb.entries);

    return res.json({
      ok: true,
      ...auditResult,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
