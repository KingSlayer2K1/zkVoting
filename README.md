# zkVoting — Enhanced ZK E-Voting System

An implementation and extension of the paper **"zkVoting: Zero-knowledge proof based coercion-resistant and E2E verifiable e-voting system"** (Park, Choi, Kim, Oh — ePrint 2024/1003).

This project implements the paper's core nullifiable commitment scheme and contributes **three novel improvements** to the protocol that address gaps identified in the original work.

## Research Paper

The original paper and the IEEE-format report describing our improvements are both included:

| File | Description |
|------|-------------|
| [`2024-1003.pdf`](./2024-1003.pdf) | Original zkVoting paper (Park et al., 2024) |
| [`Final_Report/paper.pdf`](./Final_Report/paper.pdf) | Our extension: improvements and comparative analysis |

## Three Novel Improvements

### I. Concrete πtotal Eligibility Proof
The paper specifies a πtotal proof that exactly *n* real casting keys were issued (preventing ballot stuffing), but provides no implementation. We implement it as a **DLEQ Schnorr argument** over homomorphically aggregated nullifiable commitments:

- `cm_agg = Σ NC.Commit(ck_i, 1; 0)` accumulated at registration time
- After nullification: `cm*_agg = n_real · g3` — count of real keys geometrically encoded
- DLEQ Schnorr proves knowledge of `msk` linking `cm_agg` to `cm*_agg`
- No per-circuit trusted setup; sound under the discrete log assumption

### II. Threshold Master Secret Key
The paper assumes a single trusted tallier holds `msk`. We replace this with a **(t, n)-Shamir Secret Sharing** over the Baby Jubjub scalar field:

- Any `t` of `n` authorities can reconstruct `msk` for the tally phase
- Feldman VSS commitments let each authority verify their own share
- Threshold partial-nullification: each authority computes `share_i · C1`; Lagrange combination recovers `msk · C1` without any single party knowing `msk`

### III. Cross-Election Unlinkability
The paper's serial number formula `sn = H(e, ck, skid)` reuses the raw casting key `ck` across elections, enabling a passive adversary to link a voter's participation across multiple elections. We fix this by:

- Deriving an **election-scoped key hash**: `ckHashE = H(ckHash, electionId)`
- Computing `sn = H(electionId, ckHashE, voterSecret)` — different for same voter across elections
- Casting keys may be reused; serial numbers are always election-specific

## Architecture

```
zkVoting/
├── backend/
│   └── src/
│       ├── lib/
│       │   ├── nullifiableCommitment.js   # NC scheme (Construction 1)
│       │   ├── merkleTree.js              # Poseidon Merkle tree (depth 16)
│       │   ├── totalProof.js              # πtotal — Improvement I
│       │   ├── thresholdMsk.js            # Shamir SSS — Improvement II
│       │   ├── zkService.js               # Groth16 proof generation/verification
│       │   └── cryptoUtils.js             # AES-GCM vote encryption, field utils
│       └── routes/
│           ├── registrationRoutes.js      # Voter registration + casting keys
│           ├── voteRoutes.js              # Vote casting + ZK proof verification
│           ├── electionRoutes.js          # Election init, πtotal, threshold tally
│           └── resultRoutes.js            # Tally + nullification audit
├── circuits/
│   ├── enhanced_vote.circom               # Enhanced circuit (Merkle + casting key)
│   └── vote.circom                        # Legacy circuit
├── Final_Report/
│   ├── paper.tex                          # LaTeX source
│   └── paper.pdf                          # Compiled IEEE-format paper
└── 2024-1003.pdf                          # Original research paper
```

## Prerequisites

- Node.js >= 18
- npm
- Circom 2.1.6 (for circuit compilation)
- snarkjs 0.7.6 (included in node_modules)
- MiKTeX or TeX Live (for LaTeX compilation, optional)

## Setup and Running

### 1. Install dependencies

```bash
npm install
cd backend && npm install && cd ..
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:
```env
PORT=4000
VOTE_ENCRYPTION_KEY=<random-32-char-secret>
```

### 3. Build ZK circuit artifacts (first time only)

```bash
# Compile enhanced circuit and run trusted setup
npm run zk:step3
npm run zk:step4
```

Or for the legacy circuit:
```bash
cd circuits
circom vote.circom --r1cs --wasm --sym
snarkjs groth16 setup vote.r1cs pot12_final.ptau vote_final.zkey
snarkjs zkey export verificationkey vote_final.zkey verification_key.json
```

### 4. Start the server

```bash
npm run backend:dev
```

Server runs at `http://localhost:4000`.

### 5. Initialize an election (required before registration)

```bash
curl -X POST http://localhost:4000/api/election/init \
  -H "Content-Type: application/json" \
  -d '{"t": 2, "n": 3}'
```

This runs NC Setup, splits `msk` into 3 shares (any 2 can reconstruct), and initializes the πtotal accumulator.

