// Popup script - UI logic for the sync controller

let offset = 0;
let pollInterval = null;
let tabAId = null;
let tabBId = null;

const $ = (id) => document.getElementById(id);

// --- Tab scanning ---

async function scanTabs() {
  const tabs = await chrome.tabs.query({});
  const videoTabs = [];

  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith("chrome") || tab.url.startsWith("about")) continue;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"]
      });
    } catch (e) {
      continue;
    }

    await new Promise(r => setTimeout(r, 300));

    // Use executeScript to check for videos across all frames
    // This returns results from ALL frames, unlike sendMessage
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const videos = document.querySelectorAll("video");
          return videos.length > 0;
        }
      });

      const hasVideo = results.some(r => r.result === true);

      if (hasVideo) {
        videoTabs.push({
          id: tab.id,
          title: tab.title,
          url: tab.url
        });
      }
    } catch (e) {
      // Skip
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
    selA.appendChild(new Option(label, t.id));
    selB.appendChild(new Option(label, t.id));
  });

  if (prevA) selA.value = prevA;
  if (prevB) selB.value = prevB;

  if (videoTabs.length === 2 && !prevA && !prevB) {
    selA.value = videoTabs[0].id;
    selB.value = videoTabs[1].id;
  }
}

// --- Video commands ---
// Use executeScript for commands too, so we can target the right frame

async function findVideoFrameId(tabId) {
  // Find which frame has the video
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: parseInt(tabId), allFrames: true },
      func: () => {
        const videos = document.querySelectorAll("video");
        if (videos.length === 0) return null;
        let main = null;
        let maxArea = 0;
        videos.forEach(v => {
          const area = v.videoWidth * v.videoHeight || v.clientWidth * v.clientHeight;
          if (area > maxArea) { maxArea = area; main = v; }
        });
        return (main || videos[0]) ? true : null;
      }
    });
    // Return the frameId that has a video
    for (const r of results) {
      if (r.result === true) return r.frameId;
    }
  } catch (e) {}
  return 0; // default to main frame
}

async function sendCommand(tabId, command, value) {
  if (!tabId) return null;
  try {
    const frameId = await findVideoFrameId(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId: parseInt(tabId), frameIds: [frameId] },
      func: (cmd, val) => {
        const videos = document.querySelectorAll("video");
        if (videos.length === 0) return { error: "No video" };
        let video = null;
        let maxArea = 0;
        videos.forEach(v => {
          const area = v.videoWidth * v.videoHeight || v.clientWidth * v.clientHeight;
          if (area > maxArea) { maxArea = area; video = v; }
        });
        video = video || videos[0];

        switch (cmd) {
          case "play": video.play(); break;
          case "pause": video.pause(); break;
          case "toggle": video.paused ? video.play() : video.pause(); break;
          case "seek": video.currentTime = val; break;
          case "nudge": video.currentTime += val; break;
        }
        return { ok: true, currentTime: video.currentTime, paused: video.paused };
      },
      args: [command, value]
    });
    return results?.[0]?.result;
  } catch (e) {
    return null;
  }
}

async function getState(tabId) {
  if (!tabId) return null;
  try {
    const frameId = await findVideoFrameId(tabId);
    const results = await chrome.scripting.executeScript({
      target: { tabId: parseInt(tabId), frameIds: [frameId] },
      func: () => {
        const videos = document.querySelectorAll("video");
        if (videos.length === 0) return { error: "No video found" };
        let video = null;
        let maxArea = 0;
        videos.forEach(v => {
          const area = v.videoWidth * v.videoHeight || v.clientWidth * v.clientHeight;
          if (area > maxArea) { maxArea = area; video = v; }
        });
        video = video || videos[0];

        const t = video.currentTime;
        const d = video.duration;
        const fmt = (s) => {
          if (isNaN(s)) return "00:00:00";
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sec = Math.floor(s % 60);
          return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
        };

        return {
          currentTime: t,
          duration: d,
          paused: video.paused,
          formattedTime: fmt(t),
          formattedDuration: fmt(d)
        };
      }
    });
    return results?.[0]?.result;
  } catch (e) {
    return null;
  }
}

// --- Polling ---

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(updateDisplay, 500);
}

async function updateDisplay() {
  tabAId = $("tabA").value;
  tabBId = $("tabB").value;

  const stateA = await getState(tabAId);
  const stateB = await getState(tabBId);

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

document.querySelectorAll("[data-nudge]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const nudge = parseFloat(btn.dataset.nudge);
    offset += nudge;
    $("offsetValue").textContent = offset.toFixed(1) + "s";
  });
});

$("tabA").addEventListener("change", () => {
  chrome.storage.local.set({ tabA: $("tabA").value });
});
$("tabB").addEventListener("change", () => {
  chrome.storage.local.set({ tabB: $("tabB").value });
});

// --- Init ---

async function init() {
  const stored = await chrome.storage.local.get(["offset"]);
  if (stored.offset !== undefined) {
    offset = stored.offset;
    $("offsetValue").textContent = offset.toFixed(1) + "s";
  }
  await scanTabs();
  startPolling();
}

init();
