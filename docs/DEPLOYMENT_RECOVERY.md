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
| Contract address | `0x1d4bc527d5747044A5CC8fCE8EB91e193742b4d6` |
| Deployment transaction | `0x44110079da0ca8b7ae3ce3065565171376f21c7aea09ecc01ec65e0af6263291` |
| Explorer | `https://explorer-studio.genlayer.com/address/0x1d4bc527d5747044A5CC8fCE8EB91e193742b4d6` |
| Exact source commit | `4d65ae51b2375db5d35327f262a7d3e267bc143d` |
| Contract SHA-256 | `b56d3c8cdbdf502137f793c069a0d1dfdab9000ae8f9efc229873f9d5c7c1d90` |
| Studio deployer/upgrader | `0xf5C66e5155a62E27047aD4ccE729593D6B9c03Fc` |

### Superseded historical deployment (Reference)

| Field | Historical value |
| --- | --- |
| Historical contract address | `0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26` |
| Historical deployment transaction | `0x00e83a6e97e5495f185d67612f3555e5f999e24c7da350c423e4627bacbab926` |
| Note | Superseded by the current range-verified deployment after live source-transport remediation. |

No private key, password, token, seed phrase, or Studio credential belongs in this repository.

The current exact-source rehearsal deployment is `0xeeC77C03541D0d405b16aeCB29c5043Ae3090aF6`
(`0xe45613dead88f69b3dff979f195e0e0fbd4db020ce777f9ec248a45db851625b`). After a
storage probe was created, authorized transaction
`0xae36441e8392043d57cb4dd742ab96fb2d2219d13fe36da34442b216ac4909f7` installed a
linted storage-compatible recovery surface. Authoritative readback preserved case count `1`, the exact
case JSON, and sole upgrader `0xf5C6…03Fc`. The primary release deployment was not modified.

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
