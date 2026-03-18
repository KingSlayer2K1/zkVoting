# PROJECT REPORT

## Title

Zero-Knowledge Proof Based Secure E-Voting System (zkVoting)

## Author Context

This project was developed as a term-project prototype to demonstrate practical integration of zero-knowledge proofs into an e-voting workflow.

## Reference Research Paper

- File: `2024-1003.pdf`
- Title: "zkVoting: Zero-knowledge proof based coercion-resistant and E2E verifiable e-voting system"
- Authors: Seongho Park, Jaekyoung Choi, Jihye Kim, Hyunok Oh

## Problem Statement

Traditional e-voting systems face trust and privacy challenges:

- voters should not reveal vote choices
- only eligible/valid votes should be counted
- double voting must be prevented
- process should be auditable end-to-end

The goal was to implement a working local prototype that demonstrates these properties using modern ZK tooling.

## Objectives

1. Build a functional voting application with proof-backed vote validity.
2. Enforce one-person-one-vote using serial/nullifier checks.
3. Store commitments/encrypted payloads instead of plain ballots.
4. Provide verifiable proof flow and anonymous tally output.
5. Keep architecture simple and beginner-friendly.

## Technology Stack

- ZK circuit and proving: Circom, snarkjs (Groth16)
- Backend: Node.js, Express
- Frontend: HTML, CSS, vanilla JavaScript
- Storage: JSON files (prototype-level)
- Symmetric encryption for sealed ballot payloads: AES-GCM via Node.js crypto

## System Design Overview

### Registration phase

- Voter registers via `POST /api/register`.
- System issues:
  - `voterSecret` (analogous to `skid`)
  - `castingKey` (analogous to `ck`)
- Stored for prototype use and proof generation.

### Voting phase

- Frontend submits `voterId` and selected candidate.
- Backend computes:
  - serial number `sn = H(electionId, castingKey, voterSecret)`
  - vote commitment `cm = H(vote, voteSalt)`
- Backend generates ZK proof and verifies it before acceptance.
- Accepted ballot stores:
  - serial number
  - commitment
  - proof/public signals
  - encrypted vote payload (AES-GCM)
- Nullifier set updated with serial number.

### Verification phase

- Receipt endpoint allows lookup by serial number:
  - `GET /api/votes/receipt/:serialNumber`

### Tally phase

- Tally endpoint decrypts sealed payloads.
- Recomputes commitment to detect tampered records.
- Counts valid ballots by candidate without exposing voter identity:
  - `GET /api/results/tally`

## Circuit Summary

Circuit file: `circuits/vote_validity.circom`

The circuit enforces:

1. vote belongs to the public candidate list exactly once
2. serial number matches `Poseidon(electionId, castingKey, voterSecret)`
3. commitment matches `Poseidon(vote, voteSalt)`

Public signals include election id, candidate list, serial number, and vote commitment.

## Implementation Milestones

1. setup and dependency installation
2. circuit authoring
3. compile and trusted setup
4. local proof generation and verification
5. backend API foundation
6. backend proof verification integration
7. frontend voting UI
8. frontend-backend integration
9. nullifier and duplicate-vote enforcement
10. tally logic

## Validation Performed

- successful local proof generation and verification (`snarkjs` reports OK)
- backend API smoke tests for:
  - election info
  - registration
  - vote cast
  - duplicate vote rejection
  - receipt lookup
  - tally generation
- syntax checks for backend and frontend JS

## What Security Properties Are Demonstrated

Demonstrated at prototype level:

- vote validity via ZK constraints
- one-vote enforcement with serial/nullifier checks
- no plain vote storage in the ballot record
- anonymous aggregate result output

## Limitations

This implementation is not production-ready for public elections.

Main limitations:

- backend currently participates in proof generation flow
- single-server trust model
- JSON storage (no robust DB/audit layer)
- no formal coercion-resistance protocol implementation end-to-end
- no formal security proof for the implemented system composition

## Future Work

1. move proof generation fully to client-side
2. strengthen coercion-resistance mechanisms from paper-level concepts
3. separate trust roles (registrar/tallier/bulletin board)
4. add database, auth, auditing, and secure key management
5. add automated tests for protocol invariants and failure cases
6. provide containerized deployment and CI validation pipeline

## Conclusion

The project successfully delivers a complete educational prototype showing how ZK proofs can be integrated into an e-voting workflow. It demonstrates practical use of Circom and snarkjs in a full-stack system and provides a strong base for further research-oriented or production-hardening work.

## References

1. Park, S., Choi, J., Kim, J., Oh, H., "zkVoting: Zero-knowledge proof based coercion-resistant and E2E verifiable e-voting system" (`2024-1003.pdf` in repository).
2. Circom documentation: https://docs.circom.io/
3. snarkjs repository: https://github.com/iden3/snarkjs
4. Zcash zk-SNARK technology overview: https://z.cash/technology/zksnarks/

