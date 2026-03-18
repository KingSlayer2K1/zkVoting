const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");

async function ensureDataFile(filePath, defaultValue) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

async function readJson(fileName, defaultValue) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, fileName);
  await ensureDataFile(filePath, defaultValue);

  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON data in ${fileName}`);
  }
}

async function writeJson(fileName, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

module.exports = {
  readJson,
  writeJson,
};

