/**
 * πtotal — Eligibility Proof (§4.2 of the zkVoting paper)
 *
 * IMPROVEMENT OVER THE PAPER
 * ─────────────────────────────────────────────────────────────────────────────
 * The paper states (§4.2) that the authority must publish a proof πtotal
 * guaranteeing that exactly nv REAL casting keys were issued — one per eligible
 * voter.  This prevents ballot stuffing (the authority secretly issuing extra
 * real keys to cast phantom votes).
 *
 * Relation Rtotal:
 *   { (ck*, cm, nv ; msk) :
 *       cm*  ← NC.Nullify(msk, cm),
 *       NC.OpenNull(ck*, cm*, nv, 0) = 1 }
 *
 * The paper mentions this requirement and includes Rtotal in Table 3
 * (2,243 constraints) but provides no implementation.  We implement it here
 * using the HOMOMORPHIC PROPERTY of the nullifiable commitment scheme:
 *
 *   If we commit 1 under each issued key with randomness 0:
 *       cm_i = NC.Commit(ck_i, 1; 0)
 *   Then the aggregate commitment is:
 *       cm_agg = Σ cm_i  (EC point addition)
 *   After nullification:
 *       cm*_agg = NC.Nullify(msk, cm_agg)
 *   This opens to  Σ b_i  (the number of REAL keys), because:
 *       • real key:  cm*_i = gStar^0 · hStar^1 = hStar  (adds to count)
 *       • fake key:  cm*_i = gStar^0 · hStar^0 = identity (adds 0)
 *
 * The correctness is then:
 *   NC.OpenNull(ck*, cm*_agg, nv, 0) = 1  iff  nv real keys were issued
 *
 * We prove this with a non-interactive Schnorr proof that the authority
 * knows msk such that cm*_agg opens correctly.  This is an instantiation of
 * a DLEQ (Discrete Log Equality) proof, which is much simpler than a full
 * Groth16 circuit for Rtotal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const nc = require("./nullifiableCommitment");

let _bj = null;
async function getBJ() {
  if (!_bj) _bj = await buildBabyjub();
  return _bj;
}

let _poseidon = null;
async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

async function poseidonHash(values) {
  const p = await getPoseidon();
  return p.F.toString(p(values.map((v) => BigInt(String(v)))));
}

async function objToPoint(o) {
  const bj = await getBJ();
  const F = bj.F;
  return [F.e(BigInt(o.x)), F.e(BigInt(o.y))];
}

async function pointToObj(P) {
  const bj = await getBJ();
  const F = bj.F;
  return { x: F.toString(P[0]), y: F.toString(P[1]) };
}

async function addPoints(P, Q) {
  const bj = await getBJ();
  return bj.addPoint(P, Q);
}

// ── EC identity element ───────────────────────────────────────────────────────

async function identityPoint() {
  const bj = await getBJ();
  const F = bj.F;
  return [F.e(0n), F.e(1n)];
}

// ── Core accumulation ─────────────────────────────────────────────────────────

/**
 * Compute the per-key contribution to cm_agg:
 *   cm_key = NC.Commit(ck, 1; 0)   — message = 1, randomness = 0
 *
 * For real key: after nullification this contributes hStar^1 = hStar (adds 1)
 * For fake key: after nullification this contributes hStar^0 = identity (adds 0)
 */
async function computeKeyContribution(mpk, ck) {
  return nc.commit(mpk, ck, "1", "0");
}

/**
 * Aggregate two EC-commitment pairs by adding their components:
 *   cm_agg.C1 = cm_a.C1 + cm_b.C1
 *   cm_agg.C2 = cm_a.C2 + cm_b.C2
 */
async function aggregateCommitments(cm_a, cm_b) {
  const C1a = await objToPoint(cm_a.C1);
  const C1b = await objToPoint(cm_b.C1);
  const C2a = await objToPoint(cm_a.C2);
  const C2b = await objToPoint(cm_b.C2);

  const C1 = await addPoints(C1a, C1b);
  const C2 = await addPoints(C2a, C2b);

  return { C1: await pointToObj(C1), C2: await pointToObj(C2) };
}

// ── Non-interactive DLEQ proof for πtotal ────────────────────────────────────
//
// We prove knowledge of msk such that:
//   cm*_agg = NC.Nullify(msk, cm_agg)
//   NC.OpenNull(ck*, cm*_agg, nv, 0) = 1
//
// This is equivalent to:
//   cm*_agg = hStar^nv  (since r = 0 for all key contributions)
//
// We use a Schnorr proof on the nullification step.  The proof shows the
// authority knows msk such that:
//   cm_agg.C2 - msk · cm_agg.C1 = hStar^nv
//
// DLEQ statement:
//   (g1, cm_agg.C1, cm*_agg, g4)  s.t.  msk: g4 = msk·g1  AND  cm*_agg = cm_agg.C2 - msk·cm_agg.C1
//
// For the Schnorr proof (using Fiat-Shamir):
//   t ← Z_q
//   A1 = t·g1          (commitment on first relation)
//   A2 = -t·cm_agg.C1  (commitment on second relation)
//   c  = H(g1, g4, cm_agg.C1, cm*_agg, A1, A2, nv)
//   k  = t + msk·c
//   π  = (A1, A2, k, c)
//
// Verify:
//   c' = H(g1, g4, cm_agg.C1, cm*_agg, A1, A2, nv)  →  c' == c
//   k·g1 == A1 + c·g4
//   -k·cm_agg.C1 + cm_agg.C2 - cm*_agg == A2 + c·(cm*_agg - cm*_agg)   [simplifies]
//   k·g1 - cm*_agg·c == A2 ... hmm
//
// Simpler: directly prove the discrete log relation:
//   msk·g1 = g4  (g4 is published in mpk)
//   and that the nullification is correct given msk.

async function generateTotalProof(mpk, msk, cmAgg, nvReal, ckStar) {
  const bj = await getBJ();
  const F = bj.F;
  const SUBORDER = nc.SUBORDER;

  const g1    = await objToPoint(mpk.g1);
  const g4    = await objToPoint(mpk.g4);         // g4 = msk·g1
  const C1agg = await objToPoint(cmAgg.C1);
  const mskBig = BigInt(msk);

  // Nullify the aggregated commitment
  const cmStar = await nc.nullify(msk, cmAgg);
  const cmStarPt = await objToPoint(cmStar);

  // Schnorr proof for  msk·g1 = g4
  // AND               msk·C1_agg removed from C2_agg gives cm* (verified separately)
  const t = BigInt(nc.randomScalar());

  const A1 = await bj.mulPointEscalar(g1, t);         // t·g1
  const negC1 = [F.neg(C1agg[0]), C1agg[1]];          // -C1_agg
  const A2 = await bj.mulPointEscalar(negC1, t);       // -t·C1_agg  (= t·(-C1_agg))

  const A1obj = await pointToObj(A1);
  const A2obj = await pointToObj(A2);

  // Fiat-Shamir challenge
  const c = ((BigInt(await poseidonHash([
    mpk.g1.x, mpk.g4.x,
    cmAgg.C1.x, cmStar.x,
    A1obj.x, A2obj.x,
    nvReal,
  ])) % SUBORDER) + SUBORDER) % SUBORDER;

  const k = ((t + mskBig * c) % SUBORDER + SUBORDER) % SUBORDER;

  // Verify before returning
  const valid = await verifyTotalProof(
    mpk, cmAgg, cmStar, nvReal, ckStar,
    { A1: A1obj, A2: A2obj, k: k.toString(), c: c.toString() }
  );

  if (!valid) throw new Error("[πtotal] Self-verification failed — bug in proof generation.");

  return {
    cmAgg,
    cmStar,
    nvReal,
    proof: { A1: A1obj, A2: A2obj, k: k.toString(), c: c.toString() },
  };
}

