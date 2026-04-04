pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/switcher.circom";

/*
  EnhancedVoteValidity — the Rvote relation from Section 4.2 of the paper.

  Compared to the original vote_validity.circom this circuit adds:

  ① Voter public-key proof
        pkid = H(skid)
      The voter proves they know the secret key behind their registered public
      key WITHOUT revealing skid to the verifier.  This is the Rid relation.

  ② Casting-key hash (ckHash)
        ckHash = H(h1x, h1y, h2x, h2y)
      The casting key is now an EC-based nullifiable commitment key (from
      Construction 1).  Its hash is incorporated into both the serial number
      and the Merkle leaf.

  ③ Updated serial number
        sn = H(electionId, ckHash, voterSecret)
      Same formula as before but ckHash now represents the full EC key rather
      than a single random scalar.

  ④ Merkle membership proof (eligibility verifiability)
        leaf  = H(ckHash, pkid)
        path check verifies leaf ∈ tree with root merkleRoot
      This proves the voter's casting key is in the authority-published set,
      satisfying the M.Verify(rt, (ck, pkid)) = 1 check from Rvote.

  ⑤ Vote commitment (unchanged)
        cm = H(vote, voteSalt)

  ─── Private inputs ───────────────────────────────────────────────────────────
    vote        — candidate id chosen by the voter
    voterSecret — skid (voter's private key)
    ckH1x       — x-coordinate of h1 in ck = ((g1,h1),(g2,h2))
    ckH1y       — y-coordinate of h1
    ckH2x       — x-coordinate of h2
    ckH2y       — y-coordinate of h2
    voteSalt    — randomness to hide vote in commitment
    merklePathElements[MERKLE_DEPTH] — sibling hashes on the Merkle path
    merklePathIndices[MERKLE_DEPTH]  — 0 = left child, 1 = right child

  ─── Public inputs ────────────────────────────────────────────────────────────
    electionId        — unique election identifier
    candidateList[N]  — allowed candidate ids
    serialNumber      — H(electionId, ckHash, voterSecret)
    voteCommitment    — H(vote, voteSalt)
    publicKey         — pkid = H(voterSecret)
    merkleRoot        — rt = Merkle root of the registered casting-key set
*/

template EnhancedVoteValidity(MAX_CANDIDATES, MERKLE_DEPTH) {

    // ── Private inputs ──────────────────────────────────────────────────────
    signal input vote;
    signal input voterSecret;
    signal input ckH1x;
    signal input ckH1y;
    signal input ckH2x;
    signal input ckH2y;
    signal input voteSalt;
    signal input merklePathElements[MERKLE_DEPTH];
    signal input merklePathIndices[MERKLE_DEPTH];

    // ── Public inputs ───────────────────────────────────────────────────────
    signal input electionId;
    signal input candidateList[MAX_CANDIDATES];
    signal input serialNumber;
    signal input voteCommitment;
    signal input publicKey;
    signal input merkleRoot;

    // ═══════════════════════════════════════════════════════════════════════
    // Constraint ①: pkid = H(voterSecret)   (Rid relation)
    // ═══════════════════════════════════════════════════════════════════════
    component pkHasher = Poseidon(1);
    pkHasher.inputs[0] <== voterSecret;
    pkHasher.out === publicKey;

    // ═══════════════════════════════════════════════════════════════════════
    // Constraint ②+③: ckHash = H(h1x, h1y, h2x, h2y)
    //                 sn     = H(electionId, ckHash, voterSecret)
    // ═══════════════════════════════════════════════════════════════════════
    component ckHasher = Poseidon(4);
    ckHasher.inputs[0] <== ckH1x;
    ckHasher.inputs[1] <== ckH1y;
    ckHasher.inputs[2] <== ckH2x;
    ckHasher.inputs[3] <== ckH2y;

    component snHasher = Poseidon(3);
    snHasher.inputs[0] <== electionId;
    snHasher.inputs[1] <== ckHasher.out;
    snHasher.inputs[2] <== voterSecret;
    snHasher.out === serialNumber;

    // ═══════════════════════════════════════════════════════════════════════
    // Constraint ④: vote ∈ candidateList  (exactly once)
    // ═══════════════════════════════════════════════════════════════════════
    component voteEq[MAX_CANDIDATES];
    signal matches[MAX_CANDIDATES];
    signal matchAcc[MAX_CANDIDATES + 1];
    matchAcc[0] <== 0;

    for (var i = 0; i < MAX_CANDIDATES; i++) {
        voteEq[i] = IsEqual();
        voteEq[i].in[0] <== vote;
        voteEq[i].in[1] <== candidateList[i];
        matches[i] <== voteEq[i].out;
        matchAcc[i + 1] <== matchAcc[i] + matches[i];
    }
    matchAcc[MAX_CANDIDATES] === 1;

    // ═══════════════════════════════════════════════════════════════════════
    // Constraint ⑤: voteCommitment = H(vote, voteSalt)
    // ═══════════════════════════════════════════════════════════════════════
    component cmHasher = Poseidon(2);
    cmHasher.inputs[0] <== vote;
    cmHasher.inputs[1] <== voteSalt;
    cmHasher.out === voteCommitment;

    // ═══════════════════════════════════════════════════════════════════════
    // Constraint ⑥: Merkle membership proof
    //   leaf = H(ckHash, pkid)
    //   Walk the path and verify that the computed root equals merkleRoot.
    // ═══════════════════════════════════════════════════════════════════════
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== ckHasher.out;   // ckHash
    leafHasher.inputs[1] <== publicKey;       // pkid

    // Walk the Merkle path.  At each level, use a Switcher to place the
    // current hash on the left or right depending on pathIndices[i].
    component levelHashers[MERKLE_DEPTH];
    component switchers[MERKLE_DEPTH];
    signal levelHash[MERKLE_DEPTH + 1];
    levelHash[0] <== leafHasher.out;

    for (var i = 0; i < MERKLE_DEPTH; i++) {
        switchers[i] = Switcher();
        // sel=0 → (outL, outR) = (in[0], in[1]) i.e. current is left
        // sel=1 → (outL, outR) = (in[1], in[0]) i.e. current is right
        switchers[i].sel <== merklePathIndices[i];
        switchers[i].L   <== levelHash[i];
        switchers[i].R   <== merklePathElements[i];

        levelHashers[i] = Poseidon(2);
        levelHashers[i].inputs[0] <== switchers[i].outL;
        levelHashers[i].inputs[1] <== switchers[i].outR;
        levelHash[i + 1] <== levelHashers[i].out;
    }

    levelHash[MERKLE_DEPTH] === merkleRoot;
}

/*
  Instantiation: 5 candidates, Merkle depth 16 (up to 65 536 voters).

  Public signal order (matches zkService.computePublicSignals):
    [0]            electionId
    [1..5]         candidateList[0..4]
    [6]            serialNumber
    [7]            voteCommitment
    [8]            publicKey
    [9]            merkleRoot
*/
component main {
    public [
        electionId,
        candidateList,
        serialNumber,
        voteCommitment,
        publicKey,
        merkleRoot
    ]
} = EnhancedVoteValidity(5, 16);
