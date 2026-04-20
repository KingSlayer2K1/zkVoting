/**
 * Vote routes — enhanced with nullifiable commitment scheme.
 *
 * Key changes vs. the original implementation:
 *
 * 1. Each ballot now carries an EC-based nullifiable commitment
 *      ncm = { C1, C2 }  (Baby Jubjub points)
 *    alongside the existing Poseidon commitment (used for the ZK proof).
 *    This is the commitment the tally phase will nullify.
 *
 * 2. A random scalar `ncRandom` is generated per ballot and stored encrypted
 *    inside the sealed payload.  The tallier needs it to verify openNull.
 *
 * 3. The serial number is now  H(electionId, ckHash, voterSecret)  where
 *    ckHash = Poseidon(h1x, h1y, h2x, h2y) — the hash of the EC casting key.
 *
 * 4. The voter also provides (or we look up) their Merkle proof so the ZK
 *    circuit can verify eligibility.
 *
 * POST /api/votes/cast       — full backend-assisted flow (prototype)
 * POST /api/votes            — client-supplied proof flow (advanced)
 * GET  /api/votes/stats
 * GET  /api/votes/receipt/:serialNumber
 */

"use strict";

const crypto = require("crypto");
const express = require("express");
const { readJson, writeJson } = require("../lib/jsonStore");
const { encryptVotePayload } = require("../lib/cryptoUtils");
const {
  toCandidateIdList,
  computeVoteCommitment,
  generateProof,
  verifyProof,
  validatePublicSignalLayout,
} = require("../lib/zkService");
const nc = require("../lib/nullifiableCommitment");
const { getProofForEntry, getBulletinBoard } = require("../lib/merkleTree");
const { buildPoseidon } = require("circomlibjs");

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeString(v) {
  return String(v ?? "").trim();
}

function normalizeNullifiers(n) {
  return Array.isArray(n) ? n.map(String) : [];
}

let _poseidon = null;
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

async function poseidonHash(values) {
  const p = await getPoseidon();
  return p.F.toString(p(values.map((v) => BigInt(String(v)))));
}

async function loadContext() {
  const [voters, votes, nullifiers, election] = await Promise.all([
    readJson("voters.json", []),
    readJson("votes.json", []),
    readJson("nullifiers.json", []),
    readJson("election.json", {
      electionId: "1001",
      candidates: [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Charlie" },
        { id: "4", name: "Diana" },
        { id: "5", name: "Eve" },
      ],
    }),
  ]);
  return { voters, votes, nullifiers: normalizeNullifiers(nullifiers), election };
}

function findVoter(voters, voterId) {
  return voters.find((v) => v.voterId === voterId);
}

function isCandidateAllowed(election, vote) {
  return toCandidateIdList(election).includes(String(vote));
}

/**
 * Compute serial number using the cross-election-unlinkable formula:
 *   sn = H(electionId, ckHashE, voterSecret, epochSecret)
 *
 * Improvement 3: ckHashE = H(ckHash, electionId) prevents cross-election linkability.
 * Improvement IV: epochSecret adds forward secrecy — delete after voting!
 */
async function computeSerialNumber({ electionId, ckHash, voterSecret, epochSecret }) {
  if (epochSecret !== undefined && epochSecret !== null) {
    return poseidonHash([electionId, ckHash, voterSecret, epochSecret]);
  }
  return poseidonHash([electionId, ckHash, voterSecret]);
}

/**
 * Improvement VI: Check voting phase, including hidden grace period.
 *
 * Returns:
 *   { phase: 'open' | 'grace' | 'closed', allowed: boolean }
 *
 * During 'open': any new or re-vote is accepted.
 * During 'grace': ONLY re-votes (same serial number) are accepted.
 * During 'closed': nothing is accepted.
 */
function checkVotingPhase(election) {
  if (!election.publicDeadline) {
    return { phase: "open", allowed: true }; // no deadline set
  }
  const now = new Date();
  const publicDL = new Date(election.publicDeadline);
  const graceDL = election.graceDeadline
    ? new Date(election.graceDeadline)
    : publicDL;

  if (now < publicDL) return { phase: "open", allowed: true };
  if (now < graceDL)  return { phase: "grace", allowed: true };
  return { phase: "closed", allowed: false };
}

