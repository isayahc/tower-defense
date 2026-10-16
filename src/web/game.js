const el = (id) => document.getElementById(id);
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const kg = (g) => `${(g / 1000).toFixed(2)} kg`;
export function createGame(request) {
  let access = false;
  let busy = false;
  let idleWaiters = [];
  let stale = true;
  let snapshot;
  let pending;
  let selection;
  let cursor = null;
  let generation = 0;
  let listed = [];
  let invite = null;
  let productionCatalog;
  let productionPreview;
  let scienceCatalog;
  let evaluation;
  let interacting = false;
  let renderDeferred = false;
  const releaseInteraction = () => {
    interacting = false;
    if (renderDeferred) {
      renderDeferred = false;
      requestAnimationFrame(() => {
        render();
        controls();
      });
    }
  };
  el("recovery").addEventListener("pointerdown", () => {
    interacting = true;
  });
  window.addEventListener("pointerup", releaseInteraction);
  window.addEventListener("pointercancel", releaseInteraction);
  window.addEventListener("blur", releaseInteraction);
  el("recovery").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") interacting = true;
  });
  window.addEventListener("keyup", releaseInteraction);
  const api = (name, args) =>
    request("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ name: `astra.game_${name}`, args: { version: 5, ...args } }),
    });
  const say = (text) => {
    el("game-message").textContent = text;
  };
  function controls() {
    const usable = access && !busy && !stale && !pending;
    for (const n of document.querySelectorAll("#recovery [data-mutation]"))
      n.disabled = !usable || n.dataset.allowed === "false";
    el("retry-command").hidden = !pending;
    el("retry-command").disabled = !access || busy;
    el("refresh-match").disabled = !access || busy;
    el("more-matches").disabled = !access || busy || !cursor;
    el("refresh-list").disabled = !access || busy;
    el("game-state").textContent = !access
      ? "DISCONNECTED"
      : stale
        ? "RECONNECT NEEDED"
        : busy
          ? "SYNCING"
          : "LIVE";
    el("game-state").className = `badge ${stale ? "" : "ready"}`;
  }
  async function work(fn, background = false) {
    if (!access) return;
    const epoch = generation;
    // A user click that coincides with polling must not silently disappear.
    while (busy) {
      if (background) return;
      await new Promise((resolve) => idleWaiters.push(resolve));
      if (!access || epoch !== generation) return;
    }
    busy = true;
    controls();
    try {
      await fn();
    } catch (error) {
      if (generation === epoch) {
        if (
          !error.code ||
          [
            "UNAVAILABLE",
            "OUTCOME_UNKNOWN",
            "INVALID_RESULT",
            "CONTRACT_MISMATCH",
            "SCHEDULER_UNAVAILABLE",
            "AUTH_REQUIRED",
          ].includes(error.code)
        )
          stale = true;
        say(error.message);
        if (error.code === "AUTH_REQUIRED") window.dispatchEvent(new Event("game-auth-expired"));
      }
    } finally {
      busy = false;
      const waiting = idleWaiters;
      idleWaiters = [];
      for (const resume of waiting) resume();
      controls();
    }
  }
  function button(text, fn, allowed = true, className = "secondary") {
    const b = node("button", text, className);
    b.type = "button";
    b.dataset.mutation = "true";
    b.dataset.allowed = String(allowed);
    b.addEventListener("click", fn);
    return b;
  }
  async function read() {
    if (!snapshot) return;
    const id = snapshot.match_id,
      epoch = generation;
    const result = await api("read_match", { match_id: id });
    if (epoch !== generation) return;
    snapshot = result.snapshot;
    await loadCatalog(epoch);
    if (epoch !== generation) return;
    stale = !snapshot.scheduler_healthy;
    render();
  }
  function adopt(result) {
    if (snapshot?.match_id !== result.snapshot.match_id) selection = null;
    snapshot = result.snapshot;
    if (result.invite_code) invite = { id: snapshot.match_id, code: result.invite_code };
    if (snapshot.status !== "waiting") invite = null;
    stale = !snapshot.scheduler_healthy;
    render();
  }
  async function sendPending() {
    const p = pending;
    const epoch = generation;
    if (!p) return;
    try {
      const result = await api(p.name, p.args);
      if (epoch !== generation) return;
      pending = null;
      adopt(result);
      // Receipts are immutable and may contain an old snapshot.
      await read();
      say("Saved. Both crews’ progress stays on the server.");
    } catch (error) {
      if (
        [
          "ROBOT_REQUIRED",
          "LEGACY_DEPOSIT",
          "ROBOT_BUSY",
          "ROBOT_ENERGY",
          "ROUTE_BLOCKED",
          "SENSOR_UNAVAILABLE",
          "STALE_TARGET",
          "CLASS_UNSUPPORTED",
          "CARGO_FULL",
          "CONFLICT",
          "NOT_READY",
          "NOT_AVAILABLE",
          "DEPOSIT_EMPTY",
          "INSPECTION_REQUIRED",
          "MATCH_INACTIVE",
          "LIMIT_REACHED",
          "SCHEDULER_UNAVAILABLE",
          "INVALID_REQUEST",
          "INVALID_FEEDSTOCK",
          "COMMAND_ID_REUSED",
          "AUTH_REQUIRED",
        ].includes(error.code)
      ) {
        pending = null;
        if (["CONFLICT", "STALE_TARGET", "DEPOSIT_EMPTY", "ROBOT_BUSY"].includes(error.code)) {
          await read();
          say(error.message);
          return;
        }
      }
      throw error;
    }
  }
  function mutate(name, args) {
    return work(async () => {
      if (pending) return;
      pending = { name, args: { ...args, command_id: crypto.randomUUID() } };
      await sendPending();
      await list(true);
    });
  }
  function action(name, target = {}) {
    return work(async () => {
      if (pending || !snapshot) return;
      await read();
      if (stale) return;
      pending = {
        name: "command",
        args: {
          match_id: snapshot.match_id,
          expected_revision: snapshot.revision,
          action: name,
          ...target,
          command_id: crypto.randomUUID(),
        },
      };
      await sendPending();
    });
  }
  async function open(id) {
    if (pending) {
      say("Resolve the pending command before switching matches.");
      return;
    }
    const epoch = generation;
    const result = await api("read_match", { match_id: id });
    if (epoch !== generation) return;
    selection = null;
    adopt(result);
    await loadCatalog(epoch);
    if (epoch !== generation) return;
    render();
    say("Current match restored.");
  }
  async function list(reset, autoOpen = false) {
    const epoch = generation;
    const result = await api("list_matches", { cursor: reset ? null : cursor });
    if (epoch !== generation) return;
    const combined = reset ? result.matches : [...listed, ...result.matches];
    listed = [...new Map(combined.map((m) => [m.match_id, m])).values()].sort(
      (a, b) => b.created_at_ms - a.created_at_ms,
    );
    cursor = result.next_cursor;
    const container = el("match-list");
    container.replaceChildren();
    if (!listed.length)
      container.append(
        node("p", "No matches yet. Create a recovery session or join your partner.", "note"),
      );
    for (const match of listed) {
      const row = node("div", undefined, "match-row");
      row.append(
        node("span", `Crew ${match.slot} · ${match.status} · ${match.match_id.slice(0, 8)}`),
      );
      const b = node("button", "Open", "secondary");
      b.type = "button";
      b.setAttribute("aria-label", `Open match ${match.match_id}`);
      b.addEventListener("click", () => work(() => open(match.match_id)));
      row.append(b);
      container.append(row);
    }
    stale = false;
    if (autoOpen && listed.length)
      await open((listed.find((m) => m.status !== "completed") ?? listed[0]).match_id);
  }
  function renderMap() {
    const w = snapshot.world;
    const svg = el("dump-map");
    svg.replaceChildren();
    const make = (tag, attrs, text) => {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text) n.textContent = text;
      svg.append(n);
      return n;
    };
    for (const r of w.roads) make("rect", { ...r, class: "road" });
    for (const r of w.obstacles)
      make("rect", { x: r.x, y: r.y, width: r.width, height: r.height, class: "obstacle" });
    for (const o of w.outposts) {
      make("rect", {
        x: o.position.x - 2,
        y: o.position.y - 2,
        width: 4,
        height: 4,
        class: "outpost",
      });
      make(
        "text",
        { x: o.position.x, y: o.position.y + 4, class: "map-label", "text-anchor": "middle" },
        "OUTPOST",
      );
    }
    for (const t of w.towers) {
      const mine = snapshot.players.find((p) => p.you)?.slot === t.slot;
      make("rect", {
        x: t.position.x - 3,
        y: t.position.y - 3,
        width: 6,
        height: 6,
        class: mine ? "tower yours" : "tower",
      });
      make(
        "text",
        { x: t.position.x, y: t.position.y - 5, class: "map-label", "text-anchor": "middle" },
        mine ? "YOUR BASE" : t.occupied ? "RIVAL BASE" : "AWAITING CREW",
      );
    }
    for (const [i, robot] of snapshot.field.robots.entries()) {
      make("rect", {
        x: robot.position.x - 1,
        y: robot.position.y - 1,
        width: 2,
        height: 2,
        class: "parked-robot",
      });
      make(
        "text",
        { x: robot.position.x + 2, y: robot.position.y + 0.5, class: "map-label" },
        `R${i + 1}`,
      );
    }
    for (const job of snapshot.field.jobs.filter((j) => j.route.length)) {
      make("polyline", {
        points: job.route.map((p) => `${p.x},${p.y}`).join(" "),
        fill: "none",
        stroke: "#58ddb0",
        "stroke-width": 0.5,
      });
    }
    for (const d of w.deposits) {
      const mark = make("circle", {
        cx: d.position.x,
        cy: d.position.y,
        r: 2,
        class: `deposit ${d.depleted ? "depleted" : ""} ${d.id === selection ? "selected" : ""}`,
        role: "button",
        tabindex: 0,
        "aria-label": `${d.kind} deposit, crew ${d.home_slot}${d.depleted ? ", depleted" : ""}`,
      });
      const choose = () => {
        selection = d.id;
        el("deposit-choice").value = selection;
        renderMap();
        renderDeposit();
        renderRobots();
        controls();
      };
      mark.addEventListener("click", choose);
      mark.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
      make(
        "text",
        { x: d.position.x, y: d.position.y + 4, class: "map-label", "text-anchor": "middle" },
        d.kind.toUpperCase(),
      );
    }
  }
  function renderDeposit() {
    const d = snapshot.world.deposits.find((d) => d.id === selection);
    const area = el("deposit-detail");
    area.replaceChildren();
    if (!d) return;
    const own = snapshot.deposits.find((p) => p.id === d.id);
    area.append(node("h3", `${d.kind[0].toUpperCase() + d.kind.slice(1)} deposit`));
    if (!own || !snapshot.legacy_recovery) {
      area.append(
        node(
          "p",
          "Dispatch a robot below to survey this site, then collect and haul material to your inspection bench.",
        ),
      );
      return;
    }
    area.append(
      node(
        "p",
        own.collected
          ? "Depleted · material is in your inventory."
          : "A finite cable load at your starting bench. Inspect it, then recover it once.",
      ),
    );
    if (own.observation) {
      const o = own.observation;
      area.append(
        node(
          "p",
          `${kg(o.copper_g)} copper · ${kg(o.hdpe_g)} HDPE · ${kg(o.dirt_g)} dirt`,
          "assay",
        ),
      );
      area.append(
        node("p", "Bench assay · cable-assay-v1. Recovered output remains ungraded.", "note"),
      );
    } else
      area.append(node("p", "Composition unknown. Only your crew receives the assay.", "note"));
    const active = snapshot.status === "active";
    area.append(
      button(
        "Inspect cable",
        () => action("inspect_deposit", { deposit_id: d.id }),
        active && !own.collected && !own.observation,
      ),
    );
    area.append(
      button(
        "Collect cable",
        () => action("collect_deposit", { deposit_id: d.id }),
        active && !own.collected && !!own.observation,
        "",
      ),
    );
  }
  function renderRobots() {
    const area = el("robots");
    area.replaceChildren();
    const s = snapshot,
      target = s.world.deposits.find((d) => d.id === selection);
    for (const [i, r] of s.field.robots.entries()) {
      const job = s.field.jobs.find((j) => j.id === r.job_id);
      const busy = r.retired || (job && ["running", "paused"].includes(job.state));
      const row = node("div", undefined, "job");
      row.append(node("h3", `Robot ${i + 1}`));
      row.append(
        node(
          "p",
          `Position ${r.position.x}, ${r.position.y} · ${(r.energy_mj / 1000000).toFixed(2)} / 8 kJ · cargo ${kg(r.cargo.reduce((n, b) => n + b.mass_g, 0))} / 10 kg`,
        ),
      );
      row.append(
        node(
          "p",
          job
            ? `${job.action.replaceAll("_", " ")} · ${job.phase} · ${job.state}${job.reason ? ` · ${job.reason}` : ""} · ${(job.work_ms / 1000).toFixed(1)} s worked · ${job.route.length} route steps remaining`
            : "Ready for dispatch",
          "note",
        ),
      );
      const active = s.status === "active";
      if (target) {
        for (const sensor of r.sensors)
          row.append(
            button(
              `Survey with ${sensor} · robot ${i + 1}`,
              () => action("survey_robot", { robot_id: r.id, deposit_id: target.id, sensor }),
              active && !busy,
            ),
          );
        const observation = s.field.observations.filter((o) => o.target_id === target.id).at(-1);
        if (observation) {
          row.append(
            node(
              "p",
              `${observation.sensor} · ${observation.quality} · ${observation.cues.join("; ")} · evidence revision ${observation.target_revision}`,
              "note",
            ),
          );
          const current = observation.target_revision === target.revision;
          if (!current)
            row.append(node("p", "Deposit changed. Survey again before collecting.", "note"));
          for (const material_class of observation.candidate_classes)
            row.append(
              button(
                `Collect ${material_class} · robot ${i + 1}`,
                () =>
                  action("collect_robot", {
                    robot_id: r.id,
                    deposit_id: target.id,
                    observation_id: observation.id,
                    material_class,
                  }),
                active && !busy && current && !target.depleted,
              ),
            );
        }
      }
      for (const [cmd, label] of [
        ["return_robot", "Return and unload"],
        ["recharge_robot", "Return and recharge"],
        ["interrupt_robot", "Interrupt"],
        ["retreat_robot", "Retreat and unload"],
      ])
        row.append(
          button(
            `${label} · robot ${i + 1}`,
            () => action(cmd, { robot_id: r.id }),
            !r.retired &&
              active &&
              (cmd === "retreat_robot" || (cmd === "interrupt_robot" ? busy : !busy)),
          ),
        );
      area.append(row);
    }
  }
  async function loadCatalog(epoch) {
    if (!snapshot) return;
    if (!productionCatalog) {
      const production = await api("manufacturing_catalog", { match_id: snapshot.match_id });
      if (epoch === generation) productionCatalog = production.catalog;
    }
    if (scienceCatalog) return;
    const result = await api("science_catalog", { match_id: snapshot.match_id });
    if (epoch === generation) scienceCatalog = result.catalog;
  }
  function productionSelection() {
    return {
      recipe_id: el("production-recipe").value,
      ...Object.fromEntries(
        ["batches", "products", "components"].map((name, i) => [
          ["batch_ids", "product_ids", "component_ids"][i],
          [...el("production-" + name).selectedOptions].map((o) => o.value),
        ]),
      ),
    };
  }
  function clearProduction() {
    productionPreview = undefined;
    el("production-result").replaceChildren();
    el("enqueue-production").dataset.allowed = "false";
  }
  function renderProduction() {
    if (!snapshot || !productionCatalog) return;
    if (productionPreview && productionPreview.revision !== snapshot.revision) clearProduction();
    const update = (id, rows) => {
      const select = el(id),
        selected = new Set([...select.selectedOptions].map((o) => o.value)),
        signature = JSON.stringify(rows);
      if (select.dataset.options === signature) return;
      select.dataset.options = signature;
      select.replaceChildren();
      for (const [value, label] of rows) {
        const option = node("option", label);
        option.value = value;
        option.selected = selected.has(value);
        select.append(option);
      }
    };
    update(
      "production-recipe",
      productionCatalog.recipes.map((r) => [r.id, r.id.replaceAll("-", " ")]),
    );
    update(
      "production-batches",
      snapshot.batches
        .filter((b) => b.state === "available")
        .map((b) => {
          const e = snapshot.science.batches.find((e) => e.id === b.id)?.evidence;
          return [b.id, (e?.grade ?? "ungraded") + " · " + kg(b.mass_g) + " · " + b.id.slice(0, 8)];
        }),
    );
    const state = snapshot.manufacturing ?? {
      products: [],
      jobs: [],
      storage_used: 0,
      storage_slots: 16,
    };
    update(
      "production-products",
      state.products
        .filter((p) => p.state === "available")
        .map((p) => [p.id, p.kind + " · " + kg(p.mass_g) + " · " + p.id.slice(0, 8)]),
    );
    update(
      "production-components",
      snapshot.science.components
        .filter((c) => c.tested && c.condition === "sound")
        .map((c) => [c.id, c.quantity + " × " + c.kind + " · " + c.id.slice(0, 8)]),
    );
    el("production-storage").textContent =
      state.storage_used +
      " / " +
      state.storage_slots +
      " finished-part slots. Inputs stay reserved while queued or paused; spent energy is retained on cancellation.";
    const recipe = productionCatalog.recipes.find((r) => r.id === el("production-recipe").value);
    el("production-requirements").textContent = recipe
      ? "Requires " +
        recipe.station +
        "; " +
        recipe.materials
          .map((m) => m.mass_g + " g " + m.use)
          .concat(
            recipe.products.map((p) => p.quantity + " " + p.kind),
            recipe.components.map((c) => c.quantity + " tested " + c.kind),
          )
          .join(", ") +
        ". " +
        recipe.duration_ms / 1000 +
        " s at " +
        recipe.power_w +
        " W."
      : "";
    const jobs = el("production-jobs");
    jobs.replaceChildren();
    for (const j of state.jobs) {
      const row = node("div", undefined, "job");
      row.dataset.state = j.state;
      row.append(
        node("strong", j.recipe + " · " + j.state),
        node(
          "p",
          (j.reason ?? "") +
            " · " +
            j.work_ms / 1000 +
            " / " +
            j.duration_ms / 1000 +
            " s · " +
            j.energy_mj / 1000 +
            " J",
        ),
      );
      if (["waiting", "running", "paused"].includes(j.state)) {
        row.append(
          button(
            "Cancel production " + j.id.slice(0, 8),
            () => action("cancel_job", { job_id: j.id }),
            true,
          ),
        );
        row.append(
          button(
            (j.state === "paused" ? "Resume" : "Pause") + " production " + j.id.slice(0, 8),
            () => action(j.state === "paused" ? "resume_job" : "pause_job", { job_id: j.id }),
            true,
          ),
        );
      }
      jobs.append(row);
    }
    const outputs = el("production-products-list");
    outputs.replaceChildren();
    for (const p of state.products.filter((p) => p.state !== "consumed")) {
      const row = node("div", undefined, "batch");
      row.append(
        node("strong", p.kind + " · " + p.state),
        node(
          "p",
          kg(p.mass_g) +
            " recovered stock; " +
            p.components.map((c) => c.quantity + " " + c.kind).join(", "),
        ),
      );
      if (p.state === "installed") {
        if (["machine", "upgrade"].includes(p.category))
          row.append(
            button(
              (p.enabled ? "Disable " : "Enable ") + p.kind,
              () => action("set_production_machine", { machine_id: p.id, enabled: !p.enabled }),
              true,
            ),
          );
        row.append(
          button(
            "Destroy " + p.kind,
            () => action("destroy_manufactured_product", { product_id: p.id }),
            true,
          ),
        );
      }
      if (p.state === "available")
        row.append(
          button(
            "Discard " + p.kind,
            () => action("destroy_manufactured_product", { product_id: p.id }),
            true,
          ),
        );
      outputs.append(row);
    }
  }
  for (const id of [
    "production-recipe",
    "production-batches",
    "production-products",
    "production-components",
  ])
    el(id).addEventListener("change", () => {
      clearProduction();
      renderProduction();
    });
  el("preview-production").addEventListener("click", () =>
    work(async () => {
      if (!snapshot) return;
      const epoch = generation,
        match = snapshot.match_id,
        selection = productionSelection(),
        result = await api("manufacturing_preview", { match_id: match, ...selection });
      if (
        epoch !== generation ||
        snapshot?.match_id !== match ||
        JSON.stringify(selection) !== JSON.stringify(productionSelection())
      )
        return;
      productionPreview = { revision: result.revision, selection };
      el("production-result").textContent =
        result.result.message + " Next: " + result.result.next_actions.join(", ");
      el("enqueue-production").dataset.allowed = String(result.result.status === "eligible");
    }),
  );
  el("enqueue-production").addEventListener("click", () => {
    if (productionPreview) void action("enqueue_manufacturing", productionPreview.selection);
  });
  function clearEvaluation() {
    evaluation = undefined;
    el("science-result").replaceChildren();
    el("start-material-process").dataset.allowed = "false";
  }
  function scienceSelection() {
    return {
      target_id: el("science-target").value,
      query: el("science-query").value,
      design_id: el("science-design").value,
      temperature_c: Number(el("science-temperature").value),
    };
  }
  function renderScience() {
    const s = snapshot;
    if (evaluation && (evaluation.match !== s.match_id || evaluation.revision !== s.revision))
      clearEvaluation();
    el("science-version").textContent =
      `${s.science.versions.catalog} · ${s.science.versions.recipes} · ${s.science.versions.sensors} · ${s.science.observations.length} saved observations`;
    const updateOptions = (id, rows) => {
      const select = el(id),
        previous = select.value;
      const signature = JSON.stringify(rows);
      if (select.dataset.options === signature) return;
      select.dataset.options = signature;
      select.replaceChildren();
      for (const [value, label] of rows) {
        const option = node("option", label);
        option.value = value;
        select.append(option);
      }
      if (rows.some(([v]) => v === previous)) select.value = previous;
    };
    const query = el("science-query").value;
    updateOptions(
      "science-target",
      query === "component"
        ? s.science.components.map((c) => [c.id, `${c.kind} · ${c.quantity} items`])
        : s.batches
            .filter((b) => b.state !== "consumed")
            .map((b) => [
              b.id,
              `${b.output_role ?? b.form} · ${kg(b.mass_g)} · ${b.id.slice(0, 8)}`,
            ]),
    );
    if (scienceCatalog) {
      const designs =
        query === "component"
          ? [{ id: "starter-maintenance-v1" }]
          : query === "process"
            ? scienceCatalog.recipes
            : query === "substitution"
              ? scienceCatalog.substitutions
              : scienceCatalog.parts;
      updateOptions(
        "science-design",
        designs.map((d) => [d.id, d.id.replaceAll("-", " ")]),
      );
      const list = el("science-catalog");
      if (!list.childElementCount)
        for (const [key, material] of Object.entries(scienceCatalog.materials)) {
          const recipes = scienceCatalog.recipes.filter((r) => r.target === key);
          list.append(
            node(
              "p",
              `${material.name}: ${material.uses.join(", ")}. ${recipes.map((r) => `${r.id}: ${r.machine}, ${r.powerW} W${r.minimumTemperatureC === null ? "" : `, at least ${r.minimumTemperatureC} °C`}`).join("; ")}.`,
            ),
          );
        }
    }
    el("evaluate-material").dataset.allowed = String(
      !!scienceCatalog && !!el("science-target").value,
    );
    const stock = el("science-components");
    stock.replaceChildren();
    const ready =
      s.status === "active" &&
      s.machines[0].status === "ready" &&
      !s.jobs.some((j) => ["running", "paused"].includes(j.state)) &&
      !s.manufacturing?.jobs.some((j) => ["waiting", "running", "paused"].includes(j.state));
    for (const c of s.science.components) {
      const row = node("div", undefined, "batch");
      row.append(
        node(
          "p",
          `${c.quantity} × ${c.kind} · ${c.tested ? c.condition : "untested"} · existing stock allocation`,
        ),
      );
      row.append(
        button(
          `Test ${c.kind} · 3 s / 300 J`,
          () => action("inspect_component", { component_id: c.id }),
          ready && !c.tested,
        ),
      );
      stock.append(row);
    }
  }
  function render() {
    if (interacting) {
      renderDeferred = true;
      return;
    }
    if (!snapshot) {
      el("match-view").hidden = true;
      return;
    }
    el("match-view").hidden = false;
    const focused = document.activeElement;
    const focusLabel = focused?.getAttribute("aria-label");
    const focusText = focused?.tagName === "BUTTON" ? focused.textContent : null;
    const s = snapshot,
      slot = s.players.find((p) => p.you).slot;
    el("match-heading").textContent =
      `Crew ${slot} / ${s.status === "waiting" ? "Waiting for your partner" : s.status === "completed" ? "Session complete" : "Municipal dump"}`;
    el("match-id").textContent = s.match_id;
    el("revision").textContent = `Revision ${s.revision} · ${s.world.versions.map}`;
    el("match-status").textContent = s.status.toUpperCase();
    el("lifecycle-note").textContent =
      s.status === "waiting"
        ? "Share the invitation with one other player. Work begins when they join."
        : s.status === "completed"
          ? `Ended: ${s.completion.reason.replaceAll("-", " ")}. Your material and history remain saved. No combat result is recorded.`
          : "Survey, recover, haul and inspect scrap with your robots. Make parts and construct equipment from inspected material. Combat remains in development.";
    el("invitation").hidden = s.status !== "waiting" || slot !== 1;
    el("invite-match").value = s.match_id;
    el("invite-code").value = invite?.id === s.match_id ? invite.code : "";
    el("invite-expiry").textContent = s.invite_expires_at_ms
      ? `Expires ${new Date(s.invite_expires_at_ms).toLocaleTimeString()}. Renewing invalidates the previous code.`
      : "";
    el("rotate-invite").dataset.allowed = String(s.status === "waiting" && slot === 1);
    el("end-session").dataset.allowed = String(s.status !== "completed");
    el("finish-recovery").dataset.allowed = String(
      s.status === "active" &&
        !s.base.ready_to_finish &&
        s.jobs.some((j) => j.state === "completed" && !j.recipe.startsWith("inspect-")) &&
        !s.field.robots.some((r) => r.job_id || r.cargo.length) &&
        !s.jobs.some((j) => ["running", "paused"].includes(j.state)),
    );
    el("finish-recovery").textContent = s.base.ready_to_finish
      ? "Waiting for partner to finish"
      : "Finish recovery session";
    el("power-reading").textContent = `${(s.machines[0].energy_mj / 1000000).toFixed(1)} / 20 kJ`;
    el("power-note").textContent =
      `Solar 100 W · separator 500 W · ${(s.base.power.generated_mj / 1000000).toFixed(1)} kJ generated`;
    const options = el("deposit-choice");
    if (options.dataset.match !== s.match_id) {
      options.replaceChildren();
      options.dataset.match = s.match_id;
      for (const d of s.world.deposits) {
        const o = node("option", `Crew ${d.home_slot} · ${d.kind}`);
        o.value = d.id;
        options.append(o);
      }
    }
    selection ??= s.deposits[0].id;
    options.value = selection;
    renderMap();
    renderDeposit();
    const jobs = el("jobs");
    jobs.replaceChildren();
    if (!s.jobs.length)
      jobs.append(
        node("p", "No processing jobs yet. Collect an inspected cable batch to begin.", "note"),
      );
    for (const job of s.jobs) {
      const row = node("div", undefined, "job");
      row.dataset.state = job.state;
      row.append(node("strong", `${job.recipe.replaceAll("-", " ")} · ${job.state}`));
      const progress = node("progress");
      progress.max = job.duration_ms;
      progress.value = job.work_ms;
      progress.setAttribute("aria-label", `${job.recipe.replaceAll("-", " ")} progress`);
      row.append(progress);
      row.append(
        node(
          "p",
          `${(job.work_ms / 1000).toFixed(1)} / ${job.duration_ms / 1000} s · ${(job.energy_mj / 1000000).toFixed(2)} kJ spent${job.pause_reason ? ` · ${job.pause_reason}` : ""}`,
          "note",
        ),
      );
      if (["running", "paused"].includes(job.state)) {
        row.append(
          button(job.state === "paused" ? "Resume processing" : "Pause processing", () =>
            action(job.state === "paused" ? "resume_job" : "pause_job", { job_id: job.id }),
          ),
        );
        row.append(button("Cancel processing", () => action("cancel_job", { job_id: job.id })));
      }
      jobs.append(row);
    }
    const batches = el("batches");
    batches.replaceChildren();
    if (!s.batches.length)
      batches.append(node("p", "Your recovered material will appear here.", "note"));
    for (const batch of s.batches.filter((b) => b.state !== "consumed")) {
      const evidence = s.science.batches.find((b) => b.id === batch.id)?.evidence;
      const row = node("div", undefined, "batch");
      row.append(
        node("strong", `${batch.output_role ?? `Recovered ${batch.form}`} · ${kg(batch.mass_g)}`),
      );
      row.append(
        node(
          "p",
          `${batch.state} · ${evidence?.grade ?? batch.grade}\n${evidence?.inspection === "graded" ? evidence.constituents.map((c) => `${c.material} ${kg(c.massG)}`).join(" / ") : "Composition unknown; bench inspection required."}`,
          "note",
        ),
      );
      if (evidence?.inspection === "graded") {
        row.append(
          node("p", `Bench grade: ${evidence.grade ?? "unknown"} · ${evidence.condition}`, "note"),
        );
        for (const property of evidence.properties)
          row.append(
            node(
              "p",
              `${property.kind}: ${property.uncertainty ? `${property.uncertainty.lower}–${property.uncertainty.upper}` : "uncertainty unknown"} ${property.unit}, ${property.validFromC}–${property.validToC} °C · ${property.source} (game measurement fixture)`,
              "note",
            ),
          );
      }
      if (evidence?.inspection === "graded" && evidence.hazard !== "none-detected")
        row.append(
          node(
            "p",
            "Suspect battery/electronic material: use the matching isolation route; ordinary processing is refused.",
            "note",
          ),
        );
      if (batch.form !== "cable")
        row.append(
          button(
            "Review recovery routes",
            () => {
              el("science-query").value = "process";
              clearEvaluation();
              renderScience();
              el("science-target").value = batch.id;
              el("science-design").focus();
            },
            batch.state === "available",
          ),
        );
      if (batch.form !== "cable" || batch.copper_g === null)
        row.append(
          button(
            `Inspect ${batch.output_role ?? "recovered batch"} · 3 s / 300 J`,
            () => action("inspect_batch", { batch_id: batch.id }),
            s.status === "active" &&
              batch.state === "available" &&
              evidence?.inspection !== "graded" &&
              s.machines[0].status === "ready" &&
              !s.jobs.some((j) => ["running", "paused"].includes(j.state)),
          ),
        );
      if (batch.form === "cable" && batch.copper_g !== null)
        row.append(
          button(
            "Process cable · 20 s / 10 kJ",
            () => action("start_processing", { batch_id: batch.id, machine_id: s.machines[0].id }),
            s.status === "active" &&
              batch.state === "available" &&
              s.machines[0].status === "ready" &&
              !s.jobs.some((j) => ["running", "paused"].includes(j.state)),
            "",
          ),
        );
      batches.append(row);
    }
    renderScience();
    renderProduction();
    renderRobots();
    const assets = el("assets");
    assets.replaceChildren();
    for (const a of s.base.assets) {
      const details = node("details");
      details.append(node("summary", `${a.label} · ${a.status}`));
      const ul = node("ul");
      for (const c of a.components)
        ul.append(node("li", `${c.quantity} × ${c.kind} (${kg(c.unit_mass_g)} each)`));
      details.append(ul);
      if (["solar", "robot", "fabricator"].includes(a.kind))
        details.append(
          button(
            `Dismantle ${a.label} for components`,
            () => action("salvage_starter_asset", { asset_id: a.id }),
            a.status !== "destroyed",
          ),
        );
      assets.append(details);
    }
    el("starter-stock").textContent = s.base.inventory
      .map((c) => `${c.quantity} × ${c.kind}`)
      .join(" · ");
    const starterMass = s.base.starter_ledger.reduce(
      (sum, c) => sum + c.quantity * c.unit_mass_g,
      0,
    );
    el("starter-total").textContent =
      `${s.base.starter_ledger.length} recorded allocations · ${kg(starterMass)} starter equipment and stock. Game balance masses; each component is allocated once.`;
    if (focused && !focused.isConnected) {
      const candidates = [...document.querySelectorAll("#match-view button, #dump-map [tabindex]")];
      const replacement = candidates.find((n) =>
        focusLabel
          ? n.getAttribute("aria-label") === focusLabel
          : focusText && n.textContent === focusText,
      );
      replacement?.focus({ preventScroll: true });
    }
    controls();
  }
  for (const id of ["science-query", "science-target", "science-design", "science-temperature"])
    el(id).addEventListener(id === "science-temperature" ? "input" : "change", () => {
      clearEvaluation();
      if (snapshot) renderScience();
      controls();
    });
  el("evaluate-material").addEventListener("click", () =>
    work(async () => {
      const selection = scienceSelection(),
        epoch = generation,
        match = snapshot.match_id;
      const result = await api("evaluate", { match_id: match, ...selection });
      if (
        epoch !== generation ||
        snapshot.match_id !== match ||
        JSON.stringify(selection) !== JSON.stringify(scienceSelection())
      )
        return;
      evaluation = { match, revision: result.revision, selection, result: result.result };
      const r = result.result,
        area = el("science-result");
      area.replaceChildren();
      area.append(
        node(
          "strong",
          r.status === "eligible" ? "Eligible under this game design" : `${r.status}: ${r.code}`,
        ),
      );
      if (r.message) area.append(node("p", r.message));
      if (r.kind === "process-plan")
        area.append(
          node(
            "p",
            `${r.durationMs / 1000} s · ${r.energyJ} J · ${r.outputs.map((o) => `${o.id}: ${o.massG} g`).join(", ")} · residue: ${r.residue.massG} g`,
          ),
        );
      if (r.kind === "substitution-plan")
        area.append(
          node(
            "p",
            `${r.areaMm2} mm² (${r.areaMultiplier.toFixed(2)} × baseline), ${r.requiredMassG} g, ${r.lossW.toFixed(3)} W loss. Required connector: ${r.requiredConnector}.`,
          ),
        );
      area.append(
        node("p", `Next: ${r.nextActions.map((a) => a.replaceAll("-", " ")).join("; ")}`, "note"),
      );
      el("start-material-process").dataset.allowed = String(
        r.kind === "process-plan" && snapshot.status === "active",
      );
    }),
  );
  el("start-material-process").addEventListener("click", () => {
    if (evaluation?.result.kind !== "process-plan") return;
    const chosen = evaluation.selection;
    void action("start_material_process", {
      batch_id: chosen.target_id,
      machine_id:
        snapshot.manufacturing?.products.find(
          (p) =>
            p.kind === scienceCatalog.recipes.find((r) => r.id === chosen.design_id)?.machine &&
            p.state === "installed" &&
            p.enabled,
        )?.id ?? snapshot.machines[0].id,
      recipe_id: chosen.design_id,
    });
  });
  el("create-recovery").addEventListener("click", () => mutate("create_match", {}));
  el("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void mutate("join_match", {
      match_id: el("join-match").value.trim(),
      invite_code: el("join-code").value.trim(),
    });
  });
  el("refresh-list").addEventListener("click", () => work(() => list(true)));
  el("more-matches").addEventListener("click", () => work(() => list(false)));
  el("refresh-match").addEventListener("click", () =>
    work(async () => {
      await read();
      say("Current state restored.");
    }),
  );
  el("retry-command").addEventListener("click", () => work(sendPending));
  el("rotate-invite").addEventListener("click", () => action("rotate_invite"));
  el("finish-recovery").addEventListener("click", () => action("finish_recovery"));
  el("end-session").addEventListener("click", () => {
    if (
      window.confirm(
        "End this session for both players? Active work will be cancelled; spent energy stays spent.",
      )
    )
      void action("abandon_match");
  });
  el("deposit-choice").addEventListener("change", () => {
    selection = el("deposit-choice").value;
    renderMap();
    renderDeposit();
    renderRobots();
    controls();
  });
  setInterval(() => {
    if (access && snapshot && !busy && !pending && !interacting) void work(read, true);
  }, 2000);
  return {
    async settleForSignOut() {
      // Stop new polls and queued gestures before the backend revokes this session.
      access = false;
      controls();
      while (busy) await new Promise((resolve) => idleWaiters.push(resolve));
    },
    setAccess(connected, authenticated) {
      const next = connected && authenticated;
      if (next === access && authenticated) return;
      const was = access;
      access = next;
      stale = !next || stale;
      el("recovery").hidden = !authenticated;
      if (!authenticated) {
        generation++;
        snapshot = undefined;
        productionCatalog = undefined;
        clearProduction();
        scienceCatalog = undefined;
        clearEvaluation();
        pending = undefined;
        invite = null;
        selection = null;
        listed = [];
        cursor = null;
        el("match-list").replaceChildren();
        for (const id of ["invite-code", "invite-match", "join-match", "join-code"])
          el(id).value = "";
        for (const id of [
          "science-catalog",
          "science-components",
          "science-version",
          "science-target",
          "science-design",
          "robots",
          "dump-map",
          "deposit-detail",
          "batches",
          "jobs",
          "assets",
          "starter-stock",
          "starter-total",
          "power-reading",
          "power-note",
          "match-id",
        ])
          el(id).replaceChildren();
        for (const id of ["science-target", "science-design"]) delete el(id).dataset.options;
        render();
        controls();
      } else if (next && !was) {
        say("Restoring your matches…");
        void work(async () => {
          if (snapshot) await read();
          else await list(true, true);
          say(
            pending
              ? "Retry the pending command before starting new work."
              : "Create a session, join a partner, or continue a saved match.",
          );
        });
      } else controls();
    },
  };
}
