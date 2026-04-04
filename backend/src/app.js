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

app.use(helmet());
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
