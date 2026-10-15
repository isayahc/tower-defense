# Open-Industries discovery evidence

The current target is the **SQLite city-dump runtime v5** in `Mapped-Assembly/Open-Industries`, at `5e306c2033bfdb15510f98f575f937e1578f6a3f` ([upstream PR #16](https://github.com/Mapped-Assembly/Open-Industries/pull/16)), pinned in `.github/workflows/ci.yml`. The capture in [openindustries-robots-v5.json](openindustries-robots-v5.json) comes from starting the actual stdio process, enumerating all **21 tools**, then calling the schema-verified, read-only `astra.game_describe` operation. It is not an invented API.

The [v2 capture](openindustries-runtime-v2.json) preserves the earlier SQLite processing foundation; the [13-tool capture](openindustries-local.json) records the original scene-only server. The [v3 world capture](openindustries-world-v3.json) also remains historical evidence. Old servers and the Supabase/Postgres v1 contract are incompatible with this adapter. Neither can start a game here.

## Observed capability mapping

| Requirement | Published v5 operation/evidence | Scope and gap |
| --- | --- | --- |
| Identity and membership | `astra.game_create_match`, `astra.game_join_match`; SQLite account/session service | Two participants, renewable one-use invite; `astra.game_list_matches` restores owned memberships |
| Private world | `astra.game_read_match` and strict snapshot schema | Fourteen finite deposits, shared roads/obstacles/outposts/towers, private cable assay and starter equipment/stock ledgers |
| Inspection | `astra.game_command` / `inspect_deposit` | Private survey evidence with range, occlusion and stable uncertainty; bench inspection establishes supported properties |
| Material science | `astra.game_science_catalog`, `astra.game_evaluate`, `inspect_batch`, `inspect_component`, `start_material_process` | Pinned catalog, owned evidence, suitability/approved geometry, paid bench tests and residue reprocessing; no client-supplied properties |
| Collection | `survey_robot`, `collect_robot`, `return_robot`, `recharge_robot`, `interrupt_robot`, `retreat_robot` | Atomic finite reservations, obstacle-aware routes, 10 kg cargo and 8 kJ energy limits, durable hauling and shared-port charging |
| Processing | `start_processing`, `pause_job`, `resume_job`, `cancel_job` | Powered cable separation and residue recovery through the shared engine; other recipes explicitly require unavailable machines |
| Machine/match recovery | `dismantle_machine`, `abandon_match` | Cancellation preserves material and energy spent |
| Persistence and clock | SQLite WAL and independent runtime process | Service ticks without browsers/MCP; durable receipt and restart tests run in upstream CI |
| Synchronization | `astra.game_read_match` | Full-snapshot polling; replace state; no event stream advertised |
| Lifecycle/results | `finish_recovery`, `abandon_match`, invitation expiry | Waiting/active/completed sessions; no combat winner; full-match startup stays disabled |
| Power | 100 W solar / 20 kJ battery in authoritative snapshots | Bounded charging, explicit spill and spent energy; no manufacturing dependency |
| Existing 13 scene/room tools | Still listed by discovery | Adapter does not expose them through the game backend |

## Verification boundary

Schema equality includes every input and output field, action, version, bound and error shape. Matching names alone are insufficient. Only the checked-in contract is compiled for application validation. Discovery may call `astra.game_describe` only after its schema and every required game schema exactly match the reviewed contract. It never creates, joins or changes a match. No credentials are needed for discovery.

The adapter validates successful outputs against the success branch; structured error codes become application-owned messages. Hidden extra fields, invalid responses, unexpected schemas and old versions fail closed. The SDK validates the published structured-error branch as well.

`npm run discover:oi -- <checkout>` emits the report. Exit **2** still means the full game is unavailable, even when `processingContractVerified` and `canStartRecovery` are true. Exit **1** means discovery failed. No local simulation fallback is provided.

`npm run test:integration` starts the real independent SQLite service, creates actual local accounts, drives the real MCP SDK through the HTTP boundary and verifies identity, privacy, strict inputs, receipts and revocation. `npm run test:browser` checks desktop/mobile rendering and two isolated Chromium sessions, clicks the create/join/inspect/collect/process controls, verifies invite renewal, pause/resume, logout/reconnect, paid inspections, part suitability, component tests, residue recovery and mutual completion. These are production local SQLite paths, not authentication or database facades. A lost committed response is retried through the UI with the identical ID/payload. New machines/manufacturing, combat and victory remain follow-up work.

The material-calculation library remains pure. Authoritative inventory decisions execute inside Open-Industries transactions; the browser and tower-defense backend never tick, award material, certify properties or resolve combat.
