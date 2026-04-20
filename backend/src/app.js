const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const electionRoutes    = require("./routes/electionRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const voteRoutes        = require("./routes/voteRoutes");
const resultRoutes      = require("./routes/resultRoutes");
const { getBulletinBoard } = require("./lib/merkleTree");

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "http://localhost:4000"],
      imgSrc:     ["'self'", "data:"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service:   "zkVoting-backend (enhanced)",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/election",  electionRoutes);
app.use("/api/register",  registrationRoutes);
app.use("/api/votes",     voteRoutes);
app.use("/api/results",   resultRoutes);

// ── Public Bulletin Board ────────────────────────────────────────────────────
//
// Anyone can inspect the registered casting-key set and verify:
//  • The Merkle root (for eligibility verifiability)
//  • That the number of real-key entries equals the number of eligible voters
//    (the registrar publishes a πtotal proof for this — §4.2 of the paper)
//
app.get("/api/bulletin-board", async (_req, res, next) => {
  try {
    const bb = await getBulletinBoard();
    res.json({
      ok: true,
      bulletinBoard: {
        merkleRoot:   bb.root,
        merkleDepth:  bb.depth,
        totalEntries: bb.totalEntries,
        entries:      bb.entries,
        note: [
          "This is the public casting-key set (§4.2 of the zkVoting paper).",
          "Each entry is (ckHash, pkid) for one registered voter.",
          "Merkle root rt = Π_M.BuildSet(CKlist).",
          "Real and fake keys are indistinguishable here — only the",
          "authority can distinguish them using the master secret key.",
        ].join(" "),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Admin / Research endpoints ───────────────────────────────────────────────

const fs = require("fs");
const DATA_DIR = path.resolve(__dirname, "..", "data");

// List all registered voters (for dashboard voter selector)
app.get("/api/admin/voters", async (_req, res, next) => {
  try {
    const { readJson } = require("./lib/jsonStore");
    const voters = await readJson("voters.json", []);
    res.json({
      ok: true,
      voters: voters.map((v) => ({
        voterId: v.voterId,
        identityTag: v.identityTag,
        keyType: v.keyType || "real",
        pkid: v.pkid,
        ckHash: v.ckHash,
        ckHashE: v.ckHashE,
        bbIndex: v.bbIndex,
        hasSubmittedBallot: v.hasSubmittedBallot,
        createdAt: v.createdAt,
        hasFakeKeys: !!(v.fakeKeys && v.fakeKeys.length),
      })),
    });
  } catch (err) { next(err); }
});

// Raw JSON data file viewer
app.get("/api/admin/raw/:filename", (req, res) => {
  const allowed = ["voters.json","votes.json","election.json","nullifiers.json","bulletinBoard.json","registrationCommits.json"];
  const file = req.params.filename;
  if (!allowed.includes(file)) return res.status(400).json({ ok: false, error: "File not allowed." });
  const filePath = path.join(DATA_DIR, file);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    res.json({ ok: true, filename: file, data: JSON.parse(raw) });
  } catch {
    res.json({ ok: true, filename: file, data: null, note: "File does not exist yet." });
  }
});

// Reset all data (for fresh experiments)
app.post("/api/admin/reset", async (_req, res) => {
  const files = {
    "voters.json": "[]",
    "votes.json": "[]",
    "nullifiers.json": "[]",
    "bulletinBoard.json": '{"entries":[],"root":null,"depth":16}',
    "registrationCommits.json": '{"commits":[]}',
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(DATA_DIR, name), content);
  }
  // Remove election.json to allow re-init
  try { fs.unlinkSync(path.join(DATA_DIR, "election.json")); } catch {}
  res.json({ ok: true, message: "All data wiped. Ready for new experiment." });
});

// ── Frontend static files ────────────────────────────────────────────────────
const frontendDir = path.resolve(__dirname, "..", "..", "frontend");
app.use(express.static(frontendDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

module.exports = app;
