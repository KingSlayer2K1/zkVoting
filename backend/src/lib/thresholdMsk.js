/**
 * Threshold Master Secret Key — (t, n) Shamir Secret Sharing of msk
 *
 * IMPROVEMENT OVER THE PAPER
 * ─────────────────────────────────────────────────────────────────────────────
 * The zkVoting paper assumes the master secret key msk is held by a single
 * trusted authority (the tallier).  This is a critical single point of failure:
 *
 *   • If msk is leaked, coercion resistance is completely broken — anyone with
 *     msk can nullify commitments and identify which ballots used real vs. fake
 *     casting keys.
 *   • The paper acknowledges the need for a "trusted tallier" but offers no
 *     mechanism to distribute this trust.
 *
 * We improve this by splitting msk into n shares using (t, n)-Shamir Secret
 * Sharing over the Baby Jubjub scalar field (Z_q).  Any t-of-n authorities can
 * reconstruct msk for the tally phase, but no t−1 subset learns any
 * information about msk (information-theoretic security).
 *
 * Protocol:
 *   Split:       splitMsk(msk, t, n) → shares[1..n]
 *   Reconstruct: reconstructMsk(t shares) → msk    (Lagrange interpolation)
 *   Verify:      each share is verifiable against public commitments (VSS)
 *
 * In practice each of the n authorities holds one share and participates in
 * a threshold decryption / tally ceremony.  The tally proceeds only when
 * t authorities submit their shares.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

/** Baby Jubjub scalar field order (same as Poseidon/BN128 scalar field). */
const SUBORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

function mod(x) {
  return ((x % SUBORDER) + SUBORDER) % SUBORDER;
}

function randomScalar() {
  const { randomBytes } = require("crypto");
  let s;
  do { s = BigInt("0x" + randomBytes(32).toString("hex")) % SUBORDER; }
  while (s === 0n);
  return s;
}

// ── Shamir Secret Sharing ─────────────────────────────────────────────────────

/**
 * Split `secret` (BigInt) into `n` shares using a random degree-(t-1) polynomial.
 *
 * The polynomial is:  f(x) = secret + a1·x + a2·x^2 + ... + a_{t-1}·x^{t-1}
 * Share i = (i, f(i))  for  i = 1 .. n
 *
 * Any t shares suffice to reconstruct f(0) = secret.
 * Any t−1 or fewer shares reveal no information about the secret.
 */
function splitMsk(secret, t, n) {
  if (t < 2) throw new Error("Threshold t must be at least 2.");
  if (n < t) throw new Error("Total shares n must be at least t.");

  const secretBig = mod(BigInt(String(secret)));

  // Random coefficients [a1, a2, ..., a_{t-1}]
  const coeffs = Array.from({ length: t - 1 }, randomScalar);

  // f(x) = secret + a1·x + a2·x^2 + ... + a_{t-1}·x^{t-1}
  function evaluate(x) {
    let result = secretBig;
    let xPow = BigInt(x);
    for (const a of coeffs) {
      result = mod(result + mod(a * xPow));
      xPow = mod(xPow * BigInt(x));
    }
    return result;
  }

  const shares = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    value: evaluate(i + 1).toString(),
  }));

  // Public polynomial commitments (Feldman VSS) for share verification
  // Commitment i: g^{a_i} where g is Baby Jubjub Base8
  // (We compute these asynchronously — see verifyShare)
  return { shares, t, n };
}

/**
 * Reconstruct the secret from any t shares using Lagrange interpolation.
 *
 * @param {Array<{index:number, value:string}>} shares  — at least t shares
 * @returns {string}  — the reconstructed secret (decimal string)
 */
function reconstructMsk(shares) {
  if (shares.length < 2) {
    throw new Error("Need at least t shares to reconstruct.");
  }

  let secret = 0n;

  for (let i = 0; i < shares.length; i++) {
    const xi = BigInt(shares[i].index);
    const yi = BigInt(shares[i].value);

    // Lagrange basis polynomial L_i(0) = Π_{j≠i} (0 - x_j) / (x_i - x_j)
    let num = 1n;
    let den = 1n;

    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      const xj = BigInt(shares[j].index);
      num = mod(num * mod(SUBORDER - xj));      // (0 - xj) mod q
      den = mod(den * mod(xi + SUBORDER - xj)); // (xi - xj) mod q
    }

    // Modular inverse of den (Fermat's little theorem: den^{q-2} mod q)
    const denInv = modPow(den, SUBORDER - 2n, SUBORDER);
    const lagrange = mod(num * denInv);
    secret = mod(secret + mod(yi * lagrange));
  }

  return secret.toString();
}

/** Fast modular exponentiation. */
function modPow(base, exp, mod) {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = result * base % mod;
    exp = exp / 2n;
    base = base * base % mod;
  }
  return result;
}

// ── Feldman VSS — verifiable secret sharing ───────────────────────────────────

/**
 * Generate Feldman VSS commitments so each authority can independently verify
 * their share without trusting the dealer.
 *
 * Commitments: C_j = a_j · Base8  for j = 0..t-1  (a_0 = secret)
 *
 * A share (i, s_i) is valid if:
 *   s_i · Base8 == Σ_{j=0}^{t-1}  C_j · i^j
 */
