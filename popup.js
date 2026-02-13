// Popup script - UI logic for the sync controller

let offset = 0;
let pollInterval = null;
let tabAId = null;
let tabBId = null;

// Cache: tabId -> frameId that contains the video
let videoFrames = {};

const $ = (id) => document.getElementById(id);

// --- Tab scanning ---

async function scanTabs() {
  const tabs = await chrome.tabs.query({});
  const videoTabs = [];
  videoFrames = {};

  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith("chrome") || tab.url.startsWith("about") || tab.url.startsWith("edge")) continue;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content.js"]
      });
    } catch (e) {
      continue;
    }

    await new Promise(r => setTimeout(r, 300));

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const videos = document.querySelectorAll("video");
          return videos.length > 0;
        }
      });

      for (const r of results) {
        if (r.result === true) {
          videoFrames[tab.id] = r.frameId;
          videoTabs.push({
            id: tab.id,
            title: tab.title,
            url: tab.url
          });
          break; // one video per tab is enough
        }
      }
    } catch (e) {
      // Skip
    }
  }

  console.log("[DualSync] Video frames:", videoFrames);
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

// --- Video commands via executeScript ---

function videoFunc() {
  // This function runs in the page context
  // It receives args via the IIFE wrapper below
  const videos = document.querySelectorAll("video");
  if (videos.length === 0) return { error: "No video found" };

  let video = null;
  let maxArea = 0;
  videos.forEach(v => {
    const area = v.videoWidth * v.videoHeight || v.clientWidth * v.clientHeight;
    if (area > maxArea) { maxArea = area; video = v; }
  });
  video = video || videos[0];
  return video ? true : null;
}

async function runOnVideo(tabId, fn, args = []) {
  if (!tabId) return null;
  const tid = parseInt(tabId);
  const frameId = videoFrames[tid];

  // If we don't have a cached frameId, try all frames
  const target = frameId !== undefined
    ? { tabId: tid, frameIds: [frameId] }
    : { tabId: tid, allFrames: true };

  try {
    const results = await chrome.scripting.executeScript({
      target,
      func: fn,
      args
    });

    // If targeting all frames, find the one that didn't error
    if (results.length > 1) {
      for (const r of results) {
        if (r.result && !r.result.error) {
          videoFrames[tid] = r.frameId; // cache it
          return r.result;
        }
      }
    }
    return results?.[0]?.result;
  } catch (e) {
    console.log("[DualSync] runOnVideo error:", e);
    return null;
  }
}

async function getState(tabId) {
  return runOnVideo(tabId, () => {
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
  });
}

async function sendCommand(tabId, command, value) {
  return runOnVideo(tabId, (cmd, val) => {
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
  }, [command, value ?? null]);
}

// --- Polling ---

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(updateDisplay, 750);
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
  console.log("[DualSync] Pause clicked. TabA:", $("tabA").value, "TabB:", $("tabB").value);
  console.log("[DualSync] Cached frames:", JSON.stringify(videoFrames));
  const rA = await sendCommand($("tabA").value, "pause");
  console.log("[DualSync] Pause A result:", JSON.stringify(rA));
  const rB = await sendCommand($("tabB").value, "pause");
  console.log("[DualSync] Pause B result:", JSON.stringify(rB));
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
