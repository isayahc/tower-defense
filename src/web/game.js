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
  let stale = true;
  let snapshot;
  let pending;
  let selection;
  let cursor = null;
  let generation = 0;
  let listed = [];
  let invite = null;
  const api = (name, args) =>
    request("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ name: `astra.game_${name}`, args: { version: 3, ...args } }),
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
  async function work(fn) {
    if (!access || busy) return;
    busy = true;
    controls();
    const epoch = generation;
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
          "CONFLICT",
          "NOT_READY",
          "NOT_AVAILABLE",
          "DEPOSIT_EMPTY",
          "INSPECTION_REQUIRED",
          "MATCH_INACTIVE",
          "LIMIT_REACHED",
          "SCHEDULER_UNAVAILABLE",
          "INVALID_REQUEST",
          "COMMAND_ID_REUSED",
          "AUTH_REQUIRED",
        ].includes(error.code)
      ) {
        pending = null;
        if (error.code === "CONFLICT") {
          await read();
          say("The match changed. Review the updated state and choose the action again.");
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
    for (const [i, robot] of snapshot.base.assets.filter((a) => a.kind === "robot").entries()) {
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
    if (!own) {
      area.append(
        node(
          "p",
          "Contents remain undiscovered. This site is reserved for future robot survey and hauling jobs.",
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
  function render() {
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
          : "Recover and process your starter cable. Other waste sites, parked robots and fabricators are reserved for the next stages.";
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
        s.jobs.some((j) => j.state === "completed") &&
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
      row.append(node("strong", `Cable separation · ${job.state}`));
      const progress = node("progress");
      progress.max = job.duration_ms;
      progress.value = job.work_ms;
      progress.setAttribute("aria-label", "Cable separation progress");
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
      const row = node("div", undefined, "batch");
      row.append(
        node(
          "strong",
          `${batch.output_role ?? "Cable feedstock"} · ${kg(batch.copper_g + batch.hdpe_g + batch.dirt_g)}`,
        ),
      );
      row.append(
        node(
          "p",
          `${batch.state} · ${batch.grade}\nCu ${kg(batch.copper_g)} / HDPE ${kg(batch.hdpe_g)} / dirt ${kg(batch.dirt_g)}`,
          "note",
        ),
      );
      if (batch.form === "cable")
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
    const assets = el("assets");
    assets.replaceChildren();
    for (const a of s.base.assets) {
      const details = node("details");
      details.append(node("summary", `${a.label} · ${a.status}`));
      const ul = node("ul");
      for (const c of a.components)
        ul.append(node("li", `${c.quantity} × ${c.kind} (${kg(c.unit_mass_g)} each)`));
      details.append(ul);
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
      `${s.base.starter_ledger.length} recorded allocations · ${kg(starterMass)} starter equipment and stock. Game balance masses; no manufacturing or material certification yet.`;
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
    controls();
  });
  setInterval(() => {
    if (access && snapshot && !busy && !pending) void work(read);
  }, 2000);
  return {
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
        pending = undefined;
        invite = null;
        selection = null;
        listed = [];
        cursor = null;
        el("match-list").replaceChildren();
        for (const id of ["invite-code", "invite-match", "join-match", "join-code"])
          el(id).value = "";
        for (const id of [
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
