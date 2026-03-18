const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { buildPoseidon } = require("circomlibjs");

function randomFieldElement() {
  const hex = crypto.randomBytes(31).toString("hex");
  return BigInt(`0x${hex}`);
}

async function main() {
  const rootDir = path.resolve(__dirname, "..", "..");
  const step4Dir = path.join(rootDir, "circuits", "build", "step4");
  await fs.mkdir(step4Dir, { recursive: true });

  // Demo values for local proving. They are generated fresh each run.
  const electionId = 1001n;
  const candidateList = [1n, 2n, 3n, 4n, 5n];
  const vote = 3n;
  const voterSecret = randomFieldElement();
  const castingKey = randomFieldElement();
  const voteSalt = randomFieldElement();

  const poseidon = await buildPoseidon();
  const field = poseidon.F;

  // Paper-aligned serial number: sn = H(electionId, castingKey, voterSecret)
  const serialNumber = field.toString(
    poseidon([electionId, castingKey, voterSecret]),
  );
  const voteCommitment = field.toString(poseidon([vote, voteSalt]));

  const input = {
    vote: vote.toString(),
    voterSecret: voterSecret.toString(),
    castingKey: castingKey.toString(),
    voteSalt: voteSalt.toString(),
    electionId: electionId.toString(),
    candidateList: candidateList.map((value) => value.toString()),
    serialNumber,
    voteCommitment,
  };

  const context = {
    generatedAt: new Date().toISOString(),
    electionId: input.electionId,
    candidateList: input.candidateList,
    demoVote: input.vote,
    serialNumber,
    voteCommitment,
  };

  await fs.writeFile(
    path.join(step4Dir, "input.json"),
    JSON.stringify(input, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(step4Dir, "context.json"),
    JSON.stringify(context, null, 2),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

