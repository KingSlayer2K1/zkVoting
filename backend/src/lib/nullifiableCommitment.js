/**
 * Nullifiable Commitment Scheme — Construction 1 from the zkVoting paper.
 *
 * Paper: "zkVoting: Zero-knowledge proof based coercion-resistant and E2E
 *         verifiable e-voting system" (Park, Choi, Kim, Oh — 2024)
 *
 * This is the core cryptographic contribution the basic implementation lacked
 * entirely.  It uses the Baby Jubjub elliptic curve (same scalar field as
 * BN128) so commitments are Circom-circuit-compatible.
 *
 * ─── Construction 1 ──────────────────────────────────────────────────────────
 *  Setup(1^λ):
 *    ρ ←$ Z*_q ; g1, g2, g3 ←$ G ; g4 = ρ·g1
 *    mpk = (g1, g2, g3, g4) ; msk = ρ ; ck* = (g2−g4, g3)
 *
 *  KeyGen(mpk, msk, b ∈ {0,1}):
 *    h1 ←$ G ; h2 = msk·h1 + b·g3
 *    return ck = ((g1,h1), (g2,h2))
 *
 *  Commit(ck, m, r):
 *    C1 = r·g1 + m·h1 ; C2 = r·g2 + m·h2 ; return cm = (C1, C2)
 *
 *  Nullify(msk, cm):
 *    return cm* = C2 − msk·C1
 *      real key → cm* = (g2−g4)^r · g3^m  → Opennull = 1 with (m,r)
 *      fake key → cm* = (g2−g4)^r          → Opennull = 1 with (0,r)
 *
 *  KeyProve (non-interactive Schnorr via Fiat-Shamir):
 *    Proves authority knows msk and generated ck for the claimed bit b.
 *
 *  SimKeyProve (simulation for key deniability):
 *    Generates a verifying proof without msk, enabling a voter to "prove"
 *    any key is real even if it is fake — defeating coercer identification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { buildBabyjub, buildPoseidon } = require("circomlibjs");

// ── Lazy singletons ───────────────────────────────────────────────────────────

let _bjPromise = null;
let _poseidonPromise = null;

async function getBJ() {
  if (!_bjPromise) _bjPromise = buildBabyjub();
  return _bjPromise;
}

async function getPoseidon() {
  if (!_poseidonPromise) _poseidonPromise = buildPoseidon();
  return _poseidonPromise;
}

// ── Scalar field constants ────────────────────────────────────────────────────

/** Baby Jubjub prime-order subgroup cardinality (≈ 2^251). */
const SUBORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

function randomScalar() {
  const { randomBytes } = require("crypto");
  let s;
  do {
    s = BigInt("0x" + randomBytes(32).toString("hex")) % SUBORDER;
  } while (s === 0n);
  return s;
}

function scalarMod(x) {
  return ((x % SUBORDER) + SUBORDER) % SUBORDER;
}

// ── Point serialisation ───────────────────────────────────────────────────────
//
// Baby Jubjub (circomlibjs v0.1.x) represents coordinates as Uint8Array field
// elements (little-endian Montgomery form).  We serialise to/from decimal
// strings so points survive JSON round-trips.

async function pointToObj(P) {
  const bj = await getBJ();
  const F  = bj.F;
  return { x: F.toString(P[0]), y: F.toString(P[1]) };
}

async function objToPoint(o) {
  const bj = await getBJ();
  const F  = bj.F;
  return [F.e(BigInt(o.x)), F.e(BigInt(o.y))];
}

/** Baby Jubjub identity element (neutral point): (0, 1). */
async function identityPoint() {
  const bj = await getBJ();
  const F  = bj.F;
  return [F.e(0n), F.e(1n)];
}

// ── EC helpers ────────────────────────────────────────────────────────────────

async function randomPoint() {
  const bj = await getBJ();
  return bj.mulPointEscalar(bj.Base8, randomScalar());
}

async function negatePoint(P) {
  const bj = await getBJ();
  const F  = bj.F;
  // Twisted Edwards negation: -(x, y) = (-x, y)
  return [F.neg(P[0]), P[1]];
}

async function addPoints(P, Q) {
  const bj = await getBJ();
  return bj.addPoint(P, Q);
}

async function mulPoint(P, scalar) {
  const bj = await getBJ();
  // mulPointEscalar expects a BigInt scalar
  return bj.mulPointEscalar(P, scalarMod(scalar));
}

// ── Poseidon hash ─────────────────────────────────────────────────────────────

async function poseidonHash(values) {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  return F.toString(poseidon(values.map((v) => BigInt(String(v)))));
}

// ════════════════════════════════════════════════════════════════════════════
// Public API — Construction 1
// ════════════════════════════════════════════════════════════════════════════

/**
 * Setup — generates the master key pair (mpk, msk) and the tally key ck*.
 *
 * In practice the authority runs this once during the election Setup phase
 * and securely stores msk (e.g. in an HSM).
 */
