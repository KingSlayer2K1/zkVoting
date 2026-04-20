# zkVoting Basepaper — Assumption Analysis Baseline

**Paper:** *zkVoting: Zero-knowledge proof based coercion-resistant and E2E verifiable e-voting system*
**Authors:** Park, Choi, Kim, Oh
**Verified through:** 4 forensic passes across all 18 pages

---

## Sorting Criteria

Each finding is ranked by two factors:

- **Criticality** — What is the theoretical severity if this assumption breaks?
- **Real-World Impact** — How likely is this to actually happen in a real deployment?

**Final rank = Criticality × Real-World Likelihood.** A critical finding that is purely theoretical ranks lower than a high-severity finding that is almost guaranteed to occur in practice.

---

## Tier 1 — Critical & Highly Likely in Practice

### A1. No On-Chain Sybil Prevention (External Identity Delegation)

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🔴 Critical | 🔴 Very High | Page 6 — Register phase |

**Assumption:** An external off-chain identity system verifies voter eligibility before registration. The protocol itself has zero on-chain enforcement.

**What breaks:** One human registers multiple commitments with different secrets → each gets a Merkle leaf → each casts a valid, unique vote. Double-voting prevention only stops the *same commitment* from voting twice, NOT the *same human*.

**Why it matters in practice:** Every real election faces identity fraud. Delegating this entirely to an unnamed external system means the protocol's integrity is only as good as whatever ID layer is bolted on — and the paper provides no interface specification, no binding, no proof-of-personhood integration.

**Paper's stance:** Acknowledged as out-of-scope. Not a blind spot, but a conscious gap.

---

### A2. Private Channel Assumption for Coercion Resistance

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟠 High | 🔴 Very High | Pages 9-10 — CR proof |

**Assumption:** The voter can access a private, unmonitored device/channel to re-vote with their real key after being coerced.

**What breaks:** If the coercer has continuous surveillance (monitoring all devices, network traffic), the voter can never secretly re-vote. Coercion resistance — the paper's headline contribution — becomes purely theoretical.

**Why it matters in practice:** Coercion resistance is most needed in authoritarian regimes. These are exactly the places where surveillance is pervasive. The assumption fails precisely where the feature is needed most.

**Paper's stance:** Implicit assumption. Never explicitly stated or discussed.

---

### A3. Re-Voting Timing Window for Coercion Resistance

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟠 High | 🟠 High | Pages 9-10 — CR mechanism |

**Assumption:** The voter has enough time after coercion to re-vote with the real key before the voting phase closes.

**What breaks:** Coercer forces the voter to use the fake key at T-1 minute before deadline. No time to re-vote. Coercion resistance collapses near phase boundaries.

**Why it matters in practice:** A sophisticated coercer would simply time the coercion to the end of the voting window. This is a trivial attack strategy. The paper has zero analysis of this timing edge case.

**Paper's stance:** Not addressed.

---

### A4. Authority Trusted for Registration Fairness & Liveness

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟠 High | 🟠 High | Page 6 — Register & Tally phases |

**Assumption:** The authority honestly includes all eligible voters' commitments in the Merkle tree, and actually runs the tally at the end.

**What breaks:**
- **Registration censorship:** Authority silently omits a voter's commitment from the Merkle tree → voter's ZK proof fails → they can't vote. No appeal mechanism exists.
- **Liveness failure:** Authority refuses to tally or goes offline → election result never produced.

**Why it matters in practice:** The authority is the single point of control for who gets into the election and whether results are published. In a contested election, this is an obvious attack surface.

**Paper's stance:** Coercion resistance IS proven against adversarial authority. But registration fairness and tally liveness are NOT.

---

## Tier 2 — Critical but Lower Immediate Likelihood

### A5. Groth16 Trusted Setup Ceremony

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🔴 Critical | 🟡 Low-Medium | Page 8, Page 13 |

**Assumption:** At least one participant in the Groth16 trusted setup ceremony honestly destroys their toxic waste (secret randomness).

**What breaks:** If all participants collude or are compromised → attacker can forge arbitrary ZK proofs → create valid-looking votes without being an eligible voter. Completely undetectable.

**Why it matters in practice:** Trusted setup ceremonies are well-studied and can be done securely (Zcash Powers of Tau had 87 participants). Risk is real but manageable with proper ceremony design. However, the paper doesn't discuss ceremony parameters or alternatives (PLONK, etc.).

