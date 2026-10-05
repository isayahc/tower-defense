# OpenIndustries Discovery Evidence

On 2026-10-05 UTC, the discovery CLI launched the actual local OpenIndustries MCP process from commit [`a0a45063c99f7243915dd6e92e780c6f88a90fc9`](https://github.com/caid-technologies/Open-Industries/commit/a0a45063c99f7243915dd6e92e780c6f88a90fc9). It completed `initialize`, sent `notifications/initialized`, and requested `tools/list`. The [captured schema](openindustries-local.json) is an observed response, not a fabricated game API.

The server identifies itself as `mergence` version `0.1.0` and advertises only the `tools` capability. No resources, resource templates, or subscriptions are advertised. The client queries those lists only if the server declares resource support.

## Observed Mapping

| Game requirement | Published capability | Result |
| --- | --- | --- |
| Room/layout authoring | `astra.create_room`, `astra.list_rooms`, `astra.read_room` | Local scene files; not match creation or membership |
| Scene asset inspection | `astra.list_scene_assets`, `astra.inspect_scene_asset` | Geometry/provenance inspection; not physical scrap assays |
| Saved scene revisions | `astra.create_scene`, `astra.read_scene`, `astra.update_scene` | Scene persistence; not durable game ticks or inventory transactions |
| Form handoff/review | `astra.read_animation_feedback`, `astra.read_form_project`, `astra.save_form_project`, `astra.list_feedback`, `astra.write_space_brief` | Design workflows; not production or combat |
| Exactly two players and per-asset command ownership | No matching published operation | Missing game contract |
| Continuous clock, jobs, and restart recovery | No matching published operation | Missing game contract |
| Hidden deposits, observations, collection, and depletion | No matching published operation | Missing game contract |
| Material plans committed with inventory/power transactions | No matching published operation | Missing game contract |
| Construction, combat, tower destruction, victory | No matching published operation | Missing game contract |

## Authentication and Persistence Limits

Source inspection of [the MCP entry point](https://github.com/caid-technologies/Open-Industries/blob/a0a45063c99f7243915dd6e92e780c6f88a90fc9/server/astra-mcp.mjs) and [scene documentation](https://github.com/caid-technologies/Open-Industries/blob/a0a45063c99f7243915dd6e92e780c6f88a90fc9/docs/mcp-scenes.md) shows local stdio transport. Local room tools write files; scene tools use opt-in account-scoped cloud persistence through the project's CLI session. Scene revision conflict handling is not equivalent to game command idempotency or tick scheduling.

Schema discovery did not sign in, mutate a scene, use a provider, or verify a hosted endpoint. The test suite uses a clearly labeled contract double of the captured schema for pagination, timeout, read-only behavior, error handling, and stderr isolation; those tests do not prove real gameplay.

## Reproduce

After installing dependencies in both checkouts:

```sh
npm run discover:oi -- ../Open-Industries
```

The command emits a JSON report. Exit codes: **2** means discovery succeeded but no verified game adapter exists; **1** means discovery failed. The current slice deliberately cannot report game readiness even if a future server happens to advertise plausible tool names. Supporting a new game API requires a reviewed adapter, contract tests, and authenticated runtime verification.

The SDK uses a bounded stdio buffer, paginated discovery, a deadline, and child-process cleanup. Server stderr is drained without forwarding arbitrary text. No `tools/call` or mutation is performed. No remote credentials are accepted or stored by this CLI.

## Next Required Server Work

Tracked upstream in [OpenIndustries #83](https://github.com/caid-technologies/Open-Industries/issues/83).

OpenIndustries needs an explicit authoritative game-runtime extension: authenticated two-player matches, private/public state projections, transactional inventories, durable server jobs, idempotent commands, simulation time, combat, and restart/reconnect recovery. Its published schemas must identify the actual supported operations. The material core can be reused there as pure calculations; it cannot replace those state and authorization guarantees.

The TypeScript foundation currently contains the discovery CLI and scientific rules modules. Browser architecture, authentication, match endpoints, and real deployment remain outstanding under tower-defense #3/#4 and the upstream integration work.
