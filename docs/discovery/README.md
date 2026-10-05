# Open-Industries discovery evidence

The current target is the **SQLite city-dump runtime v2** in `Mapped-Assembly/Open-Industries`, introduced by [Open-Industries PR #3](https://github.com/Mapped-Assembly/Open-Industries/pull/3). The tested commit is `583c6fefd2e63cb49776f81d06d1b688b1bfd06f`, also pinned in `.github/workflows/ci.yml`. The capture in [openindustries-runtime-v2.json](openindustries-runtime-v2.json) comes from starting the actual stdio process, enumerating all **18 tools**, then calling the schema-verified, read-only `astra.game_describe` operation. It is not an invented API.

The earlier [13-tool capture](openindustries-local.json) is historical evidence from the scene-only server. Old servers and the Supabase/Postgres v1 contract are incompatible with this adapter. Neither can start a game here.

## Observed capability mapping

| Requirement | Published v2 operation/evidence | Scope and gap |
| --- | --- | --- |
| Identity and membership | `astra.game_create_match`, `astra.game_join_match`; SQLite account/session service | Two participants, expiring one-use invite; owner comes from the game session |
| Private world | `astra.game_read_match` and strict snapshot schema | One private finite cable deposit per player; shared spatial map/outposts absent |
| Inspection | `astra.game_command` / `inspect_deposit` | Server-issued cable assay; no range, occlusion or noisy robot sensing |
| Collection | `collect_deposit` | Atomic depletion and one batch; no travel, hauling or cargo limits |
| Processing | `start_processing`, `pause_job`, `resume_job`, `cancel_job` | One powered, durable cable-separator recipe; broad science/manufacturing not yet integrated |
| Machine/match recovery | `dismantle_machine`, `abandon_match` | Cancellation preserves material and energy spent |
| Persistence and clock | SQLite WAL and independent runtime process | Service ticks without browsers/MCP; durable receipt and restart tests run in upstream CI |
| Synchronization | `astra.game_read_match` | Full-snapshot polling; replace state; no event stream advertised |
| Construction/combat/results | None | Full-match startup remains disabled |
| Existing 13 scene/room tools | Still listed by discovery | Adapter does not expose them through the game backend |

## Verification boundary

Schema equality includes every input and output field, action, version, bound and error shape. Matching names alone are insufficient. Only the checked-in contract is compiled for application validation. Discovery may call `astra.game_describe` only after its schema and every required game schema exactly match the reviewed contract. It never creates, joins or changes a match. No credentials are needed for discovery.

The adapter validates successful outputs against the success branch; structured error codes become application-owned messages. Hidden extra fields, invalid responses, unexpected schemas and old versions fail closed. The SDK validates the published structured-error branch as well.

`npm run discover:oi -- <checkout>` emits the report. Exit **2** still means the full game is unavailable, even when `processingContractVerified` is true. Exit **1** means discovery failed. No local simulation fallback is provided.

`npm run test:integration` starts the real independent SQLite service, creates actual local accounts, drives the real MCP SDK through the HTTP boundary and verifies identity, privacy, strict inputs, receipts and revocation. `npm run test:browser` checks desktop/mobile rendering and two isolated Chromium sessions, then uses the browser HTTP API for create/join/inspect/collect/process and logout/reconnect. These are production local SQLite paths, not authentication or database facades. The processing controls/map UI and full game remain follow-up work.

The material-calculation library remains pure. Authoritative inventory decisions execute inside Open-Industries transactions; the browser and tower-defense backend never tick, award material, certify properties or resolve combat.
