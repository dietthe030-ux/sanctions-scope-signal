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

## Studionet deployment manifest

| Field | Intended value |
| --- | --- |
| Network | Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Constructor arguments | none |
| Classification | `UPGRADABLE` |
| Linked contracts | none |
| Configuration transactions | none |
| Contract address | `0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26` |
| Deployment transaction | `0x00e83a6e97e5495f185d67612f3555e5f999e24c7da350c423e4627bacbab926` |
| Explorer | `https://explorer-studio.genlayer.com/address/0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26` |
| Exact source commit | `d7e84586350d6b138816028e64434094ff9c9ea0` |
| Contract SHA-256, normalized LF | `f33a0edb4ba6b4b1f8e3265bad12fa5bb269bfe87d287d72f44647c89a2989da` |
| Studio deployer/upgrader | `0x2e53bb6ED175A7F827590D9D3a353FC51Eb8996a` |

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

## Frontend transaction recovery

Before submission, the frontend persists the account, contract, function, exact arguments, and intent.
Once returned, the transaction hash is added to the same local record. A timeout, reload, provider event,
or delayed readback leaves that record locked: the frontend reconciles the original hash and never emits a
replacement transaction automatically. It clears the record only after `FINALIZED`,
`FINISHED_WITH_RETURN`, and function-specific authoritative readback all succeed. A wallet rejection with
EIP-1193 code `4001` is the only automatically recognized pre-submission failure.

If a provider reports `accountsChanged`, `chainChanged`, or `disconnect`, the write client is discarded.
Reconnect the original account through the explicit provider selector to reconcile its stored transaction.
If the stored intent has no hash because the provider outcome was ambiguous, do not retry: inspect wallet
activity/RPC state and reconcile manually before clearing local browser storage.
