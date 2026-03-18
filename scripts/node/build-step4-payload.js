const fs = require("fs/promises");
const path = require("path");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const rootDir = path.resolve(__dirname, "..", "..");
  const step4Dir = path.join(rootDir, "circuits", "build", "step4");

  const [context, proof, publicSignals] = await Promise.all([
    readJson(path.join(step4Dir, "context.json")),
    readJson(path.join(step4Dir, "proof.json")),
    readJson(path.join(step4Dir, "public.json")),
  ]);

  const payload = {
    voterId: "replace-with-real-voter-id-from-step5-registration",
    serialNumber: context.serialNumber,
    voteCommitment: context.voteCommitment,
    publicSignals,
    proof,
  };

  await fs.writeFile(
    path.join(step4Dir, "api-payload-template.json"),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

