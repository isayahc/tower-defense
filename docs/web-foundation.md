# Web and adapter foundation

A small TypeScript/Node HTTP backend serves static HTML/CSS/JavaScript. It uses the official MCP SDK over local stdio and a separately running Open-Industries SQLite service. No Supabase package, hosted database or cloud-provider account is required in tower-defense.

## Setup

Install Node 22.18+ and both repositories with `npm ci`. Use the Open-Industries combat-v1 commit pinned in `.github/workflows/ci.yml` with this matching client (SQLite schema 10). In Open-Industries, create `.env` with `ASTRA_GAME_ALLOW_SIGNUP=true` and run `npm run game:server`. This creates its private SQLite file and starts autonomous ticks on loopback port 8790.

In tower-defense, copy `.env.example` to `.env`, set `OI_CHECKOUT` to that installed checkout, and run `npm run dev`. Open **http://127.0.0.1:3000**. Windows PowerShell accepts forward slashes in the checkout path, for example `C:/projects/Open-Industries`.

Without configuration, the page loads an actionable integration-error view. With a compatible running service, it offers native game-account registration/sign-in. Use a username (3–40 letters, digits, `_` or `-`) and a password of at least 12 characters. Disable upstream registration after provisioning accounts if desired. These are local game accounts; no email verification/reset flow is implemented.

Production build: `npm run build`, then `npm start`. `npm run demo:science` remains a separate pure material fixture. `npm run dev` now starts the web foundation rather than the science demo.

Both services bind loopback. For remote browsers, put the game backend behind a TLS reverse proxy on the same host, preserve its Host header, and set `TD_PUBLIC_ORIGIN` to the exact public HTTPS origin. Do not expose the SQLite service or its files directly. This small deployment uses an in-memory browser-session registry, so one backend process owns its sessions; restarting the backend requires sign-in again, while SQLite match progress remains durable.

## Boundary and routes

| Route | Purpose |
| --- | --- |
| `GET /api/integration` | Cached read-only discovery and service health; always reports `canStartMatch: false` |
| `POST /api/session` | Exact `{mode: "login" or "register", username, password}`; returns only authentication status |
| `GET /api/session` | Revalidate the game session server-side |
| `DELETE /api/session` | Revoke the upstream session, close its MCP process and clear the cookie |
| `POST /api/runtime` | Exact `{name, args}` for the eight versioned recovery/science tools; authenticated and schema-checked |
| `POST /api/matches` | Starts one authenticated match after exact contract and live scheduler verification; body: `{version:5, command_id:UUID}` |

The browser receives a random opaque HttpOnly, SameSite=Strict cookie; it never receives the runtime token, a player-ID selector or server filesystem paths. HTTPS uses a Secure `__Host-` cookie. Backend sessions last at most eight hours, are bounded to 32, and each owns one lazily started MCP process. SQLite verifies the token/owner on every game operation. A browser-supplied identity, arbitrary tool name or unknown field is rejected before forwarding.

POST/DELETE requests require exact Origin and Host matches and JSON bodies. Cross-site requests and DNS-rebinding Host values are rejected. No CORS is enabled. Static serving is allowlisted; `.env`, source files and databases cannot be requested. Responses are no-store with a restrictive CSP and no-referrer policy. Runtime errors and stderr never pass through unfiltered. Authentication and per-session calls have rate/concurrency/body/deadline limits; a proxy should impose normal network traffic limits too.

## Commands and recovery

Use server-issued object IDs and revisions. Keep the same `command_id` and identical payload when a response is lost; the adapter never blindly retries a mutation or chooses a replacement ID. An uncertain result returns `OUTCOME_UNKNOWN`. After a conflict, read the current snapshot and reconcile before creating a new command. Each read is a full authorized replacement snapshot. Receipts can contain old snapshots, so read again after replay.

