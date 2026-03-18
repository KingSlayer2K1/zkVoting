# Circuits Folder

This directory will contain:

- `vote_validity.circom` (added in Step 2)
- compiled artifacts in `circuits/build/`
- proving/verification keys in `circuits/keys/`

## Current Circuit

`vote_validity.circom` currently enforces:

1. vote is one valid candidate from a public candidate list
2. serial number is derived as `Poseidon(electionId, castingKey, voterSecret)`
3. vote commitment is derived as `Poseidon(vote, voteSalt)`

This keeps the prototype aligned with the paper's serial-number based
double-vote prevention while remaining beginner-friendly.

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
