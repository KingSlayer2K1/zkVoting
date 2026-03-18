const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const electionRoutes = require("./routes/electionRoutes");
const registrationRoutes = require("./routes/registrationRoutes");
const voteRoutes = require("./routes/voteRoutes");
const resultRoutes = require("./routes/resultRoutes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "zkVoting-backend",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/election", electionRoutes);
app.use("/api/register", registrationRoutes);
app.use("/api/votes", voteRoutes);
app.use("/api/results", resultRoutes);

// Serve frontend so http://localhost:4000 works directly.
const frontendDir = path.resolve(__dirname, "..", "..", "frontend");
app.use(express.static(frontendDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: "Internal server error",
  });
});

module.exports = app;
