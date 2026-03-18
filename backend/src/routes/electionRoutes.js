const express = require("express");
const { readJson } = require("../lib/jsonStore");

const router = express.Router();

router.get("/", async (_req, res, next) => {
  try {
    const election = await readJson("election.json", {
      electionId: "1001",
      name: "zkVoting Demo Election",
      description: "Default election data",
      candidates: [],
    });

    res.json({
      ok: true,
      election: {
        electionId: election.electionId,
        name: election.name,
        description: election.description,
        candidates: election.candidates,
        candidateIds: election.candidates.map((candidate) => candidate.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

