/**
 * Result / tally routes — coercion-resistant tally via nullification.
 *
 * The original tally simply decrypted every ballot and counted votes.  That
 * approach cannot filter out fake ballots because it has no way of knowing
 * which casting key was real vs. fake.
 *
 * The enhanced tally follows the Tally phase from Construction 2 (§4.4):
 *
 *   foreach ballot Bi = (sn_i, CT_i, ncm_i, …) on the bulletin board:
 *     (vote_i, r_i) ← Dec(sk, CT_i)              // symmetric decrypt
 *     cm*_i ← NC.Nullify(msk, ncm_i)             // EC nullification
 *     if NC.Opennull(ck*, cm*_i, vote_i, r_i) = 1:
 *         mtally += vote_i                         // real ballot
 *     else:
 *         discard                                  // fake ballot (vote = 0)
 *
 * This gives an O(n) tally that automatically discards fake-key ballots
 * without requiring any trusted coordination with voters — the master secret
 * key alone is sufficient.
 *
 * Endpoints
 * ─────────
 *  GET  /api/results/tally
 *    Full coercion-resistant tally with per-ballot nullification audit.
 *
 *  GET  /api/results/legacy-tally
 *    Old decryption-only tally (kept for comparison; vulnerable to fake keys).
 *
 *  GET  /api/results/nullify/:ballotId
 *    Inspect a single ballot's nullification result (debugging / audit).
 */

"use strict";

const express = require("express");
const { readJson } = require("../lib/jsonStore");
const { decryptVotePayload } = require("../lib/cryptoUtils");
const { computeVoteCommitment } = require("../lib/zkService");
const nc = require("../lib/nullifiableCommitment");

const router = express.Router();

// ── Load election with NC setup ───────────────────────────────────────────────

async function loadElectionWithNc() {
  return readJson("election.json", {
    electionId: "1001",
    candidates: [],
    ncSetup: null,
  });
}

// ── Enhanced tally with nullification ────────────────────────────────────────

