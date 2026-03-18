pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/*
  VoteValidity circuit (Step 2)

  Private inputs:
    - vote: chosen candidate id
    - voterSecret: voter secret (paper's skid)
    - castingKey: casting commitment key identifier (paper's ck)
    - voteSalt: randomness to hide the vote in a commitment

  Public inputs:
    - electionId: unique election identifier
    - candidateList[MAX_CANDIDATES]: allowed candidate ids
    - serialNumber: H(electionId, castingKey, voterSecret)
    - voteCommitment: H(vote, voteSalt)

  Enforced constraints:
    1) vote must match exactly one candidate in candidateList
    2) serialNumber must be correctly derived from private data
    3) voteCommitment must be correctly derived from private vote
*/
template VoteValidity(MAX_CANDIDATES) {
    signal input vote;
    signal input voterSecret;
    signal input castingKey;
    signal input voteSalt;

    signal input electionId;
    signal input candidateList[MAX_CANDIDATES];
    signal input serialNumber;
    signal input voteCommitment;

    // Constraint 1: vote must be in candidateList exactly once.
    component voteEq[MAX_CANDIDATES];
    signal matches[MAX_CANDIDATES];
    signal matchAccumulator[MAX_CANDIDATES + 1];

    matchAccumulator[0] <== 0;

    for (var i = 0; i < MAX_CANDIDATES; i++) {
        voteEq[i] = IsEqual();
        voteEq[i].in[0] <== vote;
        voteEq[i].in[1] <== candidateList[i];
        matches[i] <== voteEq[i].out;
        matchAccumulator[i + 1] <== matchAccumulator[i] + matches[i];
    }

    // Exactly one match => valid vote.
    matchAccumulator[MAX_CANDIDATES] === 1;

    // Constraint 2: paper-aligned serial number for uniqueness checks.
    // sn = H(electionId, castingKey, voterSecret)
    component serialHasher = Poseidon(3);
    serialHasher.inputs[0] <== electionId;
    serialHasher.inputs[1] <== castingKey;
    serialHasher.inputs[2] <== voterSecret;
    serialHasher.out === serialNumber;

    // Constraint 3: hide vote value using commitment.
    component voteCommitHasher = Poseidon(2);
    voteCommitHasher.inputs[0] <== vote;
    voteCommitHasher.inputs[1] <== voteSalt;
    voteCommitHasher.out === voteCommitment;
}

component main {public [electionId, candidateList, serialNumber, voteCommitment]} = VoteValidity(5);

