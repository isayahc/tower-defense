# OpenIndustries Integration Contract

Status: the actual SQLite v2 stdio server exposes 18 tools, including five game tools. Their exact schemas and static contract are verified by the adapter; see [discovery evidence](discovery/README.md) and [web architecture](web-foundation.md). Native local account, processing, ownership and reconnect paths are exercised through the real service/MCP boundary. Full-game support, the map/robot UI and external deployment remain outstanding. The matrix below describes the complete target; it is not a claim that the bounded processing runtime implements every row.

## Discovery Gate

Select the target deployment, obtain authorized server-side access, and discover its published tools, resources, schemas, and update transports. Document authentication, ownership, persistence, scheduling, payload limits, transactions, idempotency, and extension points.

Check in a secret-free capability matrix linking every requirement below to the discovered operation/resource/schema, evidence, and any gap. Domain concepts in these documents are not MCP method names. Source inspection alone does not prove that a deployed server exposes a capability.

If support is missing, identify the required OpenIndustries change and block the dependent feature. Do not move the science engine, clock, or state authority into a local fallback backend or the browser.

## Capabilities to Verify

| Area | Authoritative capability |
| --- | --- |
| Membership | Authenticated create/join, exactly two players, invites, ownership, reconnect, final result |
| Map and visibility | Finite deposits, obstacles, outposts, server-only contents, per-player projections |
| Sensing | Range/visibility checks, time/energy costs, persistent observations, uncertainty/versioning |
| Scavenging | Jobs, routes, payload/energy limits, atomic depletion, hauling, charging |
| Materials | Batch composition/mass/form/condition, components, inspection evidence, provenance/versions |
| Science rules | Suitability and processing within the authoritative transaction boundary |
| Production | Reservations, power allocation, queues, pause/resume, consumption and output/residue exactly once |
| Construction | Bills of materials, ownership, machine capabilities, upgrades, configuration, start/stop |
| Combat | Orders, movement, damage, interruption, capture, salvage, tower destruction |
| Persistence | Simulation without browsers; restart recovery without duplicated or rerolled state |
| Synchronization | Authorized snapshots and ordered/deduplicable updates, gap recovery, conflicts, command results |

## Secure Boundary

The browser talks to an authenticated game backend, which uses the verified MCP interface. Credentials stay server-side. OpenIndustries verifies match membership and ownership using authenticated identity, not a trusted browser-supplied player ID.

Commands identify their match, operation, idempotency key, and expected state version; the discovered schema determines the wire format. Responses and errors contain only authorized information. The backend does not independently increment inventory, tick robots, resolve materials, or decide victory.

Any required server extension participates in OpenIndustries persistence, scheduling, authorization, and atomic transactions. Streaming is preferred when supported; safe MCP-backed polling is acceptable.

## Failure Behavior

- Missing/incompatible capabilities: integration error; block match startup.
- Temporary connection loss: show stale/connecting status, disable commands that cannot be safely accepted, restore an authoritative snapshot on reconnect.
- Stale command: useful conflict with an authorized current-state version; no silent double-spend.
- Retried command: return the original result; reject reused IDs with different payloads.
- Disabled machine or full output storage: persist a paused job with inputs accounted for.
- Disconnect/restart: restore observations, jobs, versions, inventories, and results from OpenIndustries.

## Foundation and Verification

Choose and document the TypeScript architecture after discovery. Add `.env.example` with placeholders, server-only secret handling, responsive UI foundations, and actual development, formatting, lint, type-check, test, and build commands. Do not invent setup instructions before they exist.

Test the adapter against the captured schema or a faithful contract double. A double is test infrastructure, never a runtime gameplay fallback.

Final verification requires two real authenticated browser sessions completing a match, rejection of a third player and cross-player commands, scans without truth leakage, concurrent collection, processing, manufacturing, raids, disconnect/reconnect, restart recovery, and authoritative victory. Record commands, schema/version evidence, results, and limitations without secrets.