**Paper's stance:** Groth16 is adopted without discussing the setup trust model.

---

### A6. Threshold Key Holder Collusion

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🔴 Critical | 🟡 Medium | Page 8 — DKG / threshold scheme |

**Assumption:** Fewer than `t` of the threshold key holders collude.

**What breaks:** All `t` holders collude → master secret key (MSK) reconstructed → every individual vote decrypted. Ballot secrecy completely destroyed.

**Why it matters in practice:** Depends entirely on who the key holders are and how they're selected. If they're all government agencies in the same jurisdiction — collusion is plausible. If they're distributed across independent organizations internationally — much less likely.

**Paper's stance:** Mentions threshold sharing but doesn't specify selection criteria, minimum `t` values, or governance for key holders.

---

### A7. DDH/DLP Computational Hardness

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🔴 Critical | 🟢 Low (for now) | Page 4-5 — Definitions, Appendix B |

**Assumption:** The Decisional Diffie-Hellman problem and Discrete Logarithm Problem are computationally hard on BN254/BabyJubjub curves.

**What breaks:** Quantum computer (Shor's algorithm) or mathematical breakthrough → all commitments cracked, all encryptions broken, real/fake keys distinguishable. Total system collapse.

**Why it matters in practice:** No practically relevant quantum computer exists today. BN254 provides ~100-bit security against classical attacks. But election results need to stay secret for decades — if quantum arrives in 10 years, today's encrypted votes are retroactively exposed.

**Paper's stance:** Standard assumption. No post-quantum migration path discussed.

---

### A8. No Forward Secrecy on Nullifier Key

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟠 High | 🟡 Medium | Page 12 — Construction 2, nf = PRF(k, electionID) |

**Assumption:** The voter's nullifier key `k` is never compromised.

**What breaks:** If `k` leaks (device theft, malware, legal compulsion), the attacker can compute `nf = PRF(k, electionID)` for ANY election — past, present, or future. Every election where this voter participated is retroactively deanonymized. Their nullifier is now linkable across all elections.

**Why it matters in practice:** Device compromise is common. Long-term key secrecy for ordinary citizens is unrealistic. A single key breach permanently destroys privacy across the voter's entire voting history.

**Paper's stance:** Not addressed. The nullifier key is treated as a permanent secret with no rotation or forward-secrecy mechanism.

---

## Tier 3 — Medium Severity / Conditional Impact

### A9. Poseidon/MiMC Random Oracle Assumption

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟠 High | 🟡 Low-Medium | Page 8, Page 12 |

**Assumption:** Poseidon and MiMC hash functions behave as random oracles (collision-resistant, preimage-resistant).

**What breaks:** Practical collision or preimage attack on Poseidon/MiMC → forged commitments, duplicate nullifiers, or bypassed eligibility proofs.

**Why it matters in practice:** Poseidon is designed specifically for ZK-friendly arithmetic circuits and has seen significant cryptanalysis, but it's far younger and less battle-tested than SHA-256 or Keccak. MiMC has known algebraic structure that could be exploitable.

**Paper's stance:** Adopted without security analysis of the hash function choice.

---

### A10. Blockchain as Ideal Bulletin Board

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟠 High | 🟡 Low | Page 6 — System model |

**Assumption:** Ethereum (or chosen chain) processes all vote transactions fairly — no censorship, no reorgs, no selective exclusion by validators.

**What breaks:** 51% attack, MEV-style transaction censorship, or compliant validators filtering vote transactions → votes submitted but never included on-chain.

**Why it matters in practice:** Ethereum's validator set is large and decentralized enough that censorship is unlikely for ordinary transactions. But a state-level actor targeting a specific election could potentially bribe/coerce validators. Also: Ethereum can reorg 1-2 blocks under normal conditions — votes in those blocks temporarily vanish.

**Paper's stance:** Blockchain is treated as an ideal append-only public board. No finality analysis.

---

### A11. Cross-Election Linkability (Single-Election Scope)

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟡 Medium | 🟠 High | Pages 7 — Security definitions scoped to one election |

**Assumption:** Security properties are defined and proven within a single election instance. No cross-election unlinkability is provided.

**What breaks:** If the same commitment scheme and nullifier key are reused, an observer can link a voter's participation (not their vote, but their *presence*) across elections. Over many elections, metadata leaks accumulate.

**Why it matters in practice:** Any real deployment would run multiple elections. Without explicit cross-election unlinkability, long-term participation patterns are exposed.

**Paper's stance:** Not addressed. All definitions scoped to one election.

---

### A12. Synchronous Phase Ordering

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟡 Medium | 🟡 Medium | Page 6 — Protocol phases |

**Assumption:** Phases (Setup → Register → Vote → Tally) execute strictly sequentially. All registrations complete before voting opens. All votes land on-chain before tally begins.

**What breaks:**
- Late registration → voter excluded (Merkle root already frozen)
- Network congestion delays a vote transaction → not included before tally → vote lost
- No dispute mechanism for phase boundary issues

**Why it matters in practice:** Blockchain transaction inclusion is not instant. During high-congestion periods, vote transactions could be delayed past the phase boundary. Real elections need grace periods, dispute resolution — none provided.

**Paper's stance:** Phases are presented as cleanly sequential with no overlap handling.

---

### A13. DLP Brute-Force Feasibility at Tally

| Criticality | Real-World Likelihood | Paper Reference |
|---|---|---|
| 🟡 Medium | 🟡 Medium | Pages 8-9 — Tally phase |

**Assumption:** The discrete log brute-force step during tally (to extract the plaintext vote total from `g^(sum)`) completes in reasonable time.

**What breaks:** For simple yes/no elections with n voters, the sum ≤ n. Brute-forcing DLP up to n is trivial even for n = 10M (baby-step-giant-step in O(√n)). BUT for multi-candidate elections with complex vote encoding, the value space grows multiplicatively → brute-force becomes expensive.

**Why it matters in practice:** Most real elections have multiple candidates and possibly ranked-choice or multi-seat formats. The paper benchmarks only up to 256 ballots.

**Paper's stance:** Claims O(n) tally without demonstrating scalability beyond small benchmarks.

---

## Summary Matrix

| Rank | ID | Assumption | Criticality | Real-World Likelihood | Tier | Status |
|---|---|---|---|---|---|---|
| 1 | A1 | No on-chain Sybil prevention | 🔴 Critical | 🔴 Very High | **Tier 1** | ❌ Unaddressed — proposed solution in paper |
| 2 | A2 | Private channel for re-voting | 🟠 High | 🔴 Very High | **Tier 1** | ❌ Unaddressed — non-cryptographic |
| 3 | A3 | Re-voting timing window | 🟠 High | 🟠 High | **Tier 1** | ✅ **Improvement VI** — hidden grace period |
| 4 | A4 | Authority registration fairness & liveness | 🟠 High | 🟠 High | **Tier 1** | ✅ **Improvements I + V** — πtotal + commit-reveal audit |
| 5 | A5 | Groth16 trusted setup | 🔴 Critical | 🟡 Low-Med | **Tier 2** | ❌ Unaddressed — future work (PLONK/Halo2) |
| 6 | A6 | Threshold key holder collusion | 🔴 Critical | 🟡 Medium | **Tier 2** | ✅ **Improvement II** — (t,n)-Shamir SSS |
| 7 | A7 | DDH/DLP hardness (quantum) | 🔴 Critical | 🟢 Low | **Tier 2** | ❌ Unaddressed — post-quantum ZK research |
| 8 | A8 | No forward secrecy on nullifier key | 🟠 High | 🟡 Medium | **Tier 2** | ✅ **Improvement IV** — ephemeral epochSecret |
| 9 | A9 | Poseidon/MiMC random oracle | 🟠 High | 🟡 Low-Med | **Tier 3** | ❌ Unaddressed — cryptanalysis scope |
| 10 | A10 | Blockchain = ideal bulletin board | 🟠 High | 🟡 Low | **Tier 3** | ❌ Unaddressed — engineering scope |
| 11 | A11 | Cross-election linkability | 🟡 Medium | 🟠 High | **Tier 3** | ✅ **Improvement III** — election-scoped ckHashE |
| 12 | A12 | Synchronous phase ordering | 🟡 Medium | 🟡 Medium | **Tier 3** | ⚠️ Partially — Improvement VI covers voting phase |
| 13 | A13 | DLP brute-force at tally scale | 🟡 Medium | 🟡 Medium | **Tier 3** | ❌ Unaddressed — benchmarking scope |

**Coverage: 5 of 13 assumptions fully addressed, 1 partially addressed, 7 documented with proposed solutions in the paper.**

