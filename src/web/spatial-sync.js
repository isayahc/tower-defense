export function publishSpatialSnapshot(result) {
  if (!result?.snapshot) return;
  setTimeout(
    () => window.dispatchEvent(new CustomEvent("game-api-result", { detail: { result } })),
    0,
  );
}
