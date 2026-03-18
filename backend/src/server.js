const dotenv = require("dotenv");
const app = require("./app");

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, () => {
  console.log(`zkVoting backend listening on http://localhost:${PORT}`);
});

