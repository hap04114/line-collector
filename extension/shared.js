// Shared by the popup and the service worker.
export const DEFAULT_API = "http://localhost:8787";

export async function apiBase() {
  const { api } = await chrome.storage.sync.get("api");
  return (api || DEFAULT_API).replace(/\/$/, "");
}

export async function fetchStatus() {
  const res = await fetch(`${await apiBase()}/api/lines/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const chaosColor = (c) => (c >= 60 ? "#ff5a5f" : c >= 30 ? "#ffb020" : "#3ddc97");
