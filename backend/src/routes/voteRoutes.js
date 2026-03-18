const crypto = require("crypto");
const express = require("express");
const { readJson, writeJson } = require("../lib/jsonStore");
const {
  encryptVotePayload,
} = require("../lib/cryptoUtils");
const {
  toCandidateIdList,
  computeSerialNumber,
  computeVoteCommitment,
  generateProof,
  verifyProof,
  validatePublicSignalLayout,
} = require("../lib/zkService");

const router = express.Router();

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeNullifierList(nullifiers) {
  if (!Array.isArray(nullifiers)) {
    return [];
  }
  return nullifiers.map((entry) => String(entry));
}

async function loadVoteContext() {
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

  return {
    voters,
    votes,
    nullifiers: normalizeNullifierList(nullifiers),
    election,
  };
}

function findVoter(voters, voterId) {
  return voters.find((entry) => entry.voterId === voterId);
}

function isCandidateAllowed(election, vote) {
  return toCandidateIdList(election).includes(String(vote));
}

function ensureNoDoubleVote({
  voter,
  serialNumber,
  nullifiers,
  votes,
}) {
  if (voter.hasSubmittedBallot) {
    return {
      ok: false,
      status: 409,
      error: "This voter has already submitted a ballot.",
    };
  }

  if (nullifiers.includes(serialNumber)) {
    return {
      ok: false,
      status: 409,
      error: "Duplicate serial number detected in nullifier set.",
    };
  }

  const duplicateSerial = votes.some((vote) => vote.serialNumber === serialNumber);
  if (duplicateSerial) {
    return {
      ok: false,
      status: 409,
      error: "Duplicate serial number detected in ballot store.",
    };
  }

  return { ok: true };
}

async function storeAcceptedBallot({
  voters,
  votes,
  nullifiers,
  voter,
  serialNumber,
  voteCommitment,
  proof,
  publicSignals,
  vote,
  voteSalt,
}) {
  const ballot = {
    ballotId: crypto.randomUUID(),
    serialNumber,
    voteCommitment,
    proof,
    publicSignals,
    sealedVote: encryptVotePayload({
      vote: String(vote),
      voteSalt: String(voteSalt),
    }),
    status: "ACCEPTED_VERIFIED",
    submittedAt: new Date().toISOString(),
  };

  votes.push(ballot);
  voter.hasSubmittedBallot = true;
  voter.serialNumber = serialNumber;

  const nullifierSet = new Set(nullifiers);
  nullifierSet.add(serialNumber);

  await Promise.all([
    writeJson("votes.json", votes),
    writeJson("voters.json", voters),
    writeJson("nullifiers.json", Array.from(nullifierSet)),
  ]);

  return ballot;
}

