import { chaosColor, fetchStatus } from "./shared.js";

// Badge shows the worst line's Chaos Score; a notification fires when a new shutdown starts.
async function refresh() {
  try {
    const { lines } = await fetchStatus();
    const worst = lines.reduce((a, b) => (b.chaos > a.chaos ? b : a), lines[0]);
    await chrome.action.setBadgeText({ text: worst ? String(worst.chaos) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: chaosColor(worst?.chaos ?? 0) });
    await chrome.action.setTitle({ title: worst ? `Worst line: ${worst.name} (chaos ${worst.chaos})` : "T Chaos" });

    const shut = lines.filter((l) => l.shuttle).map((l) => l.routeId);
    const { known = [] } = await chrome.storage.local.get("known");
    const fresh = shut.filter((r) => !known.includes(r));
    for (const r of fresh) {
      const l = lines.find((x) => x.routeId === r);
      chrome.notifications.create(`shutdown-${r}-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/128.png",
        title: `${l.name}: shuttle or shutdown`,
        message: `${l.alerts[0]?.header ?? "Service disruption"} · Stops on this line are worth x1.5 in Charlie on the MTA.`,
      });
    }
    await chrome.storage.local.set({ known: shut });
  } catch {
    await chrome.action.setBadgeText({ text: "?" });
    await chrome.action.setBadgeBackgroundColor({ color: "#777" });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refresh", { periodInMinutes: 2 });
  refresh();
});
chrome.runtime.onStartup.addListener(refresh);
chrome.alarms.onAlarm.addListener((a) => a.name === "refresh" && refresh());
