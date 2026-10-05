# Open-Industries discovery evidence

The current target is the **SQLite city-dump runtime v3** in `Mapped-Assembly/Open-Industries`, at `e8529035679f80ab1aa286fb07ac51032c9e2ff8` ([upstream PR #4](https://github.com/Mapped-Assembly/Open-Industries/pull/4)), pinned in `.github/workflows/ci.yml`. The capture in [openindustries-world-v3.json](openindustries-world-v3.json) comes from starting the actual stdio process, enumerating all **19 tools**, then calling the schema-verified, read-only `astra.game_describe` operation. It is not an invented API.

The [v2 capture](openindustries-runtime-v2.json) preserves the earlier SQLite processing foundation; the [13-tool capture](openindustries-local.json) records the original scene-only server. Both are historical evidence. Old servers and the Supabase/Postgres v1 contract are incompatible with this adapter. Neither can start a game here.

## Observed capability mapping

| Requirement | Published v3 operation/evidence | Scope and gap |
| --- | --- | --- |
| Identity and membership | `astra.game_create_match`, `astra.game_join_match`; SQLite account/session service | Two participants, renewable one-use invite; `astra.game_list_matches` restores owned memberships |
| Private world | `astra.game_read_match` and strict snapshot schema | Fourteen finite deposits, shared roads/obstacles/outposts/towers, private cable assay and starter equipment/stock ledgers |
| Inspection | `astra.game_command` / `inspect_deposit` | Server-issued cable assay; no range, occlusion or noisy robot sensing |
| Collection | `collect_deposit` | Atomic depletion and one batch; no travel, hauling or cargo limits |
| Processing | `start_processing`, `pause_job`, `resume_job`, `cancel_job` | One powered, durable cable-separator recipe; broad science/manufacturing not yet integrated |
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

`npm run test:integration` starts the real independent SQLite service, creates actual local accounts, drives the real MCP SDK through the HTTP boundary and verifies identity, privacy, strict inputs, receipts and revocation. `npm run test:browser` checks desktop/mobile rendering and two isolated Chromium sessions, clicks the create/join/inspect/collect/process controls, verifies invite renewal, pause/resume, logout/reconnect and mutual completion. These are production local SQLite paths, not authentication or database facades. A lost committed response is retried through the UI with the identical ID/payload. Only robot travel, broader science/manufacturing, combat and victory remain follow-up work.

The material-calculation library remains pure. Authoritative inventory decisions execute inside Open-Industries transactions; the browser and tower-defense backend never tick, award material, certify properties or resolve combat.
