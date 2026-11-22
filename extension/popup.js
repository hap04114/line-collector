import { apiBase, chaosColor, fetchStatus } from "./shared.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function render() {
  const base = await apiBase();
  $("api").value = base;
  $("open").href = base;
  if (location.hash === "#options") $("options").open = true;
  try {
    const { lines, updatedAt } = await fetchStatus();
    $("updated").textContent = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    $("lines").innerHTML = lines
      .sort((a, b) => b.chaos - a.chaos)
      .map(
        (l) => `<li>
          <div class="row"><span class="pill" style="background:${esc(l.color)}">${esc(l.name.replace("Green ", "G"))}</span>
          <span class="grow">${esc(l.name)}${l.shuttle ? " · 🚌 shuttle" : ""}</span>
          <span class="score" style="color:${chaosColor(l.chaos)}">${l.chaos}</span></div>
          <div class="bar"><i style="width:${l.chaos}%;background:${chaosColor(l.chaos)}"></i></div>
          ${l.alerts.slice(0, 1).map((a) => `<div class="alert">⚠️ ${esc(a.header)}</div>`).join("")}
        </li>`,
      )
      .join("");
  } catch (e) {
    $("lines").innerHTML = `<li class="muted">Can't reach ${esc(base)} (${esc(e.message)}). Set the server below.</li>`;
  }
}

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ api: $("api").value.trim() });
  render();
});
render();
