# Sanctions Scope Signal

An organization-only GenLayer PROJECT that binds a sanctions-screening case to one official publication and records the consensus consequence on Studionet.

## Verified links

- [Studionet contract](https://explorer-studio.genlayer.com/address/0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA)
- [Deployment transaction](https://explorer-studio.genlayer.com/tx/0x68a9828d9f1a978ec57e7d8088883033f5b6d0065b920359e697227f653ab2ba)
- [Live app](https://sanctions-scope-signal.vercel.app)

## Trust problem

A case owner can provide an organization's name and identifiers, but must not be able to supply or silently manipulate the verdict. Public lists can also be unavailable, incomplete, or change while validators are evaluating them. This project therefore treats the submitted subject, the selected official-source policy, the frozen publication digest, and the fetched evidence as separate trust boundaries.

It is not legal advice, KYC/AML clearance, an enforcement decision, or a payment product.

## Why GenLayer is essential

The Intelligent Contract freezes the case inputs, fetches the official OFAC or UN source inside a nondeterministic block, and asks validators to independently re-fetch and re-derive the material decision fields. Only consensus-agreed state becomes authoritative. Evidence failure is recorded as `UNRESOLVED`, never converted into clearance.

| Evidence state | Outcome | On-chain consequence |
| --- | --- | --- |
| Strong identifier linked to the same organization record | `CONFIRMED_IDENTIFIER_MATCH` | `HOLD` |
| Name or alias linked without a strong identifier | `PROBABLE_ALIAS_MATCH` | `ESCALATE` |
| Conflicting, wrong-entity, or insufficient context | `AMBIGUOUS` | `ESCALATE` |
| Complete bound UN XML contains no supplied term | `NO_MATCH_IN_BOUND_SNAPSHOT` | `NO_SIGNAL` |
| Source, coverage, model, or evidence failure | `UNRESOLVED` | `UNRESOLVED` |

OFAC absence remains `UNRESOLVED`: its CSV response does not expose a durable completeness proof to the contract.

## How it works

1. Connect through the explicit supported-provider chooser; the app never auto-selects MetaMask.
2. Create a case with the organization's legal name and source policy.
3. Add public aliases and identifiers, then freeze the case to bind the immutable official publication digest.
4. Request assessment. Validators fetch and evaluate the official source under Normal consensus, checking the current digest against the frozen digest.
5. Wait for `FINALIZED`, require successful leader execution, and verify the authoritative case readback.
6. If the official publication changes, create a newer assessed case and supersede the earlier record without rewriting history.

## Architecture

- `contracts/sanctions_scope_signal.py` is the authoritative state machine, evidence fetcher, validator, and upgrade surface.
- `frontend/` is a static browser client using `genlayer-js`; it signs writes through the selected EIP-1193 provider and reads Studionet directly.
- `scripts/build.cjs` bundles the frontend and injects the Studionet configuration at build time.
- `tests/` contains deterministic lifecycle regressions and official GenVM semantic/schema preflight checks.
- `docs/` contains reviewer-facing deployment, recovery, and verification material.

There is no application backend or private database. Contract state is the source of truth; browser local storage holds only pending-write reconciliation data.

## Intelligent Contract

The case owner may call `create_case`, `add_alias`, `add_identifier`, `freeze_case`, `assess_case`, and `supersede_case`. Public views expose cases, count, source URLs, and upgraders. Lifecycle:

`DRAFT -> FROZEN -> SIGNALLED | UNRESOLVED -> SUPERSEDED`

The validator compares the leader's outcome, consequence, source_digest, matched_record, and match_narrative against an independent derivation. Supersession requires a newer, assessed, current case owned by the same account. The contract has no token, payment, stake, reward, or economic value path.

## Transaction lifecycle

Before submission, the frontend persists the contract, account, function, and exact serialized arguments. It then stores the returned transaction hash, waits for `FINALIZED`, requires `FINISHED_WITH_RETURN`, and performs function-specific readback. A timeout, reload, delayed readback, or provider lifecycle event keeps the original intent locked and never automatically replays it. Only an explicit EIP-1193 rejection code `4001` clears a pre-submission intent.

## Run locally

Prerequisites: Node.js 22+, Python 3.13+, the pinned package dependencies, `genvm-lint`, and its configured GenVM SDK artifact. Install only under your environment policy.

```powershell
$env:VITE_CONTRACT_ADDRESS='0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA'
npm run build
python -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The target is Studionet only: chain `61999`, RPC `https://studio.genlayer.com/api`.

## Tests and verification

```powershell
$env:PYTHONUTF8='1'
genvm-lint check contracts\sanctions_scope_signal.py --json
genvm-lint schema contracts\sanctions_scope_signal.py --json
py -3.13 -m pytest tests -q --cache-clear
npm test
$env:VITE_CONTRACT_ADDRESS='0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA'
npm run build
```

Current release evidence: GenVM semantic/schema checks pass for the unchanged deployed contract; Python `29/29`; frontend `16/16`; production build passes. The frontend regressions cover EIP-6963/legacy deduplication, provider-native Studionet switch/add/readback without MetaMask Snap APIs, disconnected startup on every reload until the user opens the selector, fail-closed receipt-envelope reconciliation, automatic official publication digest binding, and zero manual snapshot-label authority. See [verification](docs/VERIFICATION.md).

## Deployment

- Network: Studionet, chain `61999`
- Contract: `0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA`
- Deployment transaction: `0x68a9828d9f1a978ec57e7d8088883033f5b6d0065b920359e697227f653ab2ba`
- Contract source commit: `d7e84586350d6b138816028e64434094ff9c9ea0`
- Contract SHA-256, normalized LF: `7ae251722ac26f2dd86fae4c49d805d5a64db0de6c57b264b1059b27c3153343`

RPC readback matches that source hash. The selected deployer remains the sole recorded upgrader; a separate rehearsal deployment completed an authorized same-source upgrade. See [deployment and recovery](docs/DEPLOYMENT_RECOVERY.md).

## Security and trust boundaries

- Accept only public organization data; do not submit personal or confidential information.
- The case owner controls inputs, not the validator-derived result.
- A source or consensus failure produces `UNRESOLVED`, not `NO_SIGNAL`.
- Wallet account, chain, or disconnect events invalidate the write client.
- No secret, private key, wallet export, or credential belongs in this repository.
- Upgrade authority depends on the recorded Studio account; Studionet reset destroys the old address and state.

## Known limitations

- Public-list screening can produce false positives and false negatives; professional review remains required.
- No ownership/control graph, licensing analysis, jurisdictional nexus, or sanctions-program exception analysis is performed.
- Public sources can change between validator requests; material disagreement prevents a decisive state mutation.
- Studionet is a development network, not a production compliance system.