Processing endpoints support only the declared foundation. The static describe response does not prove scheduler health, successful authentication or deployment readiness; health and identity are separately checked. Full-game startup requires both the verified contract and live scheduler health.

## Check

```sh
npm run check
npm run test:integration
npx playwright install chromium
npm run test:browser
```

`npm run check:materials` also checks the vendored pure package against the pinned upstream checkout, normalizing only Git’s CRLF/LF text conversion on Windows. The last two test commands need `OI_CHECKOUT` in the process environment. In PowerShell: `$env:OI_CHECKOUT = 'C:/projects/Open-Industries'`. Test scripts create private temporary SQLite databases and run real service/MCP processes. They never touch the configured production database. Browser screenshots are written to `test-results/` and uploaded by CI. The browser test clicks through create, refresh/renew invitation, join, inspect/collect/process, pause/resume, sign-out/sign-in restoration and mutual completion. It deliberately loses one committed response and checks that the UI retries the identical payload/ID. It also performs paid conductor/component inspections, verifies private persisted evidence, requests suitability at supported/unsupported temperatures, reprocesses residue and holds a click across a polling interval. Desktop/mobile screenshots and console/overflow checks cover the actual map and material lab, including construction-to-steel recovery and battery-suspect vehicle-to-aluminum isolation.

## Play the recovery session

1. Sign in in two separate browser profiles (or normal/incognito windows).
2. Create a recovery session. Share the match ID and invitation code with your partner, who selects **Have an invitation?** and joins. Renew an invite if you refreshed before sharing it; this invalidates older codes.
3. Select a waste site, then **Survey with camera-depth · robot 1**. The robot follows a server-owned obstacle-aware grid route and records private evidence. An installed magnetic/inductive probe is also available. Sensor evidence does not certify composition.
4. Choose a supported **Collect** action. The server reserves at most the remaining stock and free 10 kg payload, budgets travel/collection/return energy, then hauls and unloads automatically. Robots start with 8 kJ. The map shows current authoritative positions and remaining routes; the dispatch panel shows phase, work time, cargo and energy. No browser interpolation advances the robot.
5. Unknown recovered material requires **Inspect recovered batch** at the bench before supported processing. Cable separation consumes 20 seconds / 10 kJ. For other waste, use **Review recovery routes**, choose the matching cold recovery/isolation recipe, preview it, then start the approved process. Inspect the usable output to evaluate existing material uses. Suspect appliance/vehicle residue stays quarantined; batteries and mixed electronics have no generic process route.
6. **Interrupt** releases material reserved before pickup and keeps cargo already collected. **Return and unload** or **Retreat and unload** carries that cargo home. **Return and recharge** shares the base's single charging port, waits behind active processing, and resumes automatically. Insufficient energy requires recharge; changed deposit evidence requires a new survey. Errors preserve the current snapshot and explain the next action.
7. Refresh or sign out/in to restore membership, routes, observations, cargo and job progress. Service restart catches up durable jobs. No credentials or game state enter browser storage.
8. Finish the recovery session after processing and after robots have finished and unloaded. Both crews must finish; this records no combat winner.

The map has seven finite waste categories per starting area, roads, blocking scrap walls, neutral outposts and towers. Grid travel runs at four cells per second on traversable ground, including service roads; no road speed bonus exists. Raid movement uses a separate one-cell-per-second combat fixture. The shared dump is accessible to either crew. Begin combat explicitly to issue tactical orders and capture outposts. Victory, defeat and tie results persist after tower destruction. Older saves retain their original instant starter-cable recovery controls; new sessions require robots.

The v5 runtime now requires SQLite schema 7. The schema-5 envelope migration preserves native IDs, inventory, paid work, observations, version pins and immutable receipt bytes. Schema 6 adds the starter-recovery compatibility marker without rewriting existing envelopes or receipts. Earlier science/robot upgrades run once when needed. Back up the complete SQLite database, including history and cursor keys, before upgrading. Returning to an older binary requires the complete pre-upgrade backup; never combine old inventory with newer receipts. Use the exact pinned runtime for both services.