/**
 * Verify the πtotal proof.
 *
 * Checks:
 *   1. NC.OpenNull(ck*, cm*, nv, 0) = 1  (cm* opens to nv with r=0)
 *   2. Schnorr: k·g1 = A1 + c·g4         (authority knows msk = log_g1(g4))
 *   3. Schnorr: -k·C1_agg + cm_agg.C2 - cm* = A2 + c·(something_zero)
 *              which simplifies to: cm*_check = cm_agg.C2 - k·C1_agg + c·cm*
 *              Actually let's just verify: k·g1 == A1 + c·g4
 *              AND that the nullification is consistent with cm* = C2 - msk·C1
 *              We can verify (2) and separately verify (1).
 */
async function verifyTotalProof(mpk, cmAgg, cmStar, nvReal, ckStar, proof) {
  const bj = await getBJ();
  const F  = bj.F;
  const SUBORDER = nc.SUBORDER;

  const g1     = await objToPoint(mpk.g1);
  const g4     = await objToPoint(mpk.g4);
  const C1agg  = await objToPoint(cmAgg.C1);
  const C2agg  = await objToPoint(cmAgg.C2);
  const cmStarPt = await objToPoint(cmStar);
  const A1     = await objToPoint(proof.A1);
  const A2     = await objToPoint(proof.A2);
  const k      = BigInt(proof.k);
  const c      = BigInt(proof.c);

  // Check 1: NC.OpenNull(ck*, cm*, nv, 0) = 1
  const opensCorrectly = await nc.openNull(ckStar, cmStar, String(nvReal), "0");
  if (!opensCorrectly) return false;

  // Check 2: Fiat-Shamir challenge re-derivation
  const cExpected = ((BigInt(await poseidonHash([
    mpk.g1.x, mpk.g4.x,
    cmAgg.C1.x, cmStar.x,
    proof.A1.x, proof.A2.x,
    nvReal,
  ])) % SUBORDER) + SUBORDER) % SUBORDER;
  if (cExpected !== c) return false;

  // Check 3: k·g1 == A1 + c·g4  (Schnorr on msk)
  const lhs3 = await bj.mulPointEscalar(g1, k);
  const cg4  = await bj.mulPointEscalar(g4, c);
  const rhs3 = await addPoints(A1, cg4);
  if (!F.eq(lhs3[0], rhs3[0]) || !F.eq(lhs3[1], rhs3[1])) return false;

  // Check 4: Schnorr on the nullification relation.
  //   A2 = t·(-C1_agg),  k = t + msk·c
  //   Verify: k·C1_agg == -A2 + c·(C2_agg - cm*)
  //   because:  k·C1 = (t + msk·c)·C1 = t·C1 + msk·c·C1
  //            -A2 = t·C1
  //            c·(C2-cm*) = c·msk·C1
  //   So RHS = t·C1 + c·msk·C1 = LHS  ✓
  const lhs4      = await bj.mulPointEscalar(C1agg, k);                     // k·C1_agg
  const negA2     = [F.neg(A2[0]), A2[1]];                                  // -A2
  const negCmStar = [F.neg(cmStarPt[0]), cmStarPt[1]];
  const C2minusCmStar = await addPoints(C2agg, negCmStar);                  // C2_agg - cm*
  const cTerm4    = await bj.mulPointEscalar(C2minusCmStar, c);             // c·(C2_agg - cm*)
  const rhs4      = await addPoints(negA2, cTerm4);                         // -A2 + c·(C2-cm*)
  if (!F.eq(lhs4[0], rhs4[0]) || !F.eq(lhs4[1], rhs4[1])) return false;

  return true;
}

module.exports = {
  computeKeyContribution,
  aggregateCommitments,
  generateTotalProof,
  verifyTotalProof,
};
