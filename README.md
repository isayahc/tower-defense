# Tower Defense: City Dump

A planned two-player strategy game where rival robot crews turn a city's discarded waste into working industry, defenses, and raiding units. Scan the dump, recover useful scrap, process it into usable materials, and destroy the opposing tower before your own falls.

**Status: material-calculation core and MCP discovery implemented; no playable match yet.** The TypeScript core validates material batches, evaluates part suitability, and calculates processing plans with conserved mass and explicit energy. It does not own inventory or run a local game. The running OpenIndustries stdio server has been inspected: it currently exposes scene/room tools, not authoritative game operations. See the [discovery evidence and capability gaps](docs/discovery/README.md).

This README is the product specification. [The science-engine design](docs/material-science.md) defines the intended full engine; [the integration contract](docs/openindustries-contract.md) defines the authoritative boundary still required for playable matches.

## The Setting

Both players occupy opposite ends of one municipal dump on the edge of a city. Appliance heaps, discarded cables, packaging, vehicle scrap, glass, tires, and construction debris form resource sites and obstacles. Service roads connect the heaps to abandoned recycling stations and the two reclamation bases.

Industrial cities become **reclamation outposts**: places to sort, process, store, and manufacture recovered materials. Neutral outposts can be captured; enemy facilities can be disabled or captured under server-defined rules. The dump is the economy and the battlefield, not just a background texture.

Each player starts with one tower, two basic scavenger robots, a solar generator, a charged battery, a sorting/inspection bench, a fabricator, and a small recorded starter inventory. Both starting areas offer equivalent access to the inputs needed for the first production chain. Exact quantities, generation rates, recipes, and timings belong in versioned balance data.

## The Game Loop

1. **Explore and scan.** Sensors reveal evidence about reachable objects rather than exposing the entire map's contents.
2. **Choose a recovery job.** Compare likely material, confidence, distance, cargo capacity, energy cost, and route exposure.
3. **Scavenge and haul.** Robots collect finite objects or batches and return them to a base or outpost. Travel, collection, and charging take server time.
4. **Sort and inspect.** Separate mixed loads and establish usable material grades. Finding a metal object does not establish its alloy or purity.
5. **Process.** Strip cables, clean and sort scrap, press or remelt suitable metals, and shred and remold compatible polymers. Account for time, power, usable output, and residue.
6. **Manufacture.** Use materials whose properties satisfy a part's requirements. Build better sensors, robots, processors, defenses, and raid units.
7. **Contest the dump.** Defend recovery routes, seize outposts, and raid power, scanners, processors, or haulers to disrupt the opponent's supply chain.
8. **Win.** OpenIndustries confirms tower destruction and records the result. Existing automation continues when a player disconnects.

## Robots and Sensors

Players assign jobs and policies such as survey, collect a material class, return when loaded, recharge, defend, attack, target, and retreat. Robots execute them on the server. Initial robots use deterministic job logic; an LLM is not required to identify materials or decide physical outcomes.

| Sensor or inspection | Useful evidence | Limit in the game |
| --- | --- | --- |
| RGB camera | Shape, visible markings, surface condition | Appearance does not certify chemistry or see through a pile |
| Depth sensor | Reachable surfaces, clearance, approximate volume | Buried contents remain unknown; volume alone does not establish mass |
| Magnetic/inductive probe | Ferrous response or a conductive object | Does not certify a particular metal, alloy, or purity |
| Near-infrared scanner | Polymer classification on suitable exposed surfaces | Low-quality, dirty, dark, or mixed-surface readings can remain inconclusive |
| Thermal sensor | Surface temperature and hot objects | Does not certify battery health, composition, or absence of a hazard |
| Inspection bench | Slower material grading and component tests | Consumes time and power; unsupported properties remain unknown |

Observations record confidence, sensor, position, and server timestamp. Range, occlusion, and sensor errors matter. Rescanning costs time and power. The client never receives hidden material truth, an opponent's private observations, or a seed that reconstructs them.

## A Science Engine for Material Use

The engine answers **“What can this batch become, what will it cost, and why?”** It uses a curated material catalog, processing rules, and component requirements within the authoritative OpenIndustries simulation. Browser previews cannot award outputs.

| Recovered material | Candidate uses after suitable processing | Important requirement |
| --- | --- | --- |
| Identified steel scrap | Frames, brackets, tower reinforcement | Grade, condition, and fabrication process must meet the part specification |
| Aluminum scrap | Light frames, housings, heat spreaders | Alloy and section design matter; not every batch is structural stock |
| Copper cable or windings | Conductors, motor coils, power distribution | Conductor grade, cross-section, and insulation requirements must pass |
| Sorted HDPE | Low-temperature housings, cable guides, selected insulating parts | Polymer identity, contamination, and temperature limits must pass |
| Compatible glass fragments | Filler or panels through a supported process | Broken glass is not automatically optical-grade sensor glass |
| Recovered tire rubber | Reused tread or granulated material in a supported recipe | Cured rubber is not treated as a freely remeltable thermoplastic |
| Tested salvaged components | Motors, bearings, electronics, batteries | Track separately from bulk material; tests and condition determine reuse |

Properties include density, electrical and thermal conductivity, relevant strength measures, temperature limits, and magnetic behavior. Batches carry composition, contamination, condition, mass, form, and processing history. Unknown properties stay unknown; material families are not interchangeable tokens.

The first engine is a deterministic, science-informed rules model. Scientific reference data and game balance values are separately labeled and versioned. It does not simulate arbitrary chemistry or certify real machinery. Sources, rules, and worked examples are in [the science design](docs/material-science.md).

## Industry, Power, and Combat

