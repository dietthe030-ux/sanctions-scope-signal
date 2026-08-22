# Verification

## Revision and deployment

- Contract source commit: `d7e84586350d6b138816028e64434094ff9c9ea0`
- Contract SHA-256, normalized LF: `7ae251722ac26f2dd86fae4c49d805d5a64db0de6c57b264b1059b27c3153343`
- Network: Studionet, chain `61999`
- Contract: `0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA`
- [Explorer](https://explorer-studio.genlayer.com/address/0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA)
- [Deployment transaction](https://explorer-studio.genlayer.com/tx/0x68a9828d9f1a978ec57e7d8088883033f5b6d0065b920359e697227f653ab2ba)
- [Live app](https://sanctions-scope-signal.vercel.app)
- Deployment: `FINALIZED`, successful leader execution, Normal consensus, five agreeing votes.
- Deployed-source parity: RPC `gen_getContractCode`, normalized to LF, returns the exact source hash above.
- Upgrader readback: `0x2e53bb6ED175A7F827590D9D3a353FC51Eb8996a`.
- Features: Automatic immutable official-source digest binding (`frozen_source_digest`) at freeze time, 5-field validator consensus (`outcome`, `consequence`, `source_digest`, `matched_record`, `match_narrative`), and zero manual snapshot-label authority.

The final public commit and live Vercel artifact hashes are recorded in the immutable final release evidence after hosting verification, avoiding a self-referential tracked-file hash. The stable production URL serves the reviewed frontend with the exact Studionet contract configuration.

## Reproducible checks

```powershell
$env:PYTHONUTF8='1'
genvm-lint check contracts\sanctions_scope_signal.py --json
genvm-lint schema contracts\sanctions_scope_signal.py --json
py -3.13 -m pytest tests -q --cache-clear
npm test
$env:VITE_CONTRACT_ADDRESS='0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA'
npm run build
```

Results on the release candidate:

- GenVM AST and SDK semantic validation: pass; 11 public methods.
- GenVM schema extraction: pass; 4 view and 7 write methods.
- Python: 29 passed (27 direct lifecycle/evidence regressions + 2 GenVM preflight).
- Frontend: 16 passed, including duplicate-provider, non-MetaMask Studionet connection, reload-required reconnection, rollback/error/malformed receipt locking, automatic immutable official-source digest binding, and 1-argument `freeze_case` regressions without manual snapshot labels.
- Production build: passed with the exact contract address above.

## Live proof matrix

The primary deployment and all application business writes ran in Normal consensus and were submitted only after the preceding transaction reached `FINALIZED`. The separate platform-level upgrade rehearsal reports `execution_mode: NORMAL` together with the legacy RPC field `leader_only: true` and no validator consensus receipts, so it is recorded only as authorization/source/storage recovery evidence—not as a Full Consensus business call.

### Current release deployment (0x3b562C54bEaeD6A8F58cf6aa63ccda3BB153b8AA)

| Path | Transaction | Verified result |
| --- | --- | --- |
| Deploy corrected contract | `0x68a9828d9f1a978ec57e7d8088883033f5b6d0065b920359e697227f653ab2ba` | `FINALIZED`; source/upgrader parity; automatic immutable digest binding |

### Historical proof matrix (Superseded initial contract: 0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26)

*Note: The following entries represent historical proof matrix transactions on the superseded initial deployment prior to the remediation of automatic immutable digest binding.*

| Path | Transaction | Verified result |
| --- | --- | --- |
| Deploy primary (historical) | `0x00e83a6e97e5495f185d67612f3555e5f999e24c7da350c423e4627bacbab926` | `FINALIZED`; source/upgrader parity |
| Create case (historical) | `0x276b86bde75bbc69b387631324784b93109004602bfb57a12b137b4c6a06868f` | `FINALIZED`; case 1 |
| Add alias (historical) | `0x24260a28b4d474405e859a75f9debab7e574bd685ba9c45a60057fd1330aa728` | `FINALIZED`; authoritative readback |
| Add identifier (historical) | `0xcadc11236a1e99de774ac250d9dcdd6f0c2ea7ef419d633a5027d94c55195dea` | `FINALIZED`; authoritative readback |
| Freeze case (historical) | `0x0dac6773a6f94046f1de44695f925ca3a74c6cd2572cafc19f3409388c9bdfd8` | `FINALIZED`; snapshot bound |
| Assess case (historical) | `0x83d1546e409737ca71e3fa446000e7449a85be3aacce5d921f8730217d633e69` | `FINALIZED`; accepted majority; `UNRESOLVED` fail-closed readback |
| Deploy rehearsal (historical) | `0x447f1e60ee8c3e6bcb2a76253a9f21b46e817169880208f41058cc60f866ed89` | `FINALIZED` |
| Authorized rehearsal upgrade (historical) | `0x9ada0563c7bca4bb7f9f442259e7e871fd7aa89f00cfd136f0cdbba74a666859` | `FINALIZED`; source/upgrader/storage readback preserved |

The live assessment preserved the submitted organization, alias, identifier, source policy, and snapshot. Because the official source could not be fetched or decoded, outcome and consequence were both `UNRESOLVED`; no clearance or positive match was recorded.

## Known limits

- The unauthorized upgrade probe was rejected by Studio before transaction submission, so it has no Explorer transaction.
- The stable live URL, production ownership, and compiled-asset parity were verified at the hosting checkpoint; generated deployment identifiers remain in the immutable final evidence rather than this source commit.
- The product remains a Studionet prototype and not a production compliance determination.
