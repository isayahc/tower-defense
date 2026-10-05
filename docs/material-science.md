# Material Science Engine Design

Status: #5 is implemented as a bounded material engine in Open-Industries' SQLite authority. `@openindustries/material-science` is the canonical pure package; `src/science/` re-exports the exact vendored build for fixtures and tests. `npm run check:materials` compares every vendored file with the upstream revision pinned in CI. Live browser requests use server-owned IDs, evidence, recipes and machines; they cannot supply properties or grant stock.

Matches persist `materials-v2`, `balance-v2` and `bench-v1`. The service validates batches, components, observations, recipes, part requirements and results; runs paid, durable bench tests; returns private suitability/process/substitution previews; and commits processing with SQLite reservations, receipts and conservation checks. Six material families have explicit catalog recovery/use paths. Only the installed cable separator executes processing today; other machine requirements are reported without granting equipment. Robot sensing, hauling, new machines and assembly/manufacturing remain later work.

### Implemented evidence and balance rules

- A bench job takes **3 seconds at 100 W (300 J)**. Its owner, target/revision, bench position, timestamp and properties are recorded privately. Cancellation returns the reserved batch and retains spent energy. Repeated tests are deterministic, so they do not accumulate independent random guesses.
- A recovered pure-copper wire stream can receive the **game** grade `game-copper-v1`. Its `bench-v1/copper-wire-test-fixture` reports conductivity 47,000,000 S/m with a bounded interval of 45,000,000–49,000,000 S/m, and density 8,950 kg/m³ with bounds 8,800–9,100 kg/m³, both only at 20 °C. These are synthetic gameplay measurements, not material-reference claims or real instrument accuracy. Other stock retains unknown grade/properties unless a supported fixture establishes them.
- Property approval uses the conservative interval bound. An unknown interval or one crossing a threshold needs more evidence; an unsupported grade, failed property or temperature limit gives an explicit reason. Reference data cannot be attached as batch evidence. Thermal conductivity has its own `W/(m*K)` unit and is not inferred from electrical conductivity.
- Starter stock component records reference the existing component ledger: no additional bulk mass is granted. A 300 J functional test establishes compatibility with `starter-maintenance-v1` only. It does not unlock arbitrary battery/electronics salvage or assembly jobs.
- The approved `aluminum-power-link-v1` substitution is a **game design** at 20 °C. From measured conductivity's lower bound it rounds the area needed to match a 2 mm², 40,000,000 S/m baseline upward to 0.01 mm². The 1 m / 10 A design has a 4 mm² envelope, uses density's upper bound to round required grams upward, reports resistance/loss, and requires `bimetal-terminal-v1`. This is a preview requiring inspected aluminum and a supported assembly; there is no universal metal swap or wiring certification.
- `recover-cable-residue` recovers half the remaining copper, rounded down, using the separator at 500 W and 2 seconds/kg. Every remaining constituent stays in residue, including rounding remainder. Every output requires a fresh inspection; prior grade/property evidence is never copied to it.

Run `npm run demo:science` for the cable fixture, `npm test` for pure validation, and the integration/browser commands in [web setup](web-foundation.md) for the real authority. Open-Industries runs the canonical core tests, 300 accounting cases, durable inspection/restart and nine successive residue passes, alongside existing transaction/concurrency tests. Gameplay thresholds and sensor fixtures still need playtesting; this engine does not certify engineering materials.

## Decisions and Evidence

For a batch and proposed use, return **eligible**, **ineligible**, or **needs inspection**, with reasons and supported next steps. Check required evidence, material properties, form, mass, geometry, and available processes.

A player-visible preview uses only authorized observations and established properties. Execution uses server truth inside an approved process. Unknown feedstock may produce a downgraded or failed batch, but unrestricted recipe queries must never become an oracle for hidden composition. Critical components require inspected inputs; uncertain scrap routes to sorting or inspection.

An inspection establishes only the properties covered by that test. Visual inspection cannot certify an unknown alloy's structural strength.

## Domain Records