Track material batches, reusable components, stored energy, available power, and manufactured inventories. There is no universal “metal” balance that can pay for every part.

Initial machines include the starter generator, charging station, inspection/sorting bench, cable separator, metal press, suitable furnace, polymer processor, fabricator, turrets, and raid launchers. Each specifies supported feedstocks, operating limits, throughput, power demand, and upgrades. Unknown batteries and mixed electronic waste cannot enter a general-purpose shredder or furnace.

Material choice affects performance: mass changes robot payload and travel energy; conductor properties affect power loss; suitable structural stock supports durability; temperature limits constrain operation. Geometry and processing quality also matter. Combat damage, ammunition, and raid outcomes remain explicit game rules rather than real weapon-design calculations.

Factories use declared bills of materials. Better sensors and sorting unlock better inputs; research unlocks recipes and equipment, not new physical properties. Shortages pause work with a clear explanation.

## OpenIndustries Authority

Exactly two authenticated players share a continuously running match. OpenIndustries owns membership, identity, ownership, simulation time, hidden dump contents, observations, robot jobs, inventories, processing, construction, combat, tower health, and final results.

The browser sends commands through a secure backend and displays authorized state. Server credentials never appear in browser code, bundles, or logs. The backend derives player identity from authentication; it does not trust a browser-supplied player ID.

Every mutation is authorized, state-version checked, and idempotent. Collection, input reservation, and production completion are atomic so retries or competing robots cannot duplicate resources. Disconnects do not stop production or combat. Reconnection restores server state, including queued jobs and observations.

Exact MCP tools, resources, authentication, and update mechanisms must come from the target server's published schema. [Required capabilities and the discovery gate](docs/openindustries-contract.md) are requirements, not claims that these APIs already exist.

**No local fallback simulation.** If the server, schema, or a required capability is unavailable, show an integration error and prevent match startup. Missing support must be implemented in OpenIndustries before dependent gameplay ships.

## Player Experience

The interface includes a dump map with survey coverage, robot jobs and cargo, tower status, power use, processing queues, route threats, and a material inspector. Scrap details show what the robot knows and how confidently. Recipes show accepted inputs, unmet requirements, estimated time and energy, expected outputs, and residue.

Explain rejected uses in plain language, for example: “This batch is still mixed; sort it before making a housing.” Crafting previews must not expose unobserved composition. Waiting, active, reconnecting, paused production, integration error, victory, and defeat states must work on desktop and mobile.

## First Playable Scope

- One finite city-dump map, exactly two players, one tower per player, and capturable reclamation outposts.
- Scavenger robots with cargo and energy limits; camera/depth/probe sensing and an upgrade path to NIR and thermal sensing.
- Steel, aluminum, copper, HDPE, glass, and rubber with at least one supported recovery/use path each; inspection for reusable components.
- A complete cable-to-conductor chain and sorted-HDPE-to-housing chain, followed by robot or defense assembly from valid components.
- Server-owned scanning, collection, sorting, processing, manufacturing, defense, raids, and victory.
- Automated queues, depletion, residue, suitability explanations, reconnect support, and a starter economy without circular build dependencies.

## Delivery and Verification

Track work in [epic #1](https://github.com/isayahc/tower-defense/issues/1). Deliver incremental child issues and pull requests: discover OpenIndustries capabilities and establish the TypeScript foundation; define the material engine; implement sensing and scavenging; connect processing and manufacturing; complete the two-player interface and combat flow.

Before calling the game playable, verify two authenticated browser sessions from create/join through tower destruction, including disconnect/reconnect during processing. Test conservation, sensor privacy, ownership, concurrent collection, retries, stale commands, power starvation, and unsupported inputs at the authoritative boundary. Run formatting, lint, type-check, test, and build commands once the toolchain exists.

## Out of Scope for the First Version

- Single-player gameplay, more than two players, and local/offline simulation.
- Global trade, cosmetic purchases, and user-created maps.
- Arbitrary chemistry, detailed battery recycling, semiconductor fabrication, and engineering certification.
- An LLM acting as the authority for material identity, physics, inventory, or match results.

## Run the Current Implementation

Install Node.js **22.18 or newer** and Git. These commands also work in Windows PowerShell:

```sh
git clone https://github.com/isayahc/tower-defense.git
cd tower-defense
npm ci
npm run demo:science
npm run check
```

The demo evaluates a labeled test fixture: 10 kg of inspected cable becomes a plan for 5.7 kg of conductor, 3 kg of insulation, and 1.3 kg of residue at a cost of 10 kJ. It also shows that unknown material requires inspection. These are pure calculations, not a running match or a measured recycling result.

`npm run check` runs formatting checks, lint, strict type checking, tests, and the TypeScript build. `npm run build` emits importable modules and CLI commands into `dist/`. `npm run dev` runs the science fixture; it does not start a game server. The CI workflow runs these checks on Linux and Windows.

To discover an installed OpenIndustries checkout without invoking any mutating tool:

```sh
npm run discover:oi -- ../Open-Industries
```

Use its actual path, for example `C:/projects/Open-Industries`. Run `npm ci` in that checkout first. The discovery command launches its real `server/astra-mcp.mjs`, performs the MCP handshake, and lists advertised tools/resources. No account or provider key is needed for this read-only schema inspection. It exits **2** when discovery succeeds but the game contract is unsupported, and **1** when discovery fails; neither condition enables a local fallback. See [the captured result and limits](docs/discovery/README.md).

There is no browser game, match API, remote deployment, authentication layer, durable inventory, or combat runtime in this slice. In production, only OpenIndustries may load trusted batch evidence, invoke these calculations, and commit their results transactionally. Callers cannot treat a calculated plan as awarded material or a validated player command.
