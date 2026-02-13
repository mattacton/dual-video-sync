// Background service worker - coordinates messages between popup and content scripts

let registeredTabs = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "REGISTER_TAB") {
    const tabId = sender.tab?.id;
    if (tabId) {
      registeredTabs[tabId] = {
        id: tabId,
        url: sender.tab.url,
        title: sender.tab.title,
        hasVideo: msg.hasVideo
      };
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "GET_REGISTERED_TABS") {
    sendResponse({ tabs: registeredTabs });
    return true;
  }

  if (msg.type === "VIDEO_COMMAND") {
    chrome.tabs.sendMessage(msg.tabId, {
      type: "VIDEO_COMMAND",
      command: msg.command,
      value: msg.value
    }, (response) => {
      sendResponse(response);
    });
    return true;
  }

  if (msg.type === "GET_VIDEO_STATE") {
    chrome.tabs.sendMessage(msg.tabId, { type: "GET_VIDEO_STATE" }, (response) => {
      sendResponse(response);
    });
    return true;
  }

  if (msg.type === "SCAN_TAB") {
    chrome.tabs.sendMessage(msg.tabId, { type: "SCAN_FOR_VIDEO" }, (response) => {
      if (response?.hasVideo) {
        registeredTabs[msg.tabId] = {
          id: msg.tabId,
          url: response.url,
          title: response.title,
          hasVideo: true
        };
      }
      sendResponse(response);
    });
    return true;
  }
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete registeredTabs[tabId];
});