These are domain records, not MCP operation names. The initial engine validates them in the authoritative service; spatial robot sensing and construction extend them later.

| Record | Required information |
| --- | --- |
| Material definition | Stable ID, family/grade, forms, physical properties with units and conditions, supported processes, sources, catalog version |
| Scrap deposit | Server-only composition/components, finite remaining mass/count, location, accessibility, hazard state, revision |
| Observation | Player/robot, target/location, sensor, evidence, candidate classes, uncertainty, server timestamp, target revision |
| Material batch | Owner/location, integer mass in grams, constituent masses, contamination, form, condition, established properties, inspection/process history, revision |
| Reusable component | Kind, count, condition, mass, tests passed, compatible assemblies, ownership; never also credited as bulk constituent material |
| Process recipe | Feedstock predicates, outputs, machine and operating envelope, energy, throughput, recovery and impurity routing, residue rules, version |
| Part requirement | Form, geometry, mass/quantity, property predicates, service conditions, inspection evidence, supported substitutions |
| Production job | Command ID, owner, reserved inputs, machine, recipe/catalog versions, state, progress, energy used, output/residue IDs, timestamps |

Use integer or fixed-point accounting with defined rounding. Reject negative masses, non-finite values, undefined units, contradictory compositions, and unknown versions. Constituent masses sum to batch mass; contamination is included in that sum.

Distinguish density (kg/m³), electrical conductivity (S/m), thermal conductivity (W/(m·K)), temperature (°C), and specifically named strength measures (MPa). Each physical property has a source, applicable grade/conditions, and uncertainty or range where available. A game score is labeled as such, not presented as a measurement.

## Catalog and Scientific Grounding

Initial families: steel, aluminum, copper, HDPE, compatible glass, and recovered tire rubber. Grade, heat treatment, degradation, contamination, and form constrain their uses. Missing strength or conductivity stays unknown.

Reference anchors include pure copper at approximately 8,960 kg/m³ and a melting point of 1,084.62 °C [S1], and pure aluminum at approximately 2,700 kg/m³ and 660.323 °C [S2]. These values describe the referenced pure elements. They do not certify scrap, define alloy melting ranges, or specify furnace operating temperatures.

The README's candidate uses are game-design mappings. Copper's conductivity motivates wiring [S1]; aluminum's density and conductivity motivate lighter parts and heat spreaders, subject to alloy and design limits [S2]. Additional numerical properties need suitable references before entering the catalog.

Keep scientific properties separate from game balance data such as build times, recovery fractions, sensor accuracy, and combat multipliers. Neither “purity multiplies every property” nor “alloy properties are weighted ingredient averages” is an acceptable universal rule. Unsupported mixtures stay mixed stock.

## Sensors and Hidden Knowledge

Game sensors sample reachable surfaces using versioned error models; these are not real hardware interfaces. Define confidence semantics, for example a candidate-class probability distribution including an unknown class. Do not present a gameplay probability as measured hardware accuracy.

| Evidence | Permitted conclusion | Still unknown |
| --- | --- | --- |
| Camera sees insulated cable | A candidate cable worth recovering | Conductor, exact mass, insulation chemistry |
| Probe detects magnetic response | A ferromagnetic constituent may be present | Full composition, purity, grade |
| Inductive detector responds | Conductive material may be present | Copper versus aluminum or another conductor |
| NIR obtains a usable polymer signal | A candidate polymer at the surface | Buried layers, whole-batch purity, mechanical properties |
| Thermal sensor detects heat | A hot surface merits inspection/avoidance | Battery chemistry, internal condition, absence of hazard |

Magnetic ferrous recovery and nonferrous recovery use distinct methods [S3]. Eddy-current sorting separates conductive nonferrous material but does not itself certify alloy identity [S4]. Industrial optical sorting combines NIR, color, and metal sensors [S5]. These principles motivate complementary upgrades rather than perfect detection.

Range, occlusion, dirt, and signal quality affect observations. Evidence is timestamped and tied to a target revision. Identical rescans under unchanged conditions must not provide unlimited independent draws that converge cheaply to hidden truth; new viewpoints, cleaning, or inspection can provide new evidence.

