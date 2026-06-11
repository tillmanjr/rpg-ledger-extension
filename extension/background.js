// The side panel is opened directly from the popup (within a user gesture)
// and via the context menu below. We do NOT open it from a message handler,
// because sidePanel.open() must run in a user-gesture context.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.contextMenus) {
    chrome.contextMenus.create({
      id: "open-side-panel",
      title: "Open RPG Ledger (side panel)",
      contexts: ["action"]
    });
  }
});

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "open-side-panel" && tab && tab.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
}
