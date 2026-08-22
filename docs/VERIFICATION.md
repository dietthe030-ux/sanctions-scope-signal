# Verification

## Revision and deployment

- Contract source commit: `4d65ae51b2375db5d35327f262a7d3e267bc143d`
- Contract SHA-256: `b56d3c8cdbdf502137f793c069a0d1dfdab9000ae8f9efc229873f9d5c7c1d90`
- Network: Studionet, chain `61999`
- Contract: `0x1d4bc527d5747044A5CC8fCE8EB91e193742b4d6`
- [Explorer](https://explorer-studio.genlayer.com/address/0x1d4bc527d5747044A5CC8fCE8EB91e193742b4d6)
- [Deployment transaction](https://explorer-studio.genlayer.com/tx/0x44110079da0ca8b7ae3ce3065565171376f21c7aea09ecc01ec65e0af6263291)
- [Live app](https://sanctions-scope-signal.vercel.app)
- Deployment: `FINALIZED`, successful leader execution, Normal consensus, majority agree.
- Deployed-source parity: RPC `gen_getContractCode`, normalized to LF, returns the exact source hash above.
- Upgrader readback: `0xf5C66e5155a62E27047aD4ccE729593D6B9c03Fc`.
- Account separation: Studio deployment/E2E used only `0xf5C6…03Fc`; the user's Vercel wallet `0xBf90…b40D` was not used in Studio testing and owns no Studio test case.
- Features: Automatic immutable official-source digest binding (`frozen_source_digest`) at freeze time, 5-field validator consensus (`outcome`, `consequence`, `source_digest`, `matched_record`, `match_narrative`), and zero manual snapshot-label authority.

The final public commit and live Vercel artifact hashes are recorded in the immutable final release evidence after hosting verification, avoiding a self-referential tracked-file hash. The stable production URL serves the reviewed frontend with the exact Studionet contract configuration.

## Reproducible checks

```powershell
$env:PYTHONUTF8='1'
genvm-lint check contracts\sanctions_scope_signal.py --json
genvm-lint schema contracts\sanctions_scope_signal.py --json
py -3.13 -m pytest tests -q --cache-clear
npm test
$env:VITE_CONTRACT_ADDRESS='0x1d4bc527d5747044A5CC8fCE8EB91e193742b4d6'
npm run build
```

Results on the release candidate:

- GenVM AST and SDK semantic validation: pass; 11 public methods.
- GenVM schema extraction: pass; 4 view and 7 write methods.
- Python: 31 passed (29 direct lifecycle/evidence regressions + 2 GenVM preflight).
- Frontend: 16 passed, including duplicate-provider, non-MetaMask Studionet connection, reload-required reconnection, rollback/error/malformed receipt locking, automatic immutable official-source digest binding, and 1-argument `freeze_case` regressions without manual snapshot labels.
- Production build: passed with the exact contract address above.

## Live proof matrix

The primary deployment, application writes, authorized rehearsal upgrade, and rejection probes ran in Normal consensus and were submitted only after the preceding consequential transaction reached `FINALIZED`. The authorized rehearsal upgrade was `leader_only: false`, reached `MAJORITY_AGREE` with three agree and two idle votes, and preserved authoritative storage/upgrader readback.

### Current release deployment (0x1d4bc527d5747044A5CC8fCE8EB91e193742b4d6)

| Path | Transaction | Verified result |
| --- | --- | --- |
| Deploy range-verified contract | `0x44110079da0ca8b7ae3ce3065565171376f21c7aea09ecc01ec65e0af6263291` | `FINALIZED`; `SUCCESS`; majority agree; upgrader readback |
| Create case 1 | `0xba79b77a48ae036f979e2be60a6bc7b5f027e97de0223af60116a5e8838df3ba` | `FINALIZED`; `SUCCESS`; DRAFT readback |
| Add alias | `0xb739e226c866f026902a2223723fc15517bf85eace118ecb733b16cd5217782a` | `FINALIZED`; `SUCCESS`; alias readback |
| Add identifier | `0xa90118aba9b7f7086f95c862edcccf5b61082e57c26a15e12d6088b280968388` | `FINALIZED`; `SUCCESS`; identifier readback |
| Freeze official publication | `0xbe87cb834f25054066b90c630127d28c10af18e15d65beec22e8d5dbf417afc4` | `FINALIZED`; `SUCCESS`; digest `2d0f6054…1ee82`; FROZEN readback |
| Assess frozen case | `0x5305be6be62a129ef90516f9d12a43c5a281732c0f642f7c51c9d9fb332c0b90` | `FINALIZED`; `SUCCESS`; `NO_MATCH_IN_BOUND_SNAPSHOT / NO_SIGNAL` |
| Reject invalid legal name | `0x3abcc5e83eaa32d437a563bac0fee65c370fe52025e78e69140472629eeedda7` | `FINALIZED`; rollback; case count unchanged |
| Reject post-assessment alias | `0xde0dd1c273382311029281375d20ecc52cada74ebd5c0ecdd52460c708bd9432` | `FINALIZED`; rollback; assessed state unchanged |
| Create replacement case 2 | `0x538bd4dafbaca113e1f61442683a1b2f72dbebe91e4f19cd55d4356aae7ddccc` | `FINALIZED`; `SUCCESS`; replacement DRAFT |
| Freeze replacement case 2 | `0x66d54a57d893cf295e25e14dc137a90c34724053e6b9861106cc734c143140fe` | `FINALIZED`; `SUCCESS`; exact bound digest readback |
| Assess replacement case 2 | `0xc4c61143dd7f15a991f029b0a79fa446c218ffd42189f78fe4e81cd7336463ad` | `FINALIZED`; `SUCCESS`; current `SIGNALLED / NO_SIGNAL` |
| Supersede case 1 with case 2 | `0x37a3fb893c71437e34e2f75cfe3aa0a0336aa06b42d2d4b969321e50738318f0` | `FINALIZED`; case 1 readback `SUPERSEDED`, `superseded_by=2`; case 2 remains current |
| Deploy exact-source upgrade rehearsal | `0xe45613dead88f69b3dff979f195e0e0fbd4db020ce777f9ec248a45db851625b` | `FINALIZED`; rehearsal `0xeeC77C03541D0d405b16aeCB29c5043Ae3090aF6` |
| Create rehearsal storage probe | `0x875c9991137a83bb2ea46d3e3042d33f2ec84e7020f239947af32270ac7dc567` | `FINALIZED`; case count and case 1 readable before upgrade |
| Authorized compatible rehearsal upgrade | `0xae36441e8392043d57cb4dd742ab96fb2d2219d13fe36da34442b216ac4909f7` | `FINALIZED`; source changed only on rehearsal; case count, case JSON, and sole upgrader preserved |
| Reject unauthorized rehearsal upgrade | `0xdba3eca4f80d146c37f586457e40b4d534a7b69f1cd7df7b5a4741be5e067820` | `FINALIZED`; leader/validators rejected forbidden code-slot write; case count `1` and sole upgrader unchanged |

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

The live assessment preserved the submitted organization, alias, identifier, source policy, and exact publication digest. The complete bound UN publication contained no supplied term, so consensus recorded the bounded `NO_SIGNAL` consequence without representing legal clearance.

## Known limits

- The current unauthorized-upgrader probe is the finalized rehearsal transaction recorded above. Historical pre-submission rejection evidence applies only to the superseded deployment.
- The stable live URL, production ownership, and compiled-asset parity were verified at the hosting checkpoint; generated deployment identifiers remain in the immutable final evidence rather than this source commit.
- The product remains a Studionet prototype and not a production compliance determination.