The server owns reproducible random state and never sends hidden-content seeds to clients. Snapshots, events, previews, errors, and player-visible logs must all obey the same visibility rules.

## Processing, Mass, and Energy

For each job and constituent:

`input mass = usable output mass + residue mass + material remaining in the job`

Include any external material inputs on the input side. Mechanical separation and forming cannot create or transmute constituents. Chemical transformations require a separately supported recipe and are outside the initial engine.

A recovery model can use `recovered_i = floor(input_i × recovery_fraction_i)`, with fractions in [0, 1]. Route contaminants explicitly between streams. Compute purity from output composition: recovery yield and purity are different quantities. Rounding remainder goes to residue or retained material.

Store energy in joules and power in watts. At constant power, `energy_J = power_W × elapsed_seconds`; `1 Wh = 3,600 J`. Grid/battery supply and machine power limits constrain progress. Game duration and recovery values are balance parameters, not industrial performance claims.

Solar generation records energy entering from the environment. Charging includes declared losses; jobs, movement, and scans debit energy. The starter economy must support its first recovery loop without requiring an upgrade that depends on that same loop.

### Cable Recovery Example

**Balance fixture:** an inspected 10,000 g batch contains 6,000 g copper, 3,500 g identified insulation, and 500 g dirt. A configured separation job routes:

| Stream | Copper | Insulation | Dirt | Total |
| --- | ---: | ---: | ---: | ---: |
| Conductor | 5,700 g | 0 g | 0 g | 5,700 g |
| Insulation stream | 0 g | 3,000 g | 0 g | 3,000 g |
| Residue | 300 g | 500 g | 500 g | 1,300 g |
| Total | 6,000 g | 3,500 g | 500 g | 10,000 g |

An illustrative 500 W, 20-second job costs 10,000 J. This fixture intentionally yields a clean conductor; supported recipes must define impurity carryover rather than assume perfect separation. Insulation enters a polymer recipe only if its identity and condition pass. Reprocessing residue cannot recover more copper than remains.

### Initial Supported Chains

| Feedstock | Process | Candidate output |
| --- | --- | --- |
| Inspected cable | Separate insulation, grade conductor, form as required | Conductor for compatible power/motor assemblies |
| Identified steel | Sort, inspect grade/condition, press or use a suitable metal process | Bracket or reinforcement meeting structural requirements |
| Aluminum | Sort and grade, then use compatible forming | Housing or a supported frame design |
| Identified HDPE | Sort, clean, shred, remold within its recipe envelope | Housing or guide within its service-temperature rating |
| Compatible glass | Sort, use supported filler recipe | Filler component, not an optical-grade lens |
| Tire rubber | Inspect and cut reusable tread | Traction component; no generic remelting route |
| Motor/electronics/battery | Isolate, inspect, test, check compatibility | Tested component, not new electronics fabricated from raw scrap |

Any cleaning inputs, binders, or consumables belong in the bill of materials and residue accounting. Unknown batteries and mixed electronic waste go to isolation/inspection rather than general shredding or heating. Damaged batteries in waste processing are a real fire concern [S6]; detailed battery chemistry/recycling remains outside the game model.

## Suitability and Performance

Requirements apply to a particular part and operating environment. Replacing a copper conductor with aluminum requires an approved design with suitable cross-section and connections; the tag “conductive” is insufficient.

When inputs and conditions are supported, simple dimensional relations can inform gameplay:

- Homogeneous part mass: `m = density × volume`.
- Conductor resistance: `R = length / (electrical_conductivity × area)`.
- Resistive loss: `P_loss = current² × resistance`.

A melting point is not a safe service-temperature limit. Density alone does not establish armor performance; strength alone does not establish structural durability. Movement, cooling, durability, and combat use explicit part-specific game mappings separate from reference science.

Return stable reason codes with readable text and next actions, such as `NEEDS_INSPECTION`, `WRONG_FORM`, `MIXED_POLYMERS`, `UNSUPPORTED_GRADE`, `TEMPERATURE_LIMIT`, `INSUFFICIENT_INPUT`, and `INSUFFICIENT_POWER`. These are domain decision codes inside `astra.game_evaluate` results, separate from transport errors.

Research unlocks tools and recipes. It cannot change a material's conductivity, make unknown scrap pure, or turn ordinary glass into optical stock. New material entries need evidence and tests.

## Jobs and Reproducibility

Suggested states: queued, running, paused, completed, cancelled, failed. Define reservation and material handling at every transition.

- Atomically reserve inputs; one batch cannot fund two jobs.
- Retry a command ID by returning its original result; reject the same ID with a different payload.
- Atomically consume inputs and create uniquely identified outputs/residue at completion.
- Cancellation returns only unconsumed inputs; processed material remains recorded as output, work in progress, or residue.
- Disabling a machine pauses it. Destruction records retained material as salvage/residue; cancellation cannot also refund it.
- Pin catalog, recipe, balance, and sensor-model versions per match; persist server random state.
- Reconnects and server restarts resume persisted progress without duplicating completion or rerolling contents.

These rules execute within OpenIndustries or a verified server extension sharing its atomic state boundary. A TypeScript library can supply pure calculations for unit tests but cannot become an independent local simulation.

## Acceptance Scenarios

| Scenario | Required result |
| --- | --- |
| Two robots collect the last scrap simultaneously | Recovery never exceeds the deposit; the losing order receives a current-state explanation |
| A client reads network state before scanning | No hidden composition, opponent observations, or reconstructive seeds |
| A camera sees cable; player requests a high-grade conductor | Inspection required; appearance is not certification |
| Cable fixture completes and its command is retried | 10,000 g accounted for; 10,000 J charged once; unique outputs |
| Residue is repeatedly processed | No constituent exceeds its remaining mass; every job still costs energy |
| Mixed plastic enters the HDPE recipe | Reject or route to inspection/sorting; no free purity upgrade |
| Machine cannot meet the process envelope | Reject startup and explain the unmet requirement |
| Polymer part exceeds its service-temperature limit | Reject the use even below melting temperature |
| An approved alternative conductor is chosen | Recompute geometry and power-loss effects |
| Suspicious battery reaches a general shredder | Route to supported isolation/inspection |
| Power fails, client disconnects, server restarts | Resume energy, progress, reservations, and versions without duplication |
| A factory is destroyed mid-job | Inputs, work in progress, salvage, and residue accounted for exactly once |

Core and real SQLite tests cover 300 varied accounting cases, repeated recovery, unknown projections, thermal limits, invalid inputs, approved geometry, concurrent collection, durable jobs/inspections, ownership, private observations and exact receipts. The browser suite exercises two real sessions through inspection, suitability, temperature refusal, component testing and residue recovery. Robot collection, spatial sensor models, factory manufacturing and combat in this broader specification remain future work.

## Sources

Sources originally checked on 2026-10-04; S1/S2 reference anchors rechecked on 2026-10-05. Sources support the physical rationale; none validates the game's balance fixtures or proposed implementation.

- **S1:** [Royal Society of Chemistry — Copper](https://periodic-table.rsc.org/element/29/copper): pure-element properties and uses.
- **S2:** [Royal Society of Chemistry — Aluminum](https://periodic-table.rsc.org/element/13/aluminium): pure-element properties and distinction from alloys.
- **S3:** [Eriez — Metals Recycling](https://www.eriez.com/Products/Metals-Recycling): ferrous and nonferrous recovery methods.
- **S4:** [Eriez — Eddy Current Separators](https://www.eriez.com/Products/Metals-Recycling/Nonferrous-Recovery/Eddy-Current-Separators): conductive nonferrous separation.
- **S5:** [TOMRA — AUTOSORT FLAKE](https://www.tomra.com/waste-metal-recycling/products/machines/autosort-flake): complementary NIR, camera, and metal sensing.
- **S6:** [US EPA — Used Lithium-Ion Batteries](https://www.epa.gov/recycle/used-lithium-ion-batteries): damage and fire risks in waste handling.
