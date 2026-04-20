# Graph Report - C:\Users\Durjoy Majumdar\Desktop\zkVoting  (2026-04-21)

## Corpus Check
- 19 files · ~38,578 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 127 nodes · 261 edges · 15 communities detected
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]

## God Nodes (most connected - your core abstractions)
1. `getBJ()` - 12 edges
2. `mulPoint()` - 12 edges
3. `objToPoint()` - 10 edges
4. `addPoints()` - 10 edges
5. `pointToObj()` - 8 edges
6. `setup()` - 8 edges
7. `simKeyProve()` - 8 edges
8. `generateTotalProof()` - 8 edges
9. `apiRequest()` - 8 edges
10. `keyGen()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `computeKeyContribution()` --calls--> `commit()`  [INFERRED]
  C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\totalProof.js → C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\nullifiableCommitment.js
- `generateTotalProof()` --calls--> `randomScalar()`  [INFERRED]
  C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\totalProof.js → C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\thresholdMsk.js
- `loadOrInitNcSetup()` --calls--> `setup()`  [INFERRED]
  C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\routes\registrationRoutes.js → C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\nullifiableCommitment.js
- `generateTotalProof()` --calls--> `nullify()`  [INFERRED]
  C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\totalProof.js → C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\nullifiableCommitment.js
- `verifyTotalProof()` --calls--> `openNull()`  [INFERRED]
  C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\totalProof.js → C:\Users\Durjoy Majumdar\Desktop\zkVoting\backend\src\lib\nullifiableCommitment.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.33
Nodes (22): addPoints(), commit(), getBJ(), getPoseidon(), hashCastingKey(), identityPoint(), keyGen(), keyProve() (+14 more)

### Community 1 - "Community 1"
Cohesion: 0.29
Nodes (15): apiRequest(), attachHandlers(), checkBackend(), handleRegister(), handleVote(), init(), loadElection(), loadTally() (+7 more)

### Community 2 - "Community 2"
Cohesion: 0.22
Nodes (13): isCandidateAllowed(), computePublicSignals(), computeSerialNumber(), computeVoteCommitment(), detectCircuit(), generateProof(), getPoseidon(), loadVerificationKey() (+5 more)

### Community 3 - "Community 3"
Cohesion: 0.32
Nodes (13): appendEntry(), buildTree(), computeLeaf(), emptyLeaf(), getBulletinBoard(), getMerkleProof(), getPoseidon(), getProofForEntry() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.19
Nodes (8): main(), readJson(), loadElectionWithNc(), computeSerialNumber(), getPoseidon(), loadContext(), normalizeNullifiers(), poseidonHash()

### Community 5 - "Community 5"
Cohesion: 0.19
Nodes (10): decryptVotePayload(), encryptVotePayload(), getVoteEncryptionKey(), ensureDataFile(), readJson(), writeJson(), getPoseidon(), loadOrInitNcSetup() (+2 more)

### Community 6 - "Community 6"
Cohesion: 0.42
Nodes (11): addPoints(), aggregateCommitments(), computeKeyContribution(), generateTotalProof(), getBJ(), getPoseidon(), identityPoint(), objToPoint() (+3 more)

### Community 7 - "Community 7"
Cohesion: 0.38
Nodes (9): combineAndNullify(), generateVSSCommitments(), mod(), modPow(), partialNullify(), randomScalar(), reconstructMsk(), splitMsk() (+1 more)

### Community 8 - "Community 8"
Cohesion: 1.0
Nodes (2): main(), randomFieldElement()

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (0): 

### Community 10 - "Community 10"
Cohesion: 1.0
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (0): 

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 9`** (1 nodes): `app.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (1 nodes): `server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (1 nodes): `electionRoutes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (1 nodes): `check-tools.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (1 nodes): `step3-compile-and-setup.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (1 nodes): `step4-proof-and-verify.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadOrInitNcSetup()` connect `Community 5` to `Community 0`, `Community 4`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Why does `setup()` connect `Community 0` to `Community 5`?**
  _High betweenness centrality (0.241) - this node is a cross-community bridge._