/**
 * Poseidon Merkle Tree — bulletin board casting-key set (§4.2 of the paper).
 *
 * The paper publishes a set ID  rt = Π_M.BuildSet(CKlist)  where CKlist is
 * the list of registered (ck, pkid) pairs.  Any verifier can check that a
 * voter's casting key belongs to this set (eligibility verifiability).
 *
 * The enhanced circuit (enhanced_vote.circom) uses the Merkle path as a
 * private witness to prove membership without revealing the voter's position
 * in the tree.
 *
 * Design
 * ──────
 * • Fixed-depth binary Merkle tree (DEPTH = 16 → up to 65 536 voters,
 *   matching the paper's experiment with 2^16 eligible voters).
 * • Leaf i = Poseidon(ckHash_i, pkid_i).
 * • Empty leaf = Poseidon(0, 0)  so the tree is always complete.
 * • Internal node = Poseidon(left_child, right_child).
 * • Root is published on the bulletin board.
 */

"use strict";

const { buildPoseidon } = require("circomlibjs");

const TREE_DEPTH = 16; // 2^16 = 65 536 maximum voters

let _poseidonPromise = null;
function getPoseidon() {
  if (!_poseidonPromise) _poseidonPromise = buildPoseidon();
  return _poseidonPromise;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function pHash(a, b) {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  return F.toString(poseidon([BigInt(String(a)), BigInt(String(b))]));
}

async function emptyLeaf() {
  return pHash("0", "0");
}

/**
 * Build a complete binary Merkle tree over `leaves` (array of field strings).
 * Missing positions are filled with the empty leaf value.
 */
async function buildTree(leaves, depth = TREE_DEPTH) {
  const size = 1 << depth; // 2^depth
  const empty = await emptyLeaf();

  // Pad to full size
  const layer = Array.from({ length: size }, (_, i) =>
    i < leaves.length ? String(leaves[i]) : empty
  );

  const tree = [layer]; // tree[0] = leaves, tree[depth] = [root]

  let current = layer;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(await pHash(current[i], current[i + 1]));
    }
    tree.push(next);
    current = next;
  }

  return tree; // tree[depth][0] is the root
}

function getRoot(tree) {
  return tree[tree.length - 1][0];
}

/**
 * Generate a Merkle inclusion proof for leaf at `index`.
 *
 * Returns { leaf, pathElements, pathIndices, root }
 *   pathElements[i]  — sibling hash at level i
 *   pathIndices[i]   — 0 if current node is the left child, 1 if right
 */
function getMerkleProof(tree, index) {
  const depth = tree.length - 1;
  const pathElements = [];
  const pathIndices = [];

  let idx = index;
  for (let d = 0; d < depth; d++) {
    const layer = tree[d];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    pathElements.push(layer[siblingIdx] ?? layer[layer.length - 1]);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }

  return {
    leaf: tree[0][index],
    pathElements,
    pathIndices,
    root: getRoot(tree),
  };
}

/**
 * Verify a Merkle proof without rebuilding the whole tree.
 */
async function verifyProof(proof) {
  let current = proof.leaf;
  for (let i = 0; i < proof.pathElements.length; i++) {
    const sibling = proof.pathElements[i];
    if (proof.pathIndices[i] === 0) {
      current = await pHash(current, sibling); // current is left
    } else {
      current = await pHash(sibling, current); // current is right
    }
  }
  return current === proof.root;
}

/**
 * Compute the leaf value for a registered voter.
 *
 *   leaf = Poseidon(ckHash, pkid)
 */
async function computeLeaf(ckHash, pkid) {
  return pHash(ckHash, pkid);
}

// ── Persisted bulletin board state ───────────────────────────────────────────

const path = require("path");
const fs = require("fs/promises");

// From backend/src/lib → up 2 levels → backend/data
const BB_PATH = path.resolve(__dirname, "..", "..", "data", "bulletinBoard.json");

async function loadBB() {
  try {
    const raw = await fs.readFile(BB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { entries: [], root: null, depth: TREE_DEPTH };
  }
}

async function saveBB(bb) {
  await fs.writeFile(BB_PATH, JSON.stringify(bb, null, 2));
}

/**
 * Append a new (ckHash, pkid) entry to the bulletin board and recompute the
 * Merkle tree.  Returns the updated root and the proof for the new entry.
 */
async function appendEntry(ckHash, pkid) {
  const bb = await loadBB();
  const index = bb.entries.length;
  bb.entries.push({ ckHash, pkid, index });

  // Build the full tree over all leaf hashes
  const leaves = await Promise.all(
    bb.entries.map((e) => computeLeaf(e.ckHash, e.pkid))
  );
  const tree = await buildTree(leaves, TREE_DEPTH);
  bb.root = getRoot(tree);

  await saveBB(bb);

  const proof = getMerkleProof(tree, index);
  return { index, root: bb.root, proof };
}

/**
 * Get a Merkle proof for an existing entry by index, rebuilding the tree from
 * all stored entries.
 */
async function getProofForEntry(index) {
  const bb = await loadBB();
  if (index >= bb.entries.length) throw new Error("Entry index out of range.");

  const leaves = await Promise.all(
    bb.entries.map((e) => computeLeaf(e.ckHash, e.pkid))
  );
  const tree = await buildTree(leaves, TREE_DEPTH);
  return getMerkleProof(tree, index);
}

/** Return the current Merkle root and all entries (for public bulletin board). */
async function getBulletinBoard() {
  const bb = await loadBB();
  return {
    root: bb.root,
    depth: TREE_DEPTH,
    entries: bb.entries,
    totalEntries: bb.entries.length,
  };
}

module.exports = {
  TREE_DEPTH,
  buildTree,
  getRoot,
  getMerkleProof,
  verifyProof,
  computeLeaf,
  appendEntry,
  getProofForEntry,
  getBulletinBoard,
};
