const crypto = require("crypto");
const express = require("express");
const { readJson, writeJson } = require("../lib/jsonStore");
const { randomFieldElement } = require("../lib/cryptoUtils");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const identityTag = String(req.body.identityTag || "").trim();
    if (!identityTag) {
      return res.status(400).json({
        ok: false,
        error: "identityTag is required for registration.",
      });
    }

    const [voters, election] = await Promise.all([
      readJson("voters.json", []),
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

    const duplicate = voters.find((voter) => voter.identityTag === identityTag);
    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "This identityTag is already registered.",
      });
    }

    // Paper-aligned registration output:
    // voter creates/holds skid (voterSecret), registrar issues casting key ck.
    const voter = {
      voterId: crypto.randomUUID(),
      identityTag,
      voterSecret: randomFieldElement(),
      castingKey: randomFieldElement(),
      hasSubmittedBallot: false,
      createdAt: new Date().toISOString(),
    };

    voters.push(voter);
    await writeJson("voters.json", voters);

    return res.status(201).json({
      ok: true,
      message: "Registration successful.",
      voter: {
        voterId: voter.voterId,
        identityTag: voter.identityTag,
        createdAt: voter.createdAt,
      },
      privateCredentials: {
        voterSecret: voter.voterSecret,
        castingKey: voter.castingKey,
      },
      election: {
        electionId: election.electionId,
        candidateIds: election.candidates.map((candidate) => candidate.id),
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

