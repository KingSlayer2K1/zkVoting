# Circuits Folder

## Circuits

### Original: `vote_validity.circom`
Basic prototype circuit — enforces:
1. vote ∈ candidateList
2. serialNumber = Poseidon(electionId, castingKey, voterSecret)
3. voteCommitment = Poseidon(vote, voteSalt)

### Enhanced: `enhanced_vote.circom`  ← **the improved circuit**
Implements the full **Rvote** relation from §4.2 of the paper:

1. `pkid = H(skid)` — voter identity proof (Rid relation) — **was missing**
2. `ckHash = H(h1x, h1y, h2x, h2y)` — EC casting key hash — **was missing**
3. `serialNumber = H(electionId, ckHash, voterSecret)` — updated formula
4. `vote ∈ candidateList` — unchanged
5. `voteCommitment = H(vote, voteSalt)` — unchanged
6. **Merkle membership proof** — proves casting key is in the public set (rt) — **was missing**

Public signals (10 total for 5 candidates):
```
[0]   electionId
[1-5] candidateList
[6]   serialNumber
[7]   voteCommitment
[8]   publicKey      ← NEW (pkid = H(voterSecret))
[9]   merkleRoot     ← NEW (Merkle root of the casting-key set)
```

## Compiling the Enhanced Circuit

Run these commands from the project root (requires `scripts/bin/circom.exe` and `snarkjs`):

```powershell
# Step 1: Compile
.\scripts\bin\circom.exe circuits\enhanced_vote.circom --r1cs --wasm --sym -o circuits\build

# Step 2: Powers of Tau (reuse existing if already generated)
# (skip if circuits/keys/pot14_final.ptau already exists)

# Step 3: Circuit-specific setup
npx snarkjs groth16 setup circuits\build\enhanced_vote.r1cs circuits\keys\pot14_final.ptau circuits\keys\enhanced_vote_0000.zkey
npx snarkjs zkey contribute circuits\keys\enhanced_vote_0000.zkey circuits\keys\enhanced_vote_final.zkey --name="contribution1" -v -e="random entropy"
npx snarkjs zkey export verificationkey circuits\keys\enhanced_vote_final.zkey circuits\keys\enhanced_verification_key.json
```

The backend (`zkService.js`) automatically detects whether the enhanced artifacts
exist and uses them if available, falling back to the legacy circuit.

## Step 3 Artifacts

After running Step 3, the following artifacts are generated:

- `circuits/build/vote_validity.r1cs`
- `circuits/build/vote_validity.sym`
- `circuits/build/vote_validity_js/vote_validity.wasm`
- `circuits/keys/pot14_final.ptau`
- `circuits/keys/vote_validity_final.zkey`
- `circuits/keys/verification_key.json`

## Step 4 Artifacts

After running Step 4 (`npm.cmd run zk:step4`), local proof files are generated in:

- `circuits/build/step4/input.json`
- `circuits/build/step4/proof.json`
- `circuits/build/step4/public.json`
- `circuits/build/step4/api-payload-template.json`