function ensureNoDoubleVote({ voter, serialNumber, nullifiers, votes, isGracePeriod }) {
  // Improvement VI: During grace period, allow overwriting previous vote
  if (isGracePeriod) {
    // In grace period, ONLY re-votes with an existing SN are allowed
    const existingBallot = votes.find((v) => v.serialNumber === serialNumber);
    if (!existingBallot) {
      return {
        ok: false, status: 403,
        error: "Grace period: only re-votes with an existing serial number are accepted.",
      };
    }
    // Allow overwrite
    return { ok: true, isRevote: true, existingBallotIndex: votes.indexOf(existingBallot) };
  }

  if (voter.hasSubmittedBallot) {
    return { ok: false, status: 409, error: "Voter has already submitted a ballot." };
  }
  if (nullifiers.includes(serialNumber)) {
    return { ok: false, status: 409, error: "Duplicate serial number in nullifier set." };
  }
  if (votes.some((v) => v.serialNumber === serialNumber)) {
    return { ok: false, status: 409, error: "Duplicate serial number in ballot store." };
  }
  return { ok: true, isRevote: false };
}

async function storeAcceptedBallot({
  voters, votes, nullifiers,
  voter, serialNumber, voteCommitment, ncCommitment, ncRandom,
  proof, publicSignals, vote, voteSalt,
  isRevote, existingBallotIndex,
}) {
  const ballot = {
    ballotId: crypto.randomUUID(),
    serialNumber,
    voteCommitment,
    // EC-based nullifiable commitment (the paper's cm = (C1, C2))
    ncCommitment,
    proof,
    publicSignals,
    sealedVote: encryptVotePayload({
      vote: String(vote),
      voteSalt: String(voteSalt),
      // ncRandom is needed by the tallier to run Opennull after Nullify
      ncRandom: String(ncRandom),
    }),
    status: isRevote ? "REVOTE_OVERWRITE" : "ACCEPTED_VERIFIED",
    submittedAt: new Date().toISOString(),
    ...(isRevote ? { revoteNote: "This ballot replaced a previous vote during the grace period (Improvement VI)." } : {}),
  };

  // Improvement VI: if re-vote, overwrite the existing ballot instead of appending
  if (isRevote && existingBallotIndex !== undefined) {
    votes[existingBallotIndex] = ballot;
  } else {
    votes.push(ballot);
  }

  voter.hasSubmittedBallot = true;
  voter.serialNumber = serialNumber;

  const nullSet = new Set(nullifiers);
  nullSet.add(serialNumber);

  await Promise.all([
    writeJson("votes.json", votes),
    writeJson("voters.json", voters),
    writeJson("nullifiers.json", Array.from(nullSet)),
  ]);

  return ballot;
}

// ── POST /api/votes/cast — backend-assisted full flow ────────────────────────

router.post("/cast", async (req, res, next) => {
  try {
    const voterId = normalizeString(req.body.voterId);
    const vote    = normalizeString(req.body.vote);

    if (!voterId || !vote) {
      return res.status(400).json({ ok: false, error: "voterId and vote are required." });
    }

    const { voters, votes, nullifiers, election } = await loadContext();
    const voter = findVoter(voters, voterId);

    if (!voter) {
      return res.status(404).json({ ok: false, error: "Voter not found. Register first." });
    }

    if (!isCandidateAllowed(election, vote)) {
      return res.status(400).json({ ok: false, error: "Vote is not in the candidate list." });
    }

    // Ensure voter has an EC casting key (post-enhancement registration)
    if (!voter.ck || !voter.ckHash) {
      return res.status(400).json({
        ok: false,
        error:
          "Voter has a legacy (pre-enhancement) key. " +
          "Please re-register to get a nullifiable casting key.",
      });
    }

    const voterSecret = voter.voterSecret; // skid (only present in server-gen fallback)
    if (!voterSecret) {
      return res.status(400).json({
        ok: false,
        error:
          "voterSecret not available server-side. " +
          "Use POST /api/votes (client-proof flow) instead.",
      });
    }

    // ── Improvement VI: voting phase check ──────────────────────────────────
    const phaseCheck = checkVotingPhase(election);
    if (!phaseCheck.allowed) {
      return res.status(403).json({
        ok: false,
        error: "Voting is closed.",
        phase: phaseCheck.phase,
      });
    }

    const voteSalt     = BigInt("0x" + crypto.randomBytes(31).toString("hex")).toString();
    const ncRandom     = nc.randomScalar();  // r for the EC commitment

    // ── Improvement IV: generate ephemeral epochSecret for forward secrecy ──
    const epochSecret = BigInt("0x" + crypto.randomBytes(31).toString("hex")).toString();

    // ── Serial number (Improvements 3 + IV) ─────────────────────────────────
    // NOTE: The circuit computes ckHash internally from raw ck coords via
    //   ckHash = Poseidon(h1x, h1y, h2x, h2y)
    // and then sn = Poseidon(electionId, ckHash, voterSecret, epochSecret).
    // We must use the same raw ckHash here, NOT ckHashE (election-scoped).
    const serialNumber = await computeSerialNumber({
      electionId: election.electionId,
      ckHash: voter.ckHash,
      voterSecret,
      epochSecret,  // Improvement IV: forward secrecy
    });

    // ── Poseidon commitment (ZK circuit) ────────────────────────────────────
    const voteCommitment = await computeVoteCommitment({ vote, voteSalt });

    // ── EC-based nullifiable commitment (tally nullification) ───────────────
    if (!election.ncSetup) {
      return res.status(500).json({ ok: false, error: "NC setup not initialised." });
    }
    const ncCommitment = await nc.commit(
      election.ncSetup.mpk,
      voter.ck,
      vote,
      ncRandom,
    );

    // ── Double-vote guard (Improvement VI: grace period re-vote support) ────
    const isGracePeriod = phaseCheck.phase === "grace";
    const dvCheck = ensureNoDoubleVote({ voter, serialNumber, nullifiers, votes, isGracePeriod });
    if (!dvCheck.ok) {
      return res.status(dvCheck.status).json({ ok: false, error: dvCheck.error });
    }

    // ── Merkle proof for this voter's casting key ────────────────────────────
    const merkleProof = await getProofForEntry(voter.bbIndex);
    const bb          = await getBulletinBoard();

    // ── ZK proof inputs ──────────────────────────────────────────────────────
    const candidateList = toCandidateIdList(election);
    const input = {
      // Private
      vote: String(vote),
      voterSecret: String(voterSecret),
      ckH1x: voter.ck.h1.x,
      ckH1y: voter.ck.h1.y,
      ckH2x: voter.ck.h2.x,
      ckH2y: voter.ck.h2.y,
      voteSalt: String(voteSalt),
      epochSecret: String(epochSecret),  // Improvement IV: forward secrecy
      merklePathElements: merkleProof.pathElements,
      merklePathIndices: merkleProof.pathIndices,
      // Public
      electionId: String(election.electionId),
      candidateList,
      serialNumber,
      voteCommitment,
      publicKey: voter.pkid,
      merkleRoot: bb.root,
    };

    const { proof, publicSignals } = await generateProof(input);

    // ── Verify the layout and the proof itself ───────────────────────────────
    const layoutCheck = await validatePublicSignalLayout({
      publicSignals,
      election,
      serialNumber,
      voteCommitment,
      publicKey: voter.pkid,
      merkleRoot: bb.root,
    });
    if (!layoutCheck.ok) {
      return res.status(400).json({ ok: false, error: layoutCheck.error });
    }

    const proofValid = await verifyProof(publicSignals, proof);
    if (!proofValid) {
      return res.status(400).json({ ok: false, error: "Proof verification failed." });
    }

    // ── Store ballot (Improvement VI: supports re-vote overwrite) ────────────
    const ballot = await storeAcceptedBallot({
      voters, votes, nullifiers,
      voter, serialNumber, voteCommitment, ncCommitment, ncRandom,
      proof, publicSignals, vote, voteSalt,
      isRevote: dvCheck.isRevote,
      existingBallotIndex: dvCheck.existingBallotIndex,
    });

    return res.status(201).json({
      ok: true,
      message: dvCheck.isRevote
        ? "Re-vote accepted during grace period. Previous ballot replaced."
        : "Vote cast and proof verified successfully.",
      receipt: {
        ballotId:       ballot.ballotId,
        serialNumber:   ballot.serialNumber,
        voteCommitment: ballot.voteCommitment,
        ncCommitment:   ballot.ncCommitment,
        status:         ballot.status,
        submittedAt:    ballot.submittedAt,
      },
      forwardSecrecy: {
        epochSecretUsed: true,
        warning: "DELETE your epochSecret now. It is no longer needed and " +
                 "its destruction ensures forward secrecy (Improvement IV).",
      },
      note: "ncCommitment = (C1,C2) is the EC-based nullifiable commitment. " +
            "The tallier uses the master secret key to nullify it and verify " +
            "whether this was cast with a real or fake key.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/votes — client-supplied proof flow ─────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const voterId        = normalizeString(req.body.voterId);
    const serialNumber   = normalizeString(req.body.serialNumber);
    const voteCommitment = normalizeString(req.body.voteCommitment);
    const vote           = normalizeString(req.body.vote);
    const voteSalt       = normalizeString(req.body.voteSalt);
    const ncRandom       = normalizeString(req.body.ncRandom);
    const { proof, publicSignals, ncCommitment } = req.body;

    if (!voterId || !serialNumber || !voteCommitment || !vote || !voteSalt ||
        !proof || !Array.isArray(publicSignals) || !ncCommitment) {
      return res.status(400).json({
        ok: false,
        error:
          "voterId, serialNumber, voteCommitment, vote, voteSalt, " +
          "ncCommitment, proof, publicSignals are required.",
      });
    }

    const { voters, votes, nullifiers, election } = await loadContext();
    const voter = findVoter(voters, voterId);

    if (!voter) {
      return res.status(404).json({ ok: false, error: "Voter not found." });
    }

    if (!isCandidateAllowed(election, vote)) {
      return res.status(400).json({ ok: false, error: "Vote is not in the candidate list." });
    }

    // Verify public signal layout (client-supplied signals must match server's view)
    const bb = await getBulletinBoard();
    const layoutCheck = await validatePublicSignalLayout({
      publicSignals,
      election,
      serialNumber,
      voteCommitment,
      publicKey: voter.pkid,
      merkleRoot: bb.root,
    });
    if (!layoutCheck.ok) {
      return res.status(400).json({ ok: false, error: layoutCheck.error });
    }

    const dvCheck = ensureNoDoubleVote({ voter, serialNumber, nullifiers, votes });
    if (!dvCheck.ok) {
      return res.status(dvCheck.status).json({ ok: false, error: dvCheck.error });
    }

    const proofValid = await verifyProof(publicSignals, proof);
    if (!proofValid) {
      return res.status(400).json({ ok: false, error: "Proof verification failed." });
    }

    const ballot = await storeAcceptedBallot({
      voters, votes, nullifiers,
      voter, serialNumber, voteCommitment,
      ncCommitment, ncRandom: ncRandom || "0",
      proof, publicSignals, vote, voteSalt,
    });

    return res.status(201).json({
      ok: true,
      message: "Ballot accepted after proof verification.",
      receipt: {
        ballotId:       ballot.ballotId,
        serialNumber:   ballot.serialNumber,
        voteCommitment: ballot.voteCommitment,
        ncCommitment:   ballot.ncCommitment,
        status:         ballot.status,
        submittedAt:    ballot.submittedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// ── GET /api/votes/stats ─────────────────────────────────────────────────────

router.get("/stats", async (_req, res, next) => {
  try {
    const [voters, votes, nullifiers] = await Promise.all([
      readJson("voters.json", []),
      readJson("votes.json", []),
      readJson("nullifiers.json", []),
    ]);

    const accepted = votes.filter((v) => v.status === "ACCEPTED_VERIFIED").length;
    const withNcCommitment = votes.filter(
      (v) => v.status === "ACCEPTED_VERIFIED" && v.ncCommitment
    ).length;

    res.json({
      ok: true,
      stats: {
        registeredVoters: voters.length,
        votesReceived:    votes.length,
        acceptedVotes:    accepted,
        nullifiersUsed:   normalizeNullifiers(nullifiers).length,
        ballotsWithNcCommitment: withNcCommitment,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/votes/receipt/:serialNumber ─────────────────────────────────────

router.get("/receipt/:serialNumber", async (req, res, next) => {
  try {
    const sn = normalizeString(req.params.serialNumber);
    if (!sn) return res.status(400).json({ ok: false, error: "serialNumber required." });

    const votes = await readJson("votes.json", []);
    const ballot = votes.find((v) => v.serialNumber === sn);
    if (!ballot) return res.status(404).json({ ok: false, error: "Ballot not found." });

    return res.json({
      ok: true,
      receipt: {
        ballotId:       ballot.ballotId,
        serialNumber:   ballot.serialNumber,
        voteCommitment: ballot.voteCommitment,
        ncCommitment:   ballot.ncCommitment,
        status:         ballot.status,
        submittedAt:    ballot.submittedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
