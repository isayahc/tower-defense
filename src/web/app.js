import { createGame } from "/game.js";
const element = (id) => document.getElementById(id);
let connected = false;
let authenticated = false;
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || "The request failed. Please try again.");
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
const game = createGame(request);
window.addEventListener("game-auth-expired", () => {
  authenticated = false;
  accountView();
});
function accountView() {
  document.body.classList.toggle("is-signed-in", authenticated);
  game.setAccess(connected, authenticated);
  element("login-form").hidden = authenticated;
  element("signed-in").hidden = !authenticated;
  element("account-badge").textContent = authenticated ? "SIGNED IN" : "SIGNED OUT";
  element("account-badge").className = authenticated ? "badge ready" : "badge muted";
  for (const id of ["username", "password", "sign-in"]) element(id).disabled = !connected;
}
async function refresh() {
  element("retry").disabled = true;
  element("badge").textContent = "CHECKING";
  element("connection-title").textContent = "Checking the runtime…";
  element("connection-message").textContent = "Finding out what the server can support.";
  connected = false;
  accountView();
  try {
    const result = await request("/api/integration");
    connected = result.state === "partial" && result.canStartRecovery === true;
    element("connection-title").textContent = connected
      ? "Recovery runtime connected."
      : "The runtime is not ready.";
    element("connection-message").textContent = result.message;
    element("badge").textContent = connected ? "RECOVERY READY" : "NOT CONNECTED";
    element("badge").className = connected ? "badge ready" : "badge";
    document.querySelector(".connection").classList.toggle("connected", connected);
    element("capability-note").textContent = connected
      ? "A shared finite map, private recovery and persistent processing are ready."
      : "These features need a compatible, running server.";
    element("register-label").hidden = !connected || !result.registrationEnabled;
    if (element("register-label").hidden) element("register").checked = false;
    const session = await request("/api/session");
    authenticated = session.authenticated === true;
    element("account-message").textContent = authenticated
      ? "Your session is kept securely by the game backend."
      : connected
        ? "Sign in with an existing game account, or create one if registration is enabled."
        : "Connect the server to sign in.";
  } catch {
    element("connection-title").textContent = "Connection interrupted.";
    element("connection-message").textContent =
      "The game backend is unavailable. Check the connection and try again.";
    element("badge").textContent = "UNAVAILABLE";
    element("account-message").textContent = "Reconnect to check your session.";
    connected = false;
  } finally {
    element("retry").disabled = false;
    accountView();
  }
}
element("retry").addEventListener("click", refresh);
element("register").addEventListener("change", () => {
  element("sign-in").textContent = element("register").checked ? "Create account" : "Sign in";
  element("password").autocomplete = element("register").checked
    ? "new-password"
    : "current-password";
});
element("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  element("sign-in").disabled = true;
  element("account-message").textContent = "Connecting your account…";
  try {
    await request("/api/session", {
      method: "POST",
      body: JSON.stringify({
        mode: element("register").checked ? "register" : "login",
        username: element("username").value,
        password: element("password").value,
      }),
    });
    authenticated = true;
    element("account-message").textContent = "Your account is connected.";
  } catch (error) {
    element("account-message").textContent = error.message;
  } finally {
    element("password").value = "";
    accountView();
  }
});
element("sign-out").addEventListener("click", async () => {
  element("sign-out").disabled = true;
  try {
    await request("/api/session", { method: "DELETE" });
    authenticated = false;
    element("account-message").textContent = "Signed out.";
  } catch (error) {
    element("account-message").textContent = error.message;
  } finally {
    element("sign-out").disabled = false;
    accountView();
  }
});
void refresh();
