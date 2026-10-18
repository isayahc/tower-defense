# Spatial sensing and dump exploration

Spatial exploration is authoritative on Open-Industries. The browser never receives hidden deposit composition, the world generation seed, or another crew's observations. It renders only public map geometry plus the signed-in crew's persisted field evidence.

## Sensor limits

| Sensor | Range | Survey time | Power while sensing | Availability | What it can establish |
| --- | ---: | ---: | ---: | --- | --- |
| Camera + depth | 8 cells | 2 s | 20 W | Starter robot | Visible geometry and exposed/reachable surfaces. It does not certify chemistry. |
| Magnetic + inductive | 2 cells | 3 s | 30 W | Starter robot | Supported ferrous/conductive response. It does not establish alloy or purity. |
| NIR | 3 cells | 3 s | 40 W | Bench-test the owned `nir-sensor-kit` | Candidate polymer class on a clean exposed surface. It does not establish a polymer grade. |
| Thermal | 8 cells | 2 s | 25 W | Bench-test the owned `thermal-sensor-kit` | Surface heat evidence. It does not establish battery health. |

A survey also pays the server-owned travel cost to a reachable sensing position. Open-Industries chooses the route, enforces obstacles and line of sight, checks that enough robot energy remains to return, advances the independent server clock, and records the sensing energy actually spent.

## Evidence and uncertainty

Each completed survey persists the sensor and sensor-model version, robot sensing position, target revision, authoritative timestamp, measured range, surface/signal quality, confidence, candidate classes, evidence cues, and useful next actions. Deposits whose revision changes after collection are shown with stale evidence until they are surveyed again.

Surface dirt, low signal, occlusion and line of sight can prevent classification. An unknown result is a valid result; the client does not replace it with hidden truth. Camera/depth, NIR and thermal deliberately make narrower claims than a bench inspection.

Identical surveys are keyed by deposit, deposit revision, sensor, sensing position and observation quality. Repeating the same unchanged observation still costs time and energy, but it reuses the original evidence instead of drawing a new uncertainty result. Moving to a materially different observation condition or changing the deposit revision can produce new evidence.

## Map behavior

Before the local crew has evidence, waste sites are labeled **UNKNOWN** by the exploration overlay. After a survey, the map shows only the crew's candidate class, observation quality and confidence. Survey circles show the declared sensor range from the recorded sensing position, and the selected target lists evidence plus server-provided next actions.

Coverage is private. A rival crew may survey the same public waste location, but its observation IDs, confidence, cues and candidate classes are not projected into this crew's snapshot. The shared map continues to expose public geometry, depletion/revision state and tactical state required by the game.

## Upgrade flow

New matches include one finite NIR kit and one finite thermal kit in each crew's starter inventory. They begin untested. Use the material lab or the spatial-sensing panel to bench-test the kit through the existing authoritative `inspect_component` command. A successful test marks the owned kit sound; only then will Open-Industries accept that crew's NIR or thermal `survey_robot` command.

The upgrade does not change the MCP command shape and does not give the browser authority to claim a sensor is installed. The server checks owned tested kit state on every advanced survey request.