async function setup() {
  const bj = await getBJ();

  const msk = randomScalar();

  // Three independent generators (random multiples of Base8).
  const g1 = await mulPoint(bj.Base8, randomScalar());
  const g2 = await mulPoint(bj.Base8, randomScalar());
  const g3 = await mulPoint(bj.Base8, randomScalar());
  const g4 = await mulPoint(g1, msk);              // g4 = msk·g1

  // ck* = (g2 − g4, g3)
  const neg_g4 = await negatePoint(g4);
  const gStar  = await addPoints(g2, neg_g4);       // g2 + (−g4) = g2 − g4

  return {
    mpk: {
      g1: await pointToObj(g1),
      g2: await pointToObj(g2),
      g3: await pointToObj(g3),
      g4: await pointToObj(g4),
    },
    msk: msk.toString(),
    ckStar: {
      gStar: await pointToObj(gStar),
      hStar: await pointToObj(g3),
    },
  };
}

/**
 * KeyGen — issue a real (b=1) or fake (b=0) casting key.
 *
 * Keys are computationally indistinguishable (IK property from §2.1).
 */
async function keyGen(mpk, msk, b) {
  const g3     = await objToPoint(mpk.g3);
  const mskBig = BigInt(msk);

  const h1 = await randomPoint();

  // h2 = msk·h1 + b·g3
  const mskH1 = await mulPoint(h1, mskBig);
  const h2 = b === 1
    ? await addPoints(mskH1, g3)   // real key: includes g3
    : mskH1;                        // fake key: g3 term absent

  const ck = {
    h1: await pointToObj(h1),
    h2: await pointToObj(h2),
  };
  const ckHash = await poseidonHash([ck.h1.x, ck.h1.y, ck.h2.x, ck.h2.y]);

  return { ck, ckHash };
}

/**
 * Commit — produce the EC-based nullifiable commitment (C1, C2).
 *
 *   C1 = r·g1 + m·h1
 *   C2 = r·g2 + m·h2
 */
async function commit(mpk, ck, m, r) {
  const g1   = await objToPoint(mpk.g1);
  const g2   = await objToPoint(mpk.g2);
  const h1   = await objToPoint(ck.h1);
  const h2   = await objToPoint(ck.h2);
  const mBig = scalarMod(BigInt(String(m)));
  const rBig = scalarMod(BigInt(String(r)));

  const C1 = await addPoints(await mulPoint(g1, rBig), await mulPoint(h1, mBig));
  const C2 = await addPoints(await mulPoint(g2, rBig), await mulPoint(h2, mBig));

  return { C1: await pointToObj(C1), C2: await pointToObj(C2) };
}

/**
 * Nullify — the O(1) per-ballot tally operation (§4.4 Construction 2).
 *
 *   cm* = C2 − msk·C1
 *
 * For real key: cm* opens to (m, r) via Opennull.
 * For fake key: cm* opens to (0, r) via Opennull.
 */
async function nullify(msk, cm) {
  const C1    = await objToPoint(cm.C1);
  const C2    = await objToPoint(cm.C2);
  const mskC1 = await mulPoint(C1, BigInt(String(msk)));
  const cmStar = await addPoints(C2, await negatePoint(mskC1));
  return pointToObj(cmStar);
}

/**
 * OpenNull — verify a nullified commitment opens to message m with random r.
 *
 *   Checks: cm* == r·gStar + m·hStar
 */
async function openNull(ckStar, cmStar, m, r) {
  const bj     = await getBJ();
  const F      = bj.F;
  const gStar  = await objToPoint(ckStar.gStar);
  const hStar  = await objToPoint(ckStar.hStar);
  const mBig   = scalarMod(BigInt(String(m)));
  const rBig   = scalarMod(BigInt(String(r)));
  const target = await objToPoint(cmStar);

  const expected = await addPoints(
    await mulPoint(gStar, rBig),
    await mulPoint(hStar, mBig)
  );

  return F.eq(target[0], expected[0]) && F.eq(target[1], expected[1]);
}

/**
 * Open — verify a standard commitment (for debugging / audit).
 */
async function open(mpk, ck, cm, m, r) {
  const bj   = await getBJ();
  const F    = bj.F;
  const g1   = await objToPoint(mpk.g1);
  const g2   = await objToPoint(mpk.g2);
  const h1   = await objToPoint(ck.h1);
  const h2   = await objToPoint(ck.h2);
  const C1   = await objToPoint(cm.C1);
  const C2   = await objToPoint(cm.C2);
  const mBig = scalarMod(BigInt(String(m)));
  const rBig = scalarMod(BigInt(String(r)));

  const expC1 = await addPoints(await mulPoint(g1, rBig), await mulPoint(h1, mBig));
  const expC2 = await addPoints(await mulPoint(g2, rBig), await mulPoint(h2, mBig));

  return (
    F.eq(C1[0], expC1[0]) && F.eq(C1[1], expC1[1]) &&
    F.eq(C2[0], expC2[0]) && F.eq(C2[1], expC2[1])
  );
}

