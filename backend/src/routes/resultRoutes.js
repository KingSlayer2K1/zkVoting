const express = require("express");
const { readJson } = require("../lib/jsonStore");
const { decryptVotePayload } = require("../lib/cryptoUtils");
const { computeVoteCommitment } = require("../lib/zkService");

const router = express.Router();

router.get("/tally", async (_req, res, next) => {
  try {
    const [election, votes] = await Promise.all([
      readJson("election.json", {
        electionId: "1001",
        candidates: [],
      }),
      readJson("votes.json", []),
    ]);

    const counts = new Map(
      election.candidates.map((candidate) => [String(candidate.id), 0]),
    );

    let invalidEncryptedRecords = 0;
    let acceptedBallots = 0;

    for (const ballot of votes) {
      if (ballot.status !== "ACCEPTED_VERIFIED") {
        continue;
      }

      acceptedBallots += 1;

      try {
        const payload = decryptVotePayload(ballot.sealedVote);
        const vote = String(payload.vote);
        const voteSalt = String(payload.voteSalt);
        const recomputedCommitment = await computeVoteCommitment({
          vote,
          voteSalt,
        });

        if (recomputedCommitment !== ballot.voteCommitment) {
          invalidEncryptedRecords += 1;
          continue;
        }

        if (!counts.has(vote)) {
          invalidEncryptedRecords += 1;
          continue;
        }

        counts.set(vote, counts.get(vote) + 1);
      } catch {
        invalidEncryptedRecords += 1;
      }
    }

    const results = election.candidates.map((candidate) => {
      const candidateId = String(candidate.id);
      return {
        candidateId,
        candidateName: candidate.name,
        votes: counts.get(candidateId) || 0,
      };
    });

    const validTalliedVotes = results.reduce(
      (sum, entry) => sum + entry.votes,
      0,
    );

    return res.json({
      ok: true,
      tally: {
        electionId: election.electionId,
        generatedAt: new Date().toISOString(),
        registeredCandidates: election.candidates.length,
        acceptedBallots,
        validTalliedVotes,
        invalidEncryptedRecords,
        results,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