async function generateVSSCommitments(secret, coeffs) {
  const { buildBabyjub } = require("circomlibjs");
  const bj = await buildBabyjub();
  const F = bj.F;

  const allCoeffs = [mod(BigInt(String(secret))), ...coeffs];
  const commitments = await Promise.all(
    allCoeffs.map(async (a) => {
      const P = await bj.mulPointEscalar(bj.Base8, a);
      return { x: F.toString(P[0]), y: F.toString(P[1]) };
    })
  );

  return commitments;
}

/**
 * Verify that share (index, value) is consistent with VSS commitments.
 *
 *   value · Base8 == Σ_{j=0}^{t-1}  commitments[j] · index^j
 */
async function verifyShare(share, vssCommitments) {
  const { buildBabyjub } = require("circomlibjs");
  const bj = await buildBabyjub();
  const F = bj.F;

  const s = mod(BigInt(String(share.value)));
  const lhs = await bj.mulPointEscalar(bj.Base8, s); // s·Base8

  // Σ C_j · idx^j
  let rhs = [F.e(0n), F.e(1n)]; // identity point
  const idx = BigInt(share.index);
  let idxPow = 1n;

  for (const commit of vssCommitments) {
    const Cj = [F.e(BigInt(commit.x)), F.e(BigInt(commit.y))];
    const term = await bj.mulPointEscalar(Cj, mod(idxPow));
    rhs = await bj.addPoint(rhs, term);
    idxPow = mod(idxPow * idx);
  }

  return F.eq(lhs[0], rhs[0]) && F.eq(lhs[1], rhs[1]);
}

// ── Threshold tally protocol ──────────────────────────────────────────────────

/**
 * Partial tally: authority with share i computes its partial nullification.
 *
 * For each ballot commitment cm = (C1, C2):
 *   partial_i = share_i · C1      (partial decryption share)
 *
 * When t partial decryptions are combined with Lagrange interpolation,
 * the result equals  msk · C1 = the full nullification component.
 *
 * This allows threshold tally without any single authority knowing msk.
 */
async function partialNullify(share, cmList) {
  const { buildBabyjub } = require("circomlibjs");
  const bj = await buildBabyjub();
  const F = bj.F;

  const shareVal = mod(BigInt(String(share.value)));
  const partials = [];

  for (const cm of cmList) {
    const C1 = [F.e(BigInt(cm.C1.x)), F.e(BigInt(cm.C1.y))];
    const partial = await bj.mulPointEscalar(C1, shareVal); // share_i · C1
    partials.push({
      x: F.toString(partial[0]),
      y: F.toString(partial[1]),
    });
  }

  return { shareIndex: share.index, partials };
}

/**
 * Combine t partial nullifications using Lagrange interpolation to recover
 * msk · C1 for each ballot, then complete the nullification.
 *
 * @param {Array} partialResults  — t arrays of { shareIndex, partials }
 * @param {Array} cmList         — full ballot commitments
 * @param {object} ckStar        — nullifiable commitment key for OpenNull
 */
async function combineAndNullify(partialResults, cmList, ckStar) {
  const { buildBabyjub } = require("circomlibjs");
  const bj = await buildBabyjub();
  const F = bj.F;

  const shareIndices = partialResults.map((r) => BigInt(r.shareIndex));
  const results = [];

  for (let b = 0; b < cmList.length; b++) {
    const C2 = [F.e(BigInt(cmList[b].C2.x)), F.e(BigInt(cmList[b].C2.y))];

    // Lagrange combination of share_i · C1 to recover msk · C1
    let mskC1 = [F.e(0n), F.e(1n)]; // identity

    for (let i = 0; i < partialResults.length; i++) {
      const xi = shareIndices[i];
      const partial = partialResults[i].partials[b];
      const partialPt = [F.e(BigInt(partial.x)), F.e(BigInt(partial.y))];

      // Lagrange basis L_i(0)
      let num = 1n; let den = 1n;
      for (let j = 0; j < shareIndices.length; j++) {
        if (i === j) continue;
        const xj = shareIndices[j];
        num = mod(num * mod(SUBORDER - xj));
        den = mod(den * mod(xi + SUBORDER - xj));
      }
      const lagrange = mod(num * modPow(den, SUBORDER - 2n, SUBORDER));
      const scaled = await bj.mulPointEscalar(partialPt, lagrange);
      mskC1 = await bj.addPoint(mskC1, scaled);
    }

    // cm* = C2 − mskC1
    const negMskC1 = [F.neg(mskC1[0]), mskC1[1]];
    const cmStar = await bj.addPoint(C2, negMskC1);

    results.push({
      cmStar: { x: F.toString(cmStar[0]), y: F.toString(cmStar[1]) },
    });
  }

  return results;
}

module.exports = {
  splitMsk,
  reconstructMsk,
  generateVSSCommitments,
  verifyShare,
  partialNullify,
  combineAndNullify,
  SUBORDER,
};