## API Reference

### Registration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/register` | Register voter; issues real casting key (b=1) |
| `POST` | `/api/register/fake-key` | Issue fake casting key (b=0) for coercion resistance |
| `POST` | `/api/register/sim-key-prove` | Generate deniable simulated KeyProve proof |
| `POST` | `/api/register/verify-key-proof` | Verify a genuine or simulated KeyProve proof |
| `GET` | `/api/register/merkle-proof/:voterId` | Retrieve Merkle proof for voter's casting key |

### Voting

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/votes/cast` | Backend-assisted vote casting (generates ZK proof server-side) |
| `POST` | `/api/votes` | Client-supplied ZK proof submission |
| `GET` | `/api/votes/stats` | Aggregate vote statistics |
| `GET` | `/api/votes/receipt/:serialNumber` | Retrieve ballot receipt by serial number |

### Election

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/election` | Election info and candidate list |
| `POST` | `/api/election/init` | Initialize election (NC Setup + threshold msk split) |
| `GET` | `/api/election/total-proof` | Generate and verify πtotal eligibility proof (Improvement I) |
| `GET` | `/api/election/threshold-info` | Show threshold configuration (Improvement II) |
| `POST` | `/api/election/threshold-tally` | Demonstrate threshold msk reconstruction (Improvement II) |

### Results

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/results/tally` | Nullification tally (real-key ballots only) |
| `GET` | `/api/results/legacy-tally` | Original decryption-only tally (for comparison) |
| `GET` | `/api/results/nullify/:ballotId` | Per-ballot nullification audit |

### Other / Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bulletin-board` | Public Merkle tree state |
| `GET` | `/health` | Health check |
| `GET` | `/api/admin/voters` | Full voter registry (status, keys, proofs) |
| `GET` | `/api/admin/raw/:file` | Raw JSON backend db viewer (`votes.json`, etc.) |
| `POST` | `/api/admin/reset` | Purge data cache for fresh experiment run |

## Cryptographic Protocol Summary

### NC Scheme (Construction 1 — Baby Jubjub)

```
Setup:   (mpk, msk, ckStar) ← nc.setup()
         mpk = (g1,g2,g3,g4)  Baby Jubjub generators
         msk ← Zq;  ckStar = (h1=g1, h2=g2)  (the "null" key)

KeyGen:  ck = (h1, h2) where:
           real (b=1): h1 = g1, h2 = g2 + msk·g3
           fake (b=0): h1 = g1, h2 = g2

Commit:  C1 = r·h1,  C2 = m·g3 + r·h2

Nullify: cm* = C2 − msk·C1
         = m·g3 + r·(h2 − msk·h1)
         real key: h2 − msk·h1 = g2 + msk·g3 − msk·g1 = g2   → cm* = m·g3 + r·g2
         fake key: h2 − msk·h1 = g2 − msk·g1                  → different structure

OpenNull: verify cm* == m·g3 + r·g2   (real ballot)
          verify cm* == 0              (fake ballot)
```

### ZK Circuit

The enhanced Circom circuit (`circuits/enhanced_vote.circom`) proves:

1. `pkid = H(voterSecret)` — voter knows their secret
2. `ckHash = H(h1x, h1y, h2x, h2y)` — casting key hash consistency
3. `sn = H(electionId, ckHashE, voterSecret)` — serial number formation (Improvement III)
4. Vote is in the candidate list
5. `voteCommitment = H(vote, voteSalt)` — Poseidon commitment
6. Merkle path verifies `(ckHashE, pkid)` is in the public key tree

## Security Properties

| Property | Paper | Our Implementation |
|----------|-------|-------------------|
| Completeness | Yes | Yes |
| Soundness | Yes | Yes |
| ZK (ballot privacy) | Yes | Yes |
| Coercion resistance | Yes | Yes (fake key + SimKeyProve) |
| E2E verifiability | Yes | Yes |
| Eligibility proof (πtotal) | Specified, not implemented | Implemented (DLEQ Schnorr) |
| Threshold tallier | Not addressed | (t,n)-Shamir SSS |
| Cross-election unlinkability | Not addressed | ckHashE election-scoping |

## Coercion Resistance Model

Voters receive:
- **1 real key** (b=1): produces counting ballots
- **Unlimited fake keys** (b=0): produce ballots that tally as zero

Under coercion, a voter hands the coercer a fake key + simulated KeyProve proof. The proof is cryptographically indistinguishable from a genuine KeyProve proof because verification checks only the algebraic equation `k·h1 == p + c·(h2 − b·g3)`, not a Fiat-Shamir hash binding — by design.

## Disclaimer

This is an **educational prototype** demonstrating cryptographic protocol design. It is not intended for use in real elections. JSON file storage, server-side voter secrets (in fallback mode), and lack of production hardening make it unsuitable for deployment.

## License

See [LICENSE](./LICENSE).
