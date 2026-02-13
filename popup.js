// Popup script - UI logic for the sync controller

let offset = 0; // seconds: B's time = A's time + offset
let pollInterval = null;
let tabAId = null;
let tabBId = null;

const $ = (id) => document.getElementById(id);

// --- Tab scanning ---

async function scanTabs() {
  // Get all tabs in the current window
  const tabs = await chrome.tabs.query({});
  const videoTabs = [];

  for (const tab of tabs) {
    // Skip chrome:// and extension pages
    if (!tab.url || tab.url.startsWith("chrome") || tab.url.startsWith("about")) continue;

    try {
      // Try injecting the content script first in case it hasn't loaded
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"]
      });
    } catch (e) {
      // Injection failed (restricted page), skip
      continue;
    }

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { type: "SCAN_FOR_VIDEO" }, (resp) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(resp);
        });
      });

      if (response?.hasVideo) {
        videoTabs.push({
          id: tab.id,
          title: tab.title,
          url: tab.url
        });
      }
    } catch (e) {
      // No response from tab
    }
  }

  populateDropdowns(videoTabs);
}

function truncate(str, len) {
  return str.length > len ? str.substring(0, len) + "..." : str;
}

function populateDropdowns(videoTabs) {
  const selA = $("tabA");
  const selB = $("tabB");

  const prevA = selA.value;
  const prevB = selB.value;

  selA.innerHTML = '<option value="">— Select tab —</option>';
  selB.innerHTML = '<option value="">— Select tab —</option>';

  videoTabs.forEach((t) => {
    const label = truncate(t.title, 45);
    const optA = new Option(label, t.id);
    const optB = new Option(label, t.id);
    selA.appendChild(optA);
    selB.appendChild(optB);
  });

  // Restore previous selections
  if (prevA) selA.value = prevA;
  if (prevB) selB.value = prevB;

  // Auto-assign if exactly 2 video tabs found and nothing selected
  if (videoTabs.length === 2 && !prevA && !prevB) {
    selA.value = videoTabs[0].id;
    selB.value = videoTabs[1].id;
  }
}

// --- Video commands ---

async function sendCommand(tabId, command, value) {
  if (!tabId) return null;
  try {
    // sendMessage to a tab goes to all frames; the one with a video will respond
    return await chrome.tabs.sendMessage(parseInt(tabId), {
      type: "VIDEO_COMMAND",
      command,
      value
    });
  } catch (e) {
    return null;
  }
}

async function getState(tabId) {
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(parseInt(tabId), {
      type: "GET_VIDEO_STATE"
    });
  } catch (e) {
    return null;
  }
}

// --- Polling for timecodes ---

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(updateDisplay, 500);
}

async function updateDisplay() {
  tabAId = $("tabA").value;
  tabBId = $("tabB").value;

  const stateA = await getState(tabAId);
  const stateB = await getState(tabBId);

  // Update Video A
  if (stateA && !stateA.error) {
    $("timeA").textContent = stateA.formattedTime;
    $("durationA").textContent = stateA.formattedDuration;
    $("dotA").className = "status-dot " + (stateA.paused ? "paused" : "playing");
    $("statusA").textContent = stateA.paused ? "Paused" : "Playing";
  } else {
    $("timeA").textContent = "--:--:--";
    $("dotA").className = "status-dot disconnected";
    $("statusA").textContent = tabAId ? "No video found" : "Not connected";
    $("durationA").textContent = "";
  }

  // Update Video B
  if (stateB && !stateB.error) {
    $("timeB").textContent = stateB.formattedTime;
    $("durationB").textContent = stateB.formattedDuration;
    $("dotB").className = "status-dot " + (stateB.paused ? "paused" : "playing");
    $("statusB").textContent = stateB.paused ? "Paused" : "Playing";
  } else {
    $("timeB").textContent = "--:--:--";
    $("dotB").className = "status-dot disconnected";
    $("statusB").textContent = tabBId ? "No video found" : "Not connected";
    $("durationB").textContent = "";
  }

  // Sync status
  if (stateA && stateB && !stateA.error && !stateB.error) {
    const expectedBTime = stateA.currentTime + offset;
    const drift = Math.abs(stateB.currentTime - expectedBTime);

    const statusEl = $("syncStatus");
    if (drift < 0.5) {
      statusEl.className = "sync-status synced";
      statusEl.textContent = `✓ In sync (drift: ${drift.toFixed(1)}s)`;
    } else if (drift < 2) {
      statusEl.className = "sync-status drifting";
      statusEl.textContent = `⚠ Slight drift: ${drift.toFixed(1)}s`;
    } else {
      statusEl.className = "sync-status off";
      statusEl.textContent = `✗ Out of sync: ${drift.toFixed(1)}s — click "Sync B to A"`;
    }
  }
}

// --- Controls ---

$("scanBtn").addEventListener("click", scanTabs);

$("playBoth").addEventListener("click", async () => {
  await sendCommand($("tabA").value, "play");
  await sendCommand($("tabB").value, "play");
});

$("pauseBoth").addEventListener("click", async () => {
  await sendCommand($("tabA").value, "pause");
  await sendCommand($("tabB").value, "pause");
});

$("syncNow").addEventListener("click", async () => {
  const stateA = await getState($("tabA").value);
  if (stateA && !stateA.error) {
    const targetBTime = stateA.currentTime + offset;
    await sendCommand($("tabB").value, "seek", targetBTime);
  }
});

$("resetOffset").addEventListener("click", () => {
  offset = 0;
  $("offsetValue").textContent = "0.0s";
});

// Nudge buttons
document.querySelectorAll("[data-nudge]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const nudge = parseFloat(btn.dataset.nudge);
    offset += nudge;
    $("offsetValue").textContent = (offset >= 0 ? "" : "") + offset.toFixed(1) + "s";
  });
});

// Save/restore selected tabs & offset
$("tabA").addEventListener("change", () => {
  chrome.storage.local.set({ tabA: $("tabA").value });
});
$("tabB").addEventListener("change", () => {
  chrome.storage.local.set({ tabB: $("tabB").value });
});

// --- Init ---

async function init() {
  // Restore offset
  const stored = await chrome.storage.local.get(["offset"]);
  if (stored.offset !== undefined) {
    offset = stored.offset;
    $("offsetValue").textContent = offset.toFixed(1) + "s";
  }

  await scanTabs();
  startPolling();
}

init();