Polling every two seconds replaces the current snapshot. A failed connection marks the view stale and disables mutations; **Reconnect match** refreshes it. A mutation with an uncertain outcome retains its exact command in memory and exposes **Retry pending command**; it blocks new work until resolved. Conflict responses refresh state and require an explicit new action. Reloading drops pending in-memory commands: inspect the restored membership/inventory/job state before issuing new work.

The earlier v4 service migrates v3 SQLite matches once, preserving material, jobs, energy and immutable receipts while adding pinned science versions and component references. Historical cable assays remain valid for separation; old recovered outputs receive no retroactive property measurements. Earlier v2 matches first receive the existing world migration. Back up first and upgrade both repositories together. Full-game startup requires the matching full-match contract and a healthy live service. The server health response includes its exact game contract; older services fail closed.

## Construct machines and manufacture parts

The construction panel reads the authoritative manufacturing catalog. Choose a recipe, select the specific owned material batch, manufactured parts and tested component stock, then select **Review bill of materials**. Missing requirements come from Open-Industries. **Queue approved manufacture** reserves those exact inputs atomically. The queue displays waiting/running/paused/completed/cancelled/failed state, reasons, paid work and energy. Pauses and cancellation use durable command IDs like other game work.

The bench finishes approved homogeneous recovered stock into conductors, brackets, housings, filler and tread. Build a press, furnace, polymer processor and fabricator from those parts and tested hardware. The starter fabricator, solar unit and idle unloaded robots at home can be deliberately dismantled from the equipment list to reclaim their exact original components; inspect them before reuse. There is no grant of motors, electronics or batteries. A new scavenger robot starts empty and needs base charging. Base defenses, a solar reflector, solar hardware and a charging port also have explicit bills of materials. Combat and victory remain unavailable.