/**
 * KeyProve — non-interactive Schnorr proof (Fiat-Shamir) of correct key
 * generation.  Relation Rck: {(mpk, ck, b; msk) : ck = NC.KeyGen(mpk,msk,b)}
 *
 *   t ← Z_q ; p = t·h1
 *   c = H(g1.x, g3.x, h1.x, h2.x, p.x, b)   ← Fiat-Shamir
 *   k = (t + msk·c) mod q
 *   π = (p, k, c)
 */
async function keyProve(mpk, msk, ck, b) {
  const h1     = await objToPoint(ck.h1);
  const mskBig = BigInt(msk);

  const t = randomScalar();
  const p = await mulPoint(h1, t);               // p = t·h1
  const pObj = await pointToObj(p);

  const c = scalarMod(BigInt(
    await poseidonHash([mpk.g1.x, mpk.g3.x, ck.h1.x, ck.h2.x, pObj.x, b])
  ));

  const k = scalarMod(t + mskBig * c);           // k = t + msk·c

  return { proof: { p: pObj, k: k.toString(), c: c.toString() } };
}

/**
 * VerifyKeyProof — public verification of a KeyProve OR SimKeyProve proof.
 *
 * Checks ONLY the algebraic equation:
 *   k·h1 == p + c·(h2 − b·g3)
 *
 * Intentionally does NOT re-derive c from a Fiat-Shamir hash, because:
 *   • The paper's KeyProve is an interactive Sigma protocol where the verifier
 *     (voter) chooses c AFTER seeing p — the transcript (p, k, c) contains c
 *     directly, not as a hash output.
 *   • SimKeyProve back-computes p for an arbitrary (k', c'), so the algebraic
 *     equation holds by construction but c' is NOT a hash output.
 *   • Both transcripts are indistinguishable (the key deniability property)
 *     because there is no hash commitment to c in the transcript.
 */
async function verifyKeyProof(mpk, ck, proof, b) {
  const bj  = await getBJ();
  const F   = bj.F;
  const h1  = await objToPoint(ck.h1);
  const h2  = await objToPoint(ck.h2);
  const g3  = await objToPoint(mpk.g3);
  const pPt = await objToPoint(proof.p);
  const k   = BigInt(proof.k);
  const c   = BigInt(proof.c);

  // LHS: k·h1
  const lhs = await mulPoint(h1, k);

  // RHS: p + c·(h2 − b·g3)
  const bG3    = b === 1 ? g3 : await identityPoint();
  const negBG3 = await negatePoint(bG3);
  const h2mBG3 = await addPoints(h2, negBG3);  // h2 − b·g3
  const cTerm  = await mulPoint(h2mBG3, c);
  const rhs    = await addPoints(pPt, cTerm);

  return F.eq(lhs[0], rhs[0]) && F.eq(lhs[1], rhs[1]);
}

/**
 * SimKeyProve — simulated proof for KEY DENIABILITY (no msk needed).
 *
 * A coerced voter runs this to "prove" their fake key is real (or vice versa).
 * The coercer cannot distinguish it from a genuine KeyProve proof — this is
 * the cryptographic foundation of coercion resistance.
 *
 *   (k', c') ←$ Z_q
 *   p' = k'·h1 − c'·(h2 − b'·g3)
 *   π' = (p', k', c')   ← verifies correctly by construction
 */
async function simKeyProve(mpk, ck, bClaimed) {
  const h1    = await objToPoint(ck.h1);
  const h2    = await objToPoint(ck.h2);
  const g3    = await objToPoint(mpk.g3);

  const kPrime = randomScalar();
  const cPrime = randomScalar();

  const kh1   = await mulPoint(h1, kPrime);
  const bG3   = bClaimed === 1 ? g3 : await identityPoint();
  const negBG3 = await negatePoint(bG3);
  const h2mBG3 = await addPoints(h2, negBG3);
  const cTerm  = await mulPoint(h2mBG3, cPrime);
  const negCT  = await negatePoint(cTerm);
  const pPrime = await addPoints(kh1, negCT);  // k'·h1 − c'·(h2−b'·g3)

  return {
    proof: {
      p: await pointToObj(pPrime),
      k: kPrime.toString(),
      c: cPrime.toString(),
    },
    note: "SIMULATED — deniable; indistinguishable from a genuine KeyProve.",
  };
}

/** Canonical scalar hash of a casting key for serial number computation. */
async function hashCastingKey(ck) {
  return poseidonHash([ck.h1.x, ck.h1.y, ck.h2.x, ck.h2.y]);
}

module.exports = {
  setup,
  keyGen,
  commit,
  nullify,
  open,
  openNull,
  keyProve,
  verifyKeyProof,
  simKeyProve,
  hashCastingKey,
  randomScalar: () => randomScalar().toString(),
  SUBORDER,
};
