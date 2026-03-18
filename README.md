# zkVoting

Zero-Knowledge Proof Based Secure E-Voting System (term project prototype).

## What This Project Does

This project demonstrates a working end-to-end voting prototype using:

- **Circom + snarkjs** for zero-knowledge proofs
- **Node.js + Express** for backend APIs
- **HTML/CSS/JS** for a simple frontend
- **JSON storage** for local data

It supports:

- voter registration
- one-person-one-vote enforcement (serial/nullifier based)
- zk proof generation and verification
- storage of vote commitments and encrypted vote payloads (not plain votes)
- anonymous tally output (candidate totals without voter identity)

## Research Basis

This implementation is based on the research paper included in this repository:

- **`2024-1003.pdf`**
- Title: **"zkVoting: Zero-knowledge proof based coercion-resistant and E2E verifiable e-voting system"**
- Authors: **Seongho Park, Jaekyoung Choi, Jihye Kim, Hyunok Oh**

The prototype follows the paper's key direction, especially serial-number based anti-double-voting and zk-based vote validity flow.

## Who Can Use This Project

Best suited for:

- students learning ZK + secure voting architecture
- instructors for demos/labs
- researchers building a baseline prototype
- hackathon teams exploring verifiable voting

Not intended for:

- real public elections
- high-stakes governance voting
- production deployment without major hardening

## Important Disclaimer

This is an **educational prototype**, not a production election system.

It demonstrates cryptographic workflow and system design, but does not yet provide the operational, legal, and adversarial guarantees required for real-world elections.

## Current Implementation Status

- Step 1: setup and project scaffolding
- Step 2: Circom vote-validity circuit
- Step 3: circuit compile + trusted setup
- Step 4: local proof generation + verification
- Step 5: backend API
- Step 6: backend proof verification integration
- Step 7: frontend voting UI
- Step 8: frontend-backend integration
- Step 9: nullifier-based duplicate vote prevention
- Step 10: tally endpoint (anonymous candidate counts)

## How To Run (Windows / PowerShell)

From project root:

```powershell
cd "c:\Users\HP\Desktop\IITP Study Material\2ndSem\Crypto\zkVoting"
```

### 1. Install dependencies

```powershell
npm.cmd install
cd backend
npm.cmd install
cd ..
```

### 2. Create backend environment file

```powershell
Copy-Item .\backend\.env.example .\backend\.env -Force
```

Edit `backend/.env` and set:

```env
PORT=4000
VOTE_ENCRYPTION_KEY=replace-with-a-long-random-secret
```

### 3. Build ZK artifacts (recommended first run)

```powershell
npm.cmd run zk:step3
npm.cmd run zk:step4
```

### 4. Start server

```powershell
npm.cmd run backend:dev
```

### 5. Open app

Open in browser:

- `http://localhost:4000/`

## Main API Endpoints

- `GET /health`
- `GET /api/election`
- `POST /api/register`
- `POST /api/votes/cast`
- `POST /api/votes` (advanced/manual proof submission)
- `GET /api/votes/stats`
- `GET /api/votes/receipt/:serialNumber`
- `GET /api/results/tally`

## What "Anonymous" Means Here

In this prototype:

- tally output does not include voter identity
- ballot record stores commitment/proof and encrypted vote payload

But for strong real-world anonymity/coercion resistance, additional controls are still needed (see roadmap below).

## Scope for Improvement (Roadmap)

### Cryptography and protocol

- move proof generation fully to client device
- remove server visibility of raw vote input path
- strengthen coercion-resistance model (fake credential flow end-to-end)
- independent bulletin board and audit logs
- stronger distributed trust assumptions (multi-authority setup)

### Security and operations

- replace JSON files with audited database layer
- key management via HSM/KMS
- secure secret rotation and backup
- robust authentication, authorization, rate limiting, abuse controls
- extensive security testing and threat-model validation

### Product readiness

- reproducible Docker deployment
- observability and health dashboards
- CI pipeline with tests (unit, integration, cryptographic checks)
- full documentation for election lifecycle and recovery procedures

## Project Structure

```text
zkVoting/
|-- circuits/
|-- backend/
|-- frontend/
|-- scripts/
|-- 2024-1003.pdf
`-- README.md
```

## Quick Tool Check

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\powershell\check-tools.ps1
```

## Additional Documentation

- [License](./LICENSE)
- [Contributing Guide](./CONTRIBUTING.md)
- [Project Report](./PROJECT_REPORT.md)
