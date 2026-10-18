const retryableAdmission = "LIMIT_REACHED";

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function installSpatialSync(request) {
  const state = document.getElementById("game-state");
  const matchId = document.getElementById("match-id");
  const revision = document.getElementById("revision");
  if (!state || !matchId || !revision) return;

  let scheduled = false;
  let running = false;
  let lastKey = "";

  async function readSnapshot(id) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        return await request("/api/runtime", {
          method: "POST",
          body: JSON.stringify({
            name: "astra.game_read_match",
            args: { version: 5, match_id: id },
          }),
        });
      } catch (error) {
        if (error.code !== retryableAdmission) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return undefined;
  }

  async function refreshSpatial() {
    scheduled = false;
    if (running || state.textContent !== "LIVE") return;
    const id = matchId.textContent?.trim() ?? "";
    if (!isUuid(id)) return;
    const key = `${id}/${revision.textContent ?? ""}`;
    if (key === lastKey) return;
    running = true;
    try {
      const result = await readSnapshot(id);
      if (!result?.snapshot) return;
      lastKey = key;
      window.dispatchEvent(new CustomEvent("game-api-result", { detail: { result } }));
    } catch {
      // Spatial coverage is an optional read-only enhancement. Core reconnect/auth state owns failures.
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(refreshSpatial, 0);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(state, { childList: true, characterData: true, subtree: true });
  observer.observe(matchId, { childList: true, characterData: true, subtree: true });
  observer.observe(revision, { childList: true, characterData: true, subtree: true });
  schedule();
}