Finished-part racks hold 16 parts. Queued work keeps reservations through power/equipment/storage waits. Discarded or destroyed products retain their material and hardware in private debris records, with no refund. The client neither calculates yields nor advances work. See the [engine policy](https://github.com/Mapped-Assembly/Open-Industries/blob/main/docs/game-manufacturing-queues.md) for exact quantities, rates, limits and accounting.

Manufacturing and combat require the pinned SQLite schema-10 runtime and matching reviewed client schemas. Back up the complete database before upgrade; older binaries require the complete pre-upgrade backup. Existing schema-6 state and immutable receipts are preserved. Local `npm run check` and real HTTP/MCP integration cover the expanded contract; browser CI includes desktop press construction and mobile conductor manufacture with screenshots.


## Defensive platforms (#20)

The construction catalog now includes HDPE/aluminum turret variants, raid launchers and 250 g steel-slug ammunition. The owner-only platform panel and map show deployment position, health, range/target eligibility, cooldown, magazine, shot/commissioning energy and blocked reasons. Deploy to a free reachable home-side cell, load while disabled, then enable. Damaged disabled platforms accept a steel bracket plus 500 J for up to 40 health. Salvage costs 300 J and returns ungraded constituent lots, untested original hardware and remaining attached products exactly once. All controls use the existing immutable command retry path; no client supplies unit stats, damage or material grants.

Open-Industries SQLite schema 10 and the exact matching wire-v5 extension are required. Before combat starts, supplied equipment stays idle. After **Begin combat**, the server resolves orders and tower damage; victory, defeat and tie results are authoritative; the complete match browser flow is exercised by `npm run test:browser:full`. See the engine's `docs/game-units.md` for bills of materials, limits and accounting policy.


## Combat demo

Manufacture and deploy a turret or raid launcher; disable it to load specific manufactured steel slugs, then enable it. **Begin combat** publishes tactical IDs, kinds, positions, health and recent combat events to both players. Opponent inventories, sensor evidence, cargo and ammunition IDs remain private. This action is permanent for that session; use **End session for both crews** to archive it without awarding a combat winner.

Select a public target, then use **Defend**, **Attack target**, **Hold and target**, **Capture outpost** or **Retreat** on an enabled unit. Turrets hold position; launchers can advance toward firing range. Orders display pending/running/completed/cancelled state and range, power, ammunition, route or contention reasons. The map and public tactical list show updated health and outpost ownership. Commands are revision checked and retain the existing identical-intent retry behavior.

Combat moves at one cell per second for 30 J/cell; shots consume the profile's energy and one real slug, respecting range, walls and cooldown. Capture requires five uncontested seconds next to an outpost. Retreat walks home and disables the launcher. To salvage during combat, disable the platform and either retreat near home or position a surviving recovery robot within two cells; salvage completes on a later server tick for 300 J. Destroyed hauler cargo stays counted in its wreck; cargo recovery is not implemented yet.

For a short demo, prepare inspected stock and tested hardware through actual recovery commands before inviting the audience. Demonstrate recovery/production, a turret damaging the other crew's moving robot, a launcher advancing toward a tower, then reconnect and retreat/salvage. Tower destruction ends the match. One destroyed tower awards the other crew the win; both destroyed in the same pulse is a tie. The browser never computes damage or awards stock. See [engine combat policy](https://github.com/Mapped-Assembly/Open-Industries/blob/main/docs/game-combat.md).

Verification: `npm run check`, `OI_CHECKOUT=<absolute-engine-path> npm run test:integration`, and `OI_CHECKOUT=<absolute-engine-path> npm run test:browser:full`. The browser scenario uses manufactured stock and two signed-in sessions on desktop/mobile; the engine's `npm run test:combat` additionally covers tower damage, restart, capture, retreat, timed salvage and competing SQLite connections.


## Final results

Open-Industries evaluates tower health after all shots in the same server tick. One destroyed tower gives the other crew victory; both destroyed in that tick produces a tie. The final-result panel shows your Victory, Defeat or Tie, the public winner, both final tower health values, a stable result ID and the server resolution time. Both participants receive the same saved record; only the display label depends on your own slot.

The result stops remaining jobs and combat through the existing accounting paths. Paid energy remains spent, uncollected reservations are released and existing stock/cargo remains counted. New match mutations are disabled in the UI and rejected by the runtime. An exact retry of an earlier command still returns its original immutable receipt; reconnect reads the current result. Refreshing either browser or restarting the runtime preserves the result.

`npm run test:browser:results` verifies all three outcomes on desktop and mobile using curated near-final-blow SQLite fixtures and actual server shots/MCP/HTTP. These fixtures are isolated result coverage, not evidence of the manufacturing chain. The engine's `npm run test:victory` separately starts from real recovered stock and manufactures the launcher and ammunition through tower destruction. `npm run test:browser:full` separately uses two isolated desktop/mobile accounts to create/join, recover real scrap, test original hardware, manufacture a launcher and six slugs, destroy the opposing tower, and reconnect after hard restart during combat and after completion. It never seeds stock, moves the clock or writes the database.

## Full-match startup

Sign in, select **Start full match** or **Create match**, and share the invitation with a second account. Join with **Join match**. Recover and inspect material, manufacture parts and supplied units, then select **Begin combat**. An attack order advances a launcher into range of the selected opposing tower; six 50-health shots destroy a 300-health tower. Reload the two-slug launcher between volleys. The match phase displays waiting, active, paused, reconnecting and final outcome; incompatible services display an integration error and disable startup.

`POST /api/matches` accepts only `{ "version": 5, "command_id": "<UUID>" }`. Preserve that body for uncertain retries. The same command returns its original receipt, including its original invitation. New startup checks the live worker and exact advertised contract even when discovery is cached. Accounts, host/origin checks, CSRF protection, quotas and server-owned state also apply to this route.
