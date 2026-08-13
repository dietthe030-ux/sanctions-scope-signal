# Verification

## Revision and deployment

- Contract source commit: `d7e84586350d6b138816028e64434094ff9c9ea0`
- Contract SHA-256, normalized LF: `f33a0edb4ba6b4b1f8e3265bad12fa5bb269bfe87d287d72f44647c89a2989da`
- Network: Studionet, chain `61999`
- Contract: `0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26`
- [Explorer](https://explorer-studio.genlayer.com/address/0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26)
- [Deployment transaction](https://explorer-studio.genlayer.com/tx/0x00e83a6e97e5495f185d67612f3555e5f999e24c7da350c423e4627bacbab926)
- Deployment: `FINALIZED`, successful leader execution, Normal consensus, five agreeing votes.
- Deployed-source parity: RPC `gen_getContractCode`, normalized to LF, returns 16,625 characters with the exact source hash above.
- Upgrader readback: `0x2e53bb6ED175A7F827590D9D3a353FC51Eb8996a`.

The final public commit and live Vercel artifact hashes are recorded in the immutable final release evidence after hosting verification, avoiding a self-referential tracked-file hash.

## Reproducible checks

```powershell
$env:PYTHONUTF8='1'
genvm-lint check contracts\sanctions_scope_signal.py --json
genvm-lint schema contracts\sanctions_scope_signal.py --json
py -3.13 -m pytest tests -q --cache-clear
npm test
$env:VITE_CONTRACT_ADDRESS='0xb83aEC2EB2FE781d383089e3fB9B3F09d2625e26'
npm run build
```

Results on the release candidate:

- GenVM AST and SDK semantic validation: pass; 11 public methods.
- GenVM schema extraction: pass; 4 view and 7 write methods.
- Python: 20 passed.
- Frontend: 9 passed.
- Production build: passed with the exact contract address above.

## Live proof matrix

All writes ran in Normal consensus and were submitted only after the preceding transaction reached `FINALIZED`.

| Path | Transaction | Verified result |
| --- | --- | --- |
| Deploy primary | `0x00e83a6e97e5495f185d67612f3555e5f999e24c7da350c423e4627bacbab926` | `FINALIZED`; source/upgrader parity |
| Create case | `0x276b86bde75bbc69b387631324784b93109004602bfb57a12b137b4c6a06868f` | `FINALIZED`; case 1 |
| Add alias | `0x24260a28b4d474405e859a75f9debab7e574bd685ba9c45a60057fd1330aa728` | `FINALIZED`; authoritative readback |
| Add identifier | `0xcadc11236a1e99de774ac250d9dcdd6f0c2ea7ef419d633a5027d94c55195dea` | `FINALIZED`; authoritative readback |
| Freeze case | `0x0dac6773a6f94046f1de44695f925ca3a74c6cd2572cafc19f3409388c9bdfd8` | `FINALIZED`; snapshot bound |
| Assess case | `0x83d1546e409737ca71e3fa446000e7449a85be3aacce5d921f8730217d633e69` | `FINALIZED`; accepted majority; `UNRESOLVED` fail-closed readback |
| Deploy rehearsal | `0x447f1e60ee8c3e6bcb2a76253a9f21b46e817169880208f41058cc60f866ed89` | `FINALIZED` |
| Authorized rehearsal upgrade | `0x9ada0563c7bca4bb7f9f442259e7e871fd7aa89f00cfd136f0cdbba74a666859` | `FINALIZED`; source/upgrader/storage readback preserved |

The live assessment preserved the submitted organization, alias, identifier, source policy, and snapshot. Because the official source could not be fetched or decoded, outcome and consequence were both `UNRESOLVED`; no clearance or positive match was recorded.

## Known limits

- The unauthorized upgrade probe was rejected by Studio before transaction submission, so it has no Explorer transaction.
- The live app URL and compiled-asset parity belong to the later hosting checkpoint.
- The product remains a Studionet prototype and not a production compliance determination.