router.get("/tally", async (_req, res, next) => {
  try {
    const [election, votes] = await Promise.all([
      loadElectionWithNc(),
      readJson("votes.json", []),
    ]);

    const hasNcSetup = !!(
      election.ncSetup &&
      election.ncSetup.msk &&
      election.ncSetup.ckStar
    );

    const counts = new Map(
      election.candidates.map((c) => [String(c.id), 0])
    );

    const auditLog = [];
    let accepted = 0;
    let realBallots = 0;
    let fakeBallots = 0;
    let decryptErrors = 0;
    let nullifyErrors = 0;

    for (const ballot of votes) {
      if (ballot.status !== "ACCEPTED_VERIFIED") continue;
      accepted++;

      // ── Step 1: Decrypt sealed payload ─────────────────────────────────
      let payload;
      try {
        payload = decryptVotePayload(ballot.sealedVote);
      } catch {
        decryptErrors++;
        auditLog.push({ ballotId: ballot.ballotId, result: "DECRYPT_FAILED" });
        continue;
      }

      const vote    = String(payload.vote);
      const voteSalt = String(payload.voteSalt);
      const ncRandom = payload.ncRandom ? String(payload.ncRandom) : null;

      // ── Step 2: Verify Poseidon commitment (integrity check) ────────────
      const recomputed = await computeVoteCommitment({ vote, voteSalt });
      if (recomputed !== ballot.voteCommitment) {
        decryptErrors++;
        auditLog.push({ ballotId: ballot.ballotId, result: "COMMITMENT_MISMATCH" });
        continue;
      }

      // ── Step 3: NC nullification (the core coercion-resistance check) ───
      if (hasNcSetup && ballot.ncCommitment && ncRandom) {
        let nullified;
        try {
          nullified = await nc.nullify(election.ncSetup.msk, ballot.ncCommitment);
        } catch (e) {
          nullifyErrors++;
          auditLog.push({
            ballotId: ballot.ballotId,
            result: "NULLIFY_ERROR",
            error: e.message,
          });
          continue;
        }

        // NC.Opennull(ck*, cm*, vote, r)
        //   real key → opens to (vote, r) → count it
        //   fake key → opens to (0, r)   → discard
        const opensToReal = await nc.openNull(
          election.ncSetup.ckStar,
          nullified,
          vote,
          ncRandom
        );

        const auditEntry = {
          ballotId:     ballot.ballotId,
          serialNumber: ballot.serialNumber,
          nullified:    nullified,
          opensToVote:  vote,
          result:       opensToReal ? "REAL_BALLOT_COUNTED" : "FAKE_BALLOT_DISCARDED",
        };

        if (opensToReal) {
          if (counts.has(vote)) {
            counts.set(vote, counts.get(vote) + 1);
            realBallots++;
          } else {
            auditEntry.result = "REAL_BUT_UNKNOWN_CANDIDATE";
            decryptErrors++;
          }
        } else {
          // Check if it opens to zero (the nullifiability property)
          const opensToZero = await nc.openNull(
            election.ncSetup.ckStar,
            nullified,
            "0",
            ncRandom
          );
          auditEntry.opensToZero = opensToZero;
          fakeBallots++;
        }

        auditLog.push(auditEntry);
      } else {
        // No NC setup or no ncCommitment — fall back to plain count
        // (legacy ballots from before the enhancement)
        if (counts.has(vote)) {
          counts.set(vote, counts.get(vote) + 1);
          realBallots++;
          auditLog.push({
            ballotId: ballot.ballotId,
            result: "COUNTED_LEGACY_NO_NC",
          });
        }
      }
    }

    const results = election.candidates.map((c) => ({
      candidateId:   String(c.id),
      candidateName: c.name,
      votes:         counts.get(String(c.id)) || 0,
    }));

    const totalCounted = results.reduce((s, r) => s + r.votes, 0);

    return res.json({
      ok: true,
      tally: {
        electionId:        election.electionId,
        generatedAt:       new Date().toISOString(),
        ncNullificationUsed: hasNcSetup,
        acceptedBallots:   accepted,
        realBallots,
        fakeBallots,       // ballots cast with fake keys (coercion ballots)
        decryptErrors,
        nullifyErrors,
        totalCounted,
        results,
      },
      auditLog,
      explanation: hasNcSetup
        ? "Tally used NC nullification (§4.4 Construction 2). " +
          "Fake-key ballots are identified by the master secret key and " +
          "discarded before counting, with O(n) complexity."
        : "NC setup not found — tally fell back to legacy mode.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── Legacy tally (original behaviour, for comparison) ────────────────────────

router.get("/legacy-tally", async (_req, res, next) => {
  try {
    const [election, votes] = await Promise.all([
      loadElectionWithNc(),
      readJson("votes.json", []),
    ]);

    const counts = new Map(
      election.candidates.map((c) => [String(c.id), 0])
    );

    let accepted = 0;
    let errors = 0;

    for (const ballot of votes) {
      if (ballot.status !== "ACCEPTED_VERIFIED") continue;
      accepted++;

      try {
        const payload = decryptVotePayload(ballot.sealedVote);
        const vote = String(payload.vote);
        const voteSalt = String(payload.voteSalt);

        const recomputed = await computeVoteCommitment({ vote, voteSalt });
        if (recomputed !== ballot.voteCommitment) { errors++; continue; }

        if (!counts.has(vote)) { errors++; continue; }
        counts.set(vote, counts.get(vote) + 1);
      } catch {
        errors++;
      }
    }

    const results = election.candidates.map((c) => ({
      candidateId:   String(c.id),
      candidateName: c.name,
      votes:         counts.get(String(c.id)) || 0,
    }));

    return res.json({
      ok: true,
      tally: {
        electionId: election.electionId,
        generatedAt: new Date().toISOString(),
        mode: "LEGACY_NO_NULLIFICATION",
        acceptedBallots: accepted,
        errors,
        results,
      },
      warning:
        "Legacy tally does NOT perform nullification. " +
        "Fake-key ballots (coercion ballots) are counted alongside real votes. " +
        "Use GET /api/results/tally for the coercion-resistant tally.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── GET /api/results/nullify/:ballotId — single-ballot audit ─────────────────

router.get("/nullify/:ballotId", async (req, res, next) => {
  try {
    const { ballotId } = req.params;

    const [election, votes] = await Promise.all([
      loadElectionWithNc(),
      readJson("votes.json", []),
    ]);

    const ballot = votes.find((v) => v.ballotId === ballotId);
    if (!ballot) return res.status(404).json({ ok: false, error: "Ballot not found." });

    if (!election.ncSetup) {
      return res.status(503).json({ ok: false, error: "NC setup not available." });
    }

    if (!ballot.ncCommitment) {
      return res.json({
        ok: true,
        ballotId,
        result: "NO_NC_COMMITMENT",
        message: "This ballot was cast before the NC enhancement.",
      });
    }

    const nullified = await nc.nullify(election.ncSetup.msk, ballot.ncCommitment);

    let payload;
    try {
      payload = decryptVotePayload(ballot.sealedVote);
    } catch {
      return res.status(500).json({ ok: false, error: "Could not decrypt ballot." });
    }

    const vote    = String(payload.vote);
    const ncRandom = payload.ncRandom ? String(payload.ncRandom) : "0";

    const opensToVote = await nc.openNull(
      election.ncSetup.ckStar,
      nullified,
      vote,
      ncRandom
    );
    const opensToZero = await nc.openNull(
      election.ncSetup.ckStar,
      nullified,
      "0",
      ncRandom
    );

    return res.json({
      ok: true,
      ballotId,
      serialNumber: ballot.serialNumber,
      originalNcCommitment: ballot.ncCommitment,
      nullifiedCommitment: nullified,
      opensToVote,
      opensToZero,
      classification: opensToVote
        ? "REAL_BALLOT — cast with a real casting key"
        : opensToZero
          ? "FAKE_BALLOT — cast with a fake casting key (coercion scenario)"
          : "UNKNOWN — neither real nor fake opened; possible data corruption",
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