router.post("/cast", async (req, res, next) => {
  try {
    const voterId = normalizeString(req.body.voterId);
    const vote = normalizeString(req.body.vote);

    if (!voterId || !vote) {
      return res.status(400).json({
        ok: false,
        error: "voterId and vote are required.",
      });
    }

    const { voters, votes, nullifiers, election } = await loadVoteContext();
    const voter = findVoter(voters, voterId);

    if (!voter) {
      return res.status(404).json({
        ok: false,
        error: "Voter not found. Register first.",
      });
    }

    if (!isCandidateAllowed(election, vote)) {
      return res.status(400).json({
        ok: false,
        error: "Selected vote is not in the candidate list.",
      });
    }

    const voteSalt = BigInt(`0x${crypto.randomBytes(31).toString("hex")}`).toString();
    const serialNumber = await computeSerialNumber({
      electionId: election.electionId,
      castingKey: voter.castingKey,
      voterSecret: voter.voterSecret,
    });
    const voteCommitment = await computeVoteCommitment({
      vote,
      voteSalt,
    });

    const voteCheck = ensureNoDoubleVote({
      voter,
      serialNumber,
      nullifiers,
      votes,
    });
    if (!voteCheck.ok) {
      return res.status(voteCheck.status).json({
        ok: false,
        error: voteCheck.error,
      });
    }

    const candidateList = toCandidateIdList(election);
    const input = {
      vote: String(vote),
      voterSecret: String(voter.voterSecret),
      castingKey: String(voter.castingKey),
      voteSalt: String(voteSalt),
      electionId: String(election.electionId),
      candidateList,
      serialNumber,
      voteCommitment,
    };

    const { proof, publicSignals } = await generateProof(input);
    const signalLayout = await validatePublicSignalLayout({
      publicSignals,
      election,
      serialNumber,
      voteCommitment,
    });
    if (!signalLayout.ok) {
      return res.status(400).json({
        ok: false,
        error: signalLayout.error,
      });
    }

    const isValid = await verifyProof(publicSignals, proof);
    if (!isValid) {
      return res.status(400).json({
        ok: false,
        error: "Generated proof verification failed.",
      });
    }

    const ballot = await storeAcceptedBallot({
      voters,
      votes,
      nullifiers,
      voter,
      serialNumber,
      voteCommitment,
      proof,
      publicSignals,
      vote,
      voteSalt,
    });

    return res.status(201).json({
      ok: true,
      message: "Vote cast and proof verified successfully.",
      receipt: {
        ballotId: ballot.ballotId,
        serialNumber: ballot.serialNumber,
        voteCommitment: ballot.voteCommitment,
        status: ballot.status,
        submittedAt: ballot.submittedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const voterId = normalizeString(req.body.voterId);
    const serialNumber = normalizeString(req.body.serialNumber);
    const voteCommitment = normalizeString(req.body.voteCommitment);
    const vote = normalizeString(req.body.vote);
    const voteSalt = normalizeString(req.body.voteSalt);
    const { proof, publicSignals } = req.body;

    if (
      !voterId ||
      !serialNumber ||
      !voteCommitment ||
      !vote ||
      !voteSalt ||
      !proof ||
      !Array.isArray(publicSignals)
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "voterId, serialNumber, voteCommitment, vote, voteSalt, proof, publicSignals are required.",
      });
    }

    const { voters, votes, nullifiers, election } = await loadVoteContext();
    const voter = findVoter(voters, voterId);

    if (!voter) {
      return res.status(404).json({
        ok: false,
        error: "Voter not found. Register first.",
      });
    }

    if (!isCandidateAllowed(election, vote)) {
      return res.status(400).json({
        ok: false,
        error: "Selected vote is not in the candidate list.",
      });
    }

    const expectedSerial = await computeSerialNumber({
      electionId: election.electionId,
      castingKey: voter.castingKey,
      voterSecret: voter.voterSecret,
    });
    if (expectedSerial !== serialNumber) {
      return res.status(400).json({
        ok: false,
        error: "serialNumber does not match registered voter credentials.",
      });
    }

    const expectedCommitment = await computeVoteCommitment({
      vote,
      voteSalt,
    });
    if (expectedCommitment !== voteCommitment) {
      return res.status(400).json({
        ok: false,
        error: "voteCommitment does not match (vote, voteSalt).",
      });
    }

    const signalLayout = await validatePublicSignalLayout({
      publicSignals,
      election,
      serialNumber,
      voteCommitment,
    });
    if (!signalLayout.ok) {
      return res.status(400).json({
        ok: false,
        error: signalLayout.error,
      });
    }

    const voteCheck = ensureNoDoubleVote({
      voter,
      serialNumber,
      nullifiers,
      votes,
    });
    if (!voteCheck.ok) {
      return res.status(voteCheck.status).json({
        ok: false,
        error: voteCheck.error,
      });
    }

    const isValid = await verifyProof(publicSignals, proof);
    if (!isValid) {
      return res.status(400).json({
        ok: false,
        error: "Proof verification failed.",
      });
    }

    const ballot = await storeAcceptedBallot({
      voters,
      votes,
      nullifiers,
      voter,
      serialNumber,
      voteCommitment,
      proof,
      publicSignals,
      vote,
      voteSalt,
    });

    return res.status(201).json({
      ok: true,
      message: "Ballot accepted after proof verification.",
      receipt: {
        ballotId: ballot.ballotId,
        serialNumber: ballot.serialNumber,
        voteCommitment: ballot.voteCommitment,
        status: ballot.status,
        submittedAt: ballot.submittedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/stats", async (_req, res, next) => {
  try {
    const [voters, votes, nullifiers] = await Promise.all([
      readJson("voters.json", []),
      readJson("votes.json", []),
      readJson("nullifiers.json", []),
    ]);

    const acceptedVotes = votes.filter(
      (vote) => vote.status === "ACCEPTED_VERIFIED",
    ).length;

    res.json({
      ok: true,
      stats: {
        registeredVoters: voters.length,
        votesReceived: votes.length,
        acceptedVotes,
        nullifiersUsed: normalizeNullifierList(nullifiers).length,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/receipt/:serialNumber", async (req, res, next) => {
  try {
    const serialNumber = normalizeString(req.params.serialNumber);
    if (!serialNumber) {
      return res.status(400).json({
        ok: false,
        error: "serialNumber is required.",
      });
    }

    const votes = await readJson("votes.json", []);
    const ballot = votes.find((entry) => entry.serialNumber === serialNumber);
    if (!ballot) {
      return res.status(404).json({
        ok: false,
        error: "No ballot found for this serial number.",
      });
    }

    return res.json({
      ok: true,
      receipt: {
        ballotId: ballot.ballotId,
        serialNumber: ballot.serialNumber,
        voteCommitment: ballot.voteCommitment,
        status: ballot.status,
        submittedAt: ballot.submittedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
