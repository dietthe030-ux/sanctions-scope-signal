# Sanctions Scope Signal

Sanctions Scope Signal is an organization-only GenLayer PROJECT that binds one screening case to one
official OFAC or UN publication. Validators independently fetch the source and agree on a non-economic
consequence: `HOLD`, `ESCALATE`, `NO_SIGNAL`, or `UNRESOLVED`.

It is not legal advice, KYC/AML clearance, an enforcement decision, or a payment product.

## Why GenLayer

A case owner can supply names and identifiers, but cannot supply the verdict. The Intelligent Contract
locks the source policy and snapshot label, fetches official-source evidence inside a nondeterministic
block, and uses a custom validator that independently re-fetches and re-derives material decision fields.
Only consensus-agreed state becomes authoritative.

## Decision boundary

| Evidence state | Outcome | Consequence |
| --- | --- | --- |
| Strong identifier visibly linked to the same organization record | `CONFIRMED_IDENTIFIER_MATCH` | `HOLD` |
| Name or alias linked without a strong identifier | `PROBABLE_ALIAS_MATCH` | `ESCALATE` |
| Conflicting, wrong-entity, or insufficient context | `AMBIGUOUS` | `ESCALATE` |
| Complete bound UN XML contains no supplied term | `NO_MATCH_IN_BOUND_SNAPSHOT` | `NO_SIGNAL` |
| Source, coverage, model, or evidence failure | `UNRESOLVED` | `UNRESOLVED` |

OFAC absence remains `UNRESOLVED` because the CSV response does not expose a durable completeness proof
to the contract. A later source update requires a new case; old cases are never silently reinterpreted.

## Architecture

- `contracts/sanctions_scope_signal.py` — upgradeable Intelligent Contract and authoritative state machine.
- `tests/direct/` — deterministic lifecycle, evidence, consensus, and upgrade-boundary tests.
- `frontend/` — static accessible frontend using `genlayer-js`.
- `scripts/build.cjs` — production bundle and Studionet-only configuration generator.
- `docs/DEPLOYMENT_RECOVERY.md` — upgrade classification, manifest fields, and recovery limits.

Lifecycle: `DRAFT -> FROZEN -> SIGNALLED | UNRESOLVED -> SUPERSEDED`.

## Frontend transaction safety

Wallet connection always opens an explicit selector for supported EIP-1193 providers. The app never
automatically selects MetaMask or the first injected wallet. Every write waits for `FINALIZED`, requires
`FINISHED_WITH_RETURN`, and verifies authoritative contract readback before advancing the interface.
Creation uses the transaction-specific leader return for the case ID and never guesses from a global
counter.

## Local verification

Prerequisites are Node.js 22+, Python 3.13+, `genlayer-test`, and `genvm-lint`. Install only according to
your environment policy.

```powershell
$env:PYTHONUTF8='1'
genvm-lint lint contracts\sanctions_scope_signal.py --json
py -3.13 -m pytest tests\direct -q --cache-clear
npm test
npm run build
```

The deployment target is Studionet only:

- Chain ID: `61999`
- RPC: `https://studio.genlayer.com/api`
- Explorer: `https://explorer-studio.genlayer.com`

Copy `.env.example` to a local `.env` only after deployment and set the real
`VITE_CONTRACT_ADDRESS`. Never use a placeholder address in production configuration.

## Recovery

The deployment sender is registered as the contract upgrader. Upgrade authority is lost if that Studio
account becomes unavailable; a Studionet reset destroys the old address and state. See
[`docs/DEPLOYMENT_RECOVERY.md`](docs/DEPLOYMENT_RECOVERY.md) for the storage-compatibility plan and
replacement runbook.

## Known limitations

- Public-list screening can produce false positives and false negatives; professional review remains required.
- This prototype accepts public organization identifiers only and must not be used for personal data.
- Public sources can change between validator requests; material disagreement prevents state mutation.
- No ownership/control graph, licensing analysis, jurisdictional nexus, or sanctions-program exception analysis is performed.
- Studionet is a development network and not a production compliance system.
