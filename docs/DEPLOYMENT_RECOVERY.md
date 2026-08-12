# Deployment and recovery

Sanctions Scope Signal uses one `UPGRADABLE` Intelligent Contract. The contract constructor registers
the deployment sender in GenVM Root Slot `upgraders`; `upgrade(bytes)` replaces code only for an
authorized upgrader.

## Storage compatibility

The storage order is fixed:

1. `cases: TreeMap[u256, str]`
2. `next_case_id: u256`

An upgrade may add methods or change deterministic logic, but must not reorder, remove, or change either
field type. Any incompatible storage change requires a separately reviewed migration and replacement
deployment.

## Draft Studionet manifest

| Field | Intended value |
| --- | --- |
| Network | Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Constructor arguments | none |
| Classification | `UPGRADABLE` |
| Linked contracts | none |
| Configuration transactions | none |
| Contract address | recorded after deployment |
| Deployment transaction | recorded after deployment |
| Explorer | `https://explorer-studio.genlayer.com` plus deployed address |
| Exact source commit and SHA-256 | recorded in the hash-bound deployment evidence |
| Studio deployer/upgrader | selected and recorded in the private checkpoint evidence before deployment; public address added after live verification |

No private key, password, token, seed phrase, or Studio credential belongs in this repository.

## Required live verification

- Deployment reaches `FINALIZED` with successful leader execution.
- Deployment `from_address` and origin provenance match the selected Studio account.
- `get_upgraders()` returns that same address.
- `getContractCode` or current equivalent returns source equal to the reviewed contract hash.
- Create, edit, freeze, assess, readback, ownership failure, and conservative unresolved paths are tested.
- A separate rehearsal deployment accepts a safe compatible upgrade from the selected account and rejects another account.

## Recovery limits and runbook

Upgrade authority is not absolute recovery. If the selected Studio account becomes unavailable, the old
contract may remain readable but its code cannot be upgraded. Deploy a replacement from the recorded
source and constructor manifest, rerun all live tests, then update the frontend and documentation.

If Studio UI data resets while Studionet state and the selected account remain available, reconnect that
account, import the contract by address, load the exact recorded source, and verify code/upgrader state
before any upgrade.

If Studionet state resets, the old address and state cannot be recovered. Redeploy from the recorded
source commit, rerun the proof matrix, and update the frontend address. Never represent an old address as
surviving a network reset.
