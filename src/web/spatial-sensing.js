const svgNamespace = "http://www.w3.org/2000/svg";

export function latestObservation(snapshot, targetId) {
  if (!snapshot?.field?.observations) return undefined;
  return snapshot.field.observations.filter((observation) => observation.target_id === targetId).at(-1);
}

export function sensorReady(snapshot, robot, sensor) {
  if (robot?.sensors?.includes(sensor.id)) return true;
  if (!sensor.kit) return false;
  return (snapshot?.science?.components ?? []).some(
    (component) =>
      component.kind === sensor.kit &&
      component.quantity > 0 &&
      component.tested === true &&
      component.condition === "sound",
  );
}

export function coverageRecords(snapshot) {
  if (!snapshot?.field?.observations) return [];
  const sensors = new Map(snapshot.field.sensor_catalog.map((sensor) => [sensor.id, sensor]));
  const latest = new Map();
  for (const observation of snapshot.field.observations) {
    const key = `${observation.target_id}/${observation.sensor}`;
    latest.set(key, observation);
  }
  return [...latest.values()].flatMap((observation) => {
    const sensor = sensors.get(observation.sensor);
    return sensor ? [{ ...observation, sensor_range: sensor.range }] : [];
  });
}

export function targetSummary(snapshot, deposit) {
  const observation = latestObservation(snapshot, deposit.id);
  if (!observation) {
    return {
      title: `Unknown target · ${deposit.position.x}, ${deposit.position.y}`,
      detail: "No private survey evidence yet.",
      current: false,
    };
  }
  const classes = observation.candidate_classes.filter((candidate) => candidate !== "unclassified");
  const current = observation.target_revision === deposit.revision;
  return {
    title: `${classes.length ? classes.join(" / ") : "Unclassified target"} · ${deposit.position.x}, ${deposit.position.y}`,
    detail: `${observation.sensor} · ${observation.quality} · ${(observation.confidence_bps / 100).toFixed(0)}% confidence${current ? "" : " · stale evidence"}`,
    current,
  };
}

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function sensorLabel(sensor) {
  return sensor.id
    .split("-")
    .map((part) => part.toUpperCase())
    .join(" ");
}

