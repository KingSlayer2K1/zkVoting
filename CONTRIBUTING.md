# Contributing to zkVoting

Thanks for your interest in improving this project.

This repository is an educational prototype for zero-knowledge based e-voting, so contributions that improve clarity, reproducibility, and security reasoning are especially welcome.

## Contribution Scope

Good contribution areas:

- bug fixes in backend/frontend flow
- circuit correctness and test improvements
- developer experience (scripts, docs, setup automation)
- security hardening improvements for prototype quality
- performance improvements with clear before/after behavior

Out of scope for quick PRs:

- claiming production election security without formal analysis
- major protocol redesign without documentation of threat model changes

## Local Setup

From repository root:

```powershell
npm.cmd install
cd backend
npm.cmd install
cd ..
Copy-Item .\backend\.env.example .\backend\.env -Force
```

Optional but recommended before feature work:

```powershell
npm.cmd run zk:step3
npm.cmd run zk:step4
```

Run backend:

```powershell
npm.cmd run backend:dev
```

Open app:

- `http://localhost:4000/`

## Coding Guidelines

- keep code readable and beginner-friendly
- prefer existing cryptographic libraries, do not implement crypto primitives from scratch
- preserve circuit/public-signal compatibility when changing proof logic
- add comments only where they improve understanding
- keep APIs explicit and validated

## Security Notes for Contributors

- do not log private voter credentials or decrypted vote payloads
- treat `backend/.env` as sensitive and never commit it
- maintain one-vote enforcement via nullifiers and voter state checks
- when changing tally logic, preserve anonymity at output level

## Pull Request Checklist

Before opening a PR, confirm:

1. project runs locally using README instructions
2. `npm.cmd run zk:step4` succeeds
3. backend starts without errors
4. registration, casting, receipt lookup, and tally endpoints work
5. docs updated if behavior changed

## Suggested PR Format

- Summary: what changed
- Motivation: why it was needed
- Security impact: any change to trust or threat assumptions
- Testing: commands run and results