export function installSpatialSensing(request) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/spatial-sensing.css";
  document.head.append(link);

  let snapshot;
  let pending;
  let actionBusy = false;
  let overlayQueued = false;
  const map = document.getElementById("dump-map");
  const depositChoice = document.getElementById("deposit-choice");
  let panel;
  let status;
  let targets;
  let sensors;
  let actions;

  const safeRejections = new Set([
    "AUTH_REQUIRED",
    "CLASS_UNSUPPORTED",
    "CONFLICT",
    "DEPOSIT_EMPTY",
    "INSPECTION_REQUIRED",
    "INVALID_REQUEST",
    "LIMIT_REACHED",
    "MATCH_INACTIVE",
    "NOT_AVAILABLE",
    "NOT_READY",
    "ROBOT_BUSY",
    "ROBOT_ENERGY",
    "ROUTE_BLOCKED",
    "SCHEDULER_UNAVAILABLE",
    "SENSOR_UNAVAILABLE",
    "STALE_TARGET",
  ]);

  function ensurePanel() {
    if (panel?.isConnected) return;
    const robotPanel = document.getElementById("robots")?.closest("section.panel");
    if (!robotPanel?.parentElement) return;
    panel = element("section", undefined, "panel spatial-sensing-panel");
    panel.id = "spatial-sensing";
    const top = element("div", undefined, "panel-top");
    top.append(element("p", "SPATIAL SENSING", "eyebrow"));
    const badge = element("span", "PRIVATE EVIDENCE", "badge muted");
    top.append(badge);
    panel.append(top);
    panel.append(element("h2", "Explore before you extract."));
    panel.append(
      element(
        "p",
        "Survey coverage, confidence and sensor limits come from your crew’s server-owned observations. Rival evidence and hidden composition are never rendered here.",
        "note",
      ),
    );
    status = element("p", "Waiting for a match snapshot.", "spatial-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.append(status);
    const layout = element("div", undefined, "spatial-grid");
    const targetColumn = element("div");
    targetColumn.append(element("h3", "Survey coverage"));
    targets = element("div", undefined, "spatial-targets");
    targetColumn.append(targets);
    const sensorColumn = element("div");
    sensorColumn.append(element("h3", "Sensor limits & upgrades"));
    sensors = element("div", undefined, "spatial-sensors");
    sensorColumn.append(sensors);
    layout.append(targetColumn, sensorColumn);
    panel.append(layout);
    panel.append(element("h3", "Selected-target sensing"));
    actions = element("div", undefined, "spatial-actions");
    panel.append(actions);
    robotPanel.parentElement.insertBefore(panel, robotPanel);
  }

  function kitComponent(kind) {
    return snapshot?.science?.components?.find((component) => component.kind === kind);
  }

  function activeRobotJob(robot) {
    return snapshot?.field?.jobs?.find(
      (job) => job.robot_id === robot.id && ["running", "paused"].includes(job.state),
    );
  }

  function renderPanel() {
    ensurePanel();
    if (!panel || !snapshot) return;
    const observations = snapshot.field?.observations ?? [];
    const currentCount = snapshot.world.deposits.filter((deposit) => {
      const observation = latestObservation(snapshot, deposit.id);
      return observation?.target_revision === deposit.revision;
    }).length;
    status.textContent = `${currentCount} / ${snapshot.world.deposits.length} targets have current private evidence · ${observations.length} retained observations.`;

    targets.replaceChildren();
    for (const deposit of snapshot.world.deposits) {
      const summary = targetSummary(snapshot, deposit);
      const row = element("div", undefined, `spatial-target ${summary.current ? "current" : "unknown"}`);
      row.dataset.targetId = deposit.id;
      row.append(element("strong", summary.title));
      row.append(element("p", summary.detail, "note"));
      const observation = latestObservation(snapshot, deposit.id);
      if (observation) {
        row.append(element("p", `Evidence: ${observation.cues.join("; ")}`, "note"));
        row.append(
          element(
            "p",
            `Next: ${observation.next_actions.map((next) => next.replaceAll("-", " ")).join("; ")}`,
            "note",
          ),
        );
      }
      targets.append(row);
    }

    sensors.replaceChildren();
    for (const sensor of snapshot.field.sensor_catalog) {
      const row = element("div", undefined, "spatial-sensor");
      const kit = sensor.kit ? kitComponent(sensor.kit) : undefined;
      const availability = !sensor.kit
        ? "Starter sensor"
        : kit?.tested && kit.condition === "sound"
          ? `Upgrade ready · tested ${sensor.kit}`
          : kit
            ? `Locked · bench-test ${sensor.kit}`
            : `Locked · ${sensor.kit} unavailable`;
      row.append(element("strong", sensorLabel(sensor)));
      row.append(
        element(
          "p",
          `${sensor.range} cell range · ${(sensor.duration_ms / 1000).toFixed(1)} s · ${sensor.power_w} W`,
          "note",
        ),
      );
      row.append(element("p", sensor.establishes, "note"));
      row.append(element("p", availability, sensor.kit && !(kit?.tested && kit.condition === "sound") ? "sensor-locked" : "sensor-ready"));
      if (sensor.kit && kit && !kit.tested) {
        const inspect = element("button", `Bench-test ${sensor.kit}`, "secondary");
        inspect.type = "button";
        inspect.disabled = actionBusy || !!pending || snapshot.status !== "active";
        inspect.addEventListener("click", () => beginAction("inspect_component", { component_id: kit.id }));
        row.append(inspect);
      }
      sensors.append(row);
    }

    actions.replaceChildren();
    const targetId = depositChoice?.value || snapshot.world.deposits[0]?.id;
    const target = snapshot.world.deposits.find((deposit) => deposit.id === targetId);
    if (!target) {
      actions.append(element("p", "Select a waste site on the map.", "note"));
      return;
    }
    actions.append(element("p", targetSummary(snapshot, target).title, "note"));
    for (const [index, robot] of snapshot.field.robots.entries()) {
      const block = element("div", undefined, "spatial-robot-actions");
      block.append(element("strong", `Robot ${index + 1} · ${robot.position.x}, ${robot.position.y}`));
      const busy = !!activeRobotJob(robot) || robot.retired;
      for (const sensor of snapshot.field.sensor_catalog) {
        const ready = sensorReady(snapshot, robot, sensor);
        const button = element(
          "button",
          ready
            ? `Survey with ${sensorLabel(sensor)}`
            : `${sensorLabel(sensor)} · ${sensor.kit ? `test ${sensor.kit} first` : "unavailable"}`,
          sensor.kit ? "secondary" : "",
        );
        button.type = "button";
        button.disabled =
          actionBusy ||
          !!pending ||
          snapshot.status !== "active" ||
          busy ||
          !ready ||
          target.depleted;
        button.addEventListener("click", () =>
          beginAction("survey_robot", {
            robot_id: robot.id,
            deposit_id: target.id,
            sensor: sensor.id,
          }),
        );
        block.append(button);
      }
      actions.append(block);
    }
    if (pending) {
      const retry = element("button", "Retry exact sensing command", "secondary");
      retry.type = "button";
      retry.disabled = actionBusy;
      retry.addEventListener("click", executePending);
      actions.append(retry);
    }
  }

  function setStatus(message) {
    if (status) status.textContent = message;
    const global = document.getElementById("game-message");
    if (global) global.textContent = message;
  }

  function beginAction(action, args) {
    if (!snapshot || pending || actionBusy) return;
    pending = {
      name: "command",
      args: {
        version: 5,
        match_id: snapshot.match_id,
        expected_revision: snapshot.revision,
        action,
        ...args,
        command_id: crypto.randomUUID(),
      },
    };
    void executePending();
  }

  async function executePending() {
    if (!pending || actionBusy) return;
    actionBusy = true;
    renderPanel();
    const exact = pending;
    try {
      const result = await request("/api/runtime", {
        method: "POST",
        body: JSON.stringify({ name: `astra.game_${exact.name}`, args: exact.args }),
      });
      pending = undefined;
      if (result.snapshot) snapshot = result.snapshot;
      setStatus("Sensor command saved on the authoritative runtime.");
      setTimeout(() => document.getElementById("refresh-match")?.click(), 0);
    } catch (error) {
      if (safeRejections.has(error.code)) {
        pending = undefined;
        setStatus(error.message);
        setTimeout(() => document.getElementById("refresh-match")?.click(), 0);
      } else {
        setStatus(
          "The sensor command outcome is uncertain. Retry the exact command; do not create a new intent.",
        );
      }
    } finally {
      actionBusy = false;
      renderPanel();
    }
  }

  function svg(tag, attributes) {
    const result = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, String(value));
    return result;
  }

  function renderMapOverlay() {
    overlayQueued = false;
    if (!snapshot || !map?.isConnected) return;
    map.querySelector("[data-spatial-overlay]")?.remove();

    const observationByTarget = new Map(
      snapshot.field.observations.map((observation) => [observation.target_id, observation]),
    );
    for (const deposit of snapshot.world.deposits) {
      const observation = observationByTarget.get(deposit.id);
      for (const label of map.querySelectorAll("text.map-label")) {
        if (
          Number(label.getAttribute("x")) === deposit.position.x &&
          Number(label.getAttribute("y")) === deposit.position.y + 4
        ) {
          const candidates = observation?.candidate_classes?.filter(
            (candidate) => candidate !== "unclassified",
          );
          const next = observation
            ? (candidates?.length ? candidates[0] : "UNCLASSIFIED").toUpperCase()
            : "UNKNOWN";
          if (label.textContent !== next) label.textContent = next;
        }
      }
      const mark = [...map.querySelectorAll("circle.deposit")].find(
        (circle) =>
          Number(circle.getAttribute("cx")) === deposit.position.x &&
          Number(circle.getAttribute("cy")) === deposit.position.y,
      );
      if (mark) {
        mark.setAttribute(
          "aria-label",
          observation
            ? `${targetSummary(snapshot, deposit).title}${deposit.depleted ? ", depleted" : ""}`
            : `Unknown waste target at ${deposit.position.x}, ${deposit.position.y}${deposit.depleted ? ", depleted" : ""}`,
        );
      }
    }

    const group = svg("g", { "data-spatial-overlay": "true", "pointer-events": "none" });
    for (const coverage of coverageRecords(snapshot)) {
      group.append(
        svg("circle", {
          cx: coverage.position.x,
          cy: coverage.position.y,
          r: coverage.sensor_range,
          class: `survey-coverage survey-${coverage.quality}`,
        }),
      );
      const target = snapshot.world.deposits.find((deposit) => deposit.id === coverage.target_id);
      if (target) {
        group.append(
          svg("line", {
            x1: coverage.position.x,
            y1: coverage.position.y,
            x2: target.position.x,
            y2: target.position.y,
            class: "survey-ray",
          }),
        );
      }
    }
    map.append(group);

    const detail = document.getElementById("deposit-detail");
    if (detail) {
      detail.querySelector("[data-spatial-evidence]")?.remove();
      const selected = snapshot.world.deposits.find((deposit) => deposit.id === depositChoice?.value);
      if (selected) {
        const observation = latestObservation(snapshot, selected.id);
        const evidence = element("div", undefined, "spatial-deposit-evidence");
        evidence.dataset.spatialEvidence = "true";
        if (!observation) {
          evidence.append(element("p", "Unknown target: no private survey evidence yet.", "note"));
        } else {
          evidence.append(
            element(
              "p",
              `${observation.sensor} · ${observation.quality} · ${(observation.confidence_bps / 100).toFixed(0)}% confidence · revision ${observation.target_revision}`,
              "assay",
            ),
          );
          evidence.append(element("p", observation.cues.join("; "), "note"));
          evidence.append(
            element(
              "p",
              `Next: ${observation.next_actions.map((next) => next.replaceAll("-", " ")).join("; ")}`,
              "note",
            ),
          );
        }
        detail.append(evidence);
      }
    }
  }

  function queueOverlay() {
    if (overlayQueued) return;
    overlayQueued = true;
    requestAnimationFrame(renderMapOverlay);
  }

  const observer = new MutationObserver((mutations) => {
    const onlyOverlay = mutations.every((mutation) =>
      [...mutation.addedNodes, ...mutation.removedNodes].every(
        (node) => node.nodeType !== Node.ELEMENT_NODE || node.matches?.("[data-spatial-overlay]"),
      ),
    );
    if (!onlyOverlay) queueOverlay();
  });
  if (map) observer.observe(map, { childList: true, subtree: true });
  depositChoice?.addEventListener("change", () => {
    renderPanel();
    queueOverlay();
  });

  window.addEventListener("game-api-result", (event) => {
    const next = event.detail?.result?.snapshot;
    if (!next) return;
    snapshot = next;
    renderPanel();
    queueOverlay();
  });
}
