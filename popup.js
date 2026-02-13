// Popup script - UI logic for the sync controller

let offset = 0;
let pollInterval = null;

// Cache: tabId -> frameId that has the main video
let videoFrames = {};

const $ = (id) => document.getElementById(id);

// Shared function source that finds the main video in a page
// Used by both scan and commands - must be self-contained for executeScript
const FIND_VIDEO_SRC = `
  const videos = Array.from(document.querySelectorAll("video"));
  if (videos.length === 0) return null;
  // Filter to videos that have actual dimensions and a source
  const candidates = videos.filter(v => {
    const w = v.videoWidth || v.clientWidth || v.offsetWidth;
    const h = v.videoHeight || v.clientHeight || v.offsetHeight;
    return w > 50 && h > 50;
  });
  const pool = candidates.length > 0 ? candidates : videos;
  let best = null;
  let maxArea = 0;
  for (const v of pool) {
    const area = (v.videoWidth || v.clientWidth || 0) * (v.videoHeight || v.clientHeight || 0);
    if (area > maxArea || (area === maxArea && !v.paused)) {
      maxArea = area;
      best = v;
    }
  }
  best = best || pool[0];
`;

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

    await new Promise(r => setTimeout(r, 500));

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const videos = Array.from(document.querySelectorAll("video"));
          const valid = videos.filter(v => {
            const w = v.videoWidth || v.clientWidth || v.offsetWidth;
            const h = v.videoHeight || v.clientHeight || v.offsetHeight;
            return w > 50 && h > 50;
          });
          if (valid.length > 0) {
            const v = valid[0];
            return {
              hasVideo: true,
              playing: !v.paused,
              duration: v.duration,
              size: `${v.videoWidth}x${v.videoHeight}`
            };
          }
          return { hasVideo: false };
        }
      });

      // Pick the frame with the best video (prefer one that's playing, or has longest duration)
      let bestFrame = null;
      let bestScore = -1;
      for (const r of results) {
        if (r.result?.hasVideo) {
          const score = (r.result.playing ? 1000 : 0) + (r.result.duration || 0);
          if (score > bestScore) {
            bestScore = score;
            bestFrame = r;
          }
        }
      }

      if (bestFrame) {
        videoFrames[tab.id] = bestFrame.frameId;
        videoTabs.push({
          id: tab.id,
          title: tab.title,
          url: tab.url
        });
        console.log(`[DualSync] Tab ${tab.id} "${tab.title}" -> frame ${bestFrame.frameId}`, bestFrame.result);
      }
    } catch (e) {
      // Skip
    }
  }

  console.log("[DualSync] Video frames map:", JSON.stringify(videoFrames));
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

// --- Core execution helper ---

async function runOnVideo(tabId, fn, args = []) {
  if (!tabId) return null;
  const tid = parseInt(tabId);
  const frameId = videoFrames[tid];

  if (frameId === undefined) {
    console.log(`[DualSync] No cached frame for tab ${tid}, trying all frames`);
  }

  const target = frameId !== undefined
    ? { tabId: tid, frameIds: [frameId] }
    : { tabId: tid, allFrames: true };

  try {
    const results = await chrome.scripting.executeScript({
      target,
      func: fn,
      args
    });

    if (frameId !== undefined) {
      return results?.[0]?.result;
    }

    // Multiple frames - find the one with a valid result
    for (const r of results) {
      if (r.result && !r.result.error) {
        videoFrames[tid] = r.frameId;
        return r.result;
      }
    }
    return results?.[0]?.result;
  } catch (e) {
    console.log("[DualSync] runOnVideo error:", e);
    return null;
  }
}

// --- Get video state ---

async function getState(tabId) {
  return runOnVideo(tabId, () => {
    const videos = Array.from(document.querySelectorAll("video"));
    const valid = videos.filter(v => {
      const w = v.videoWidth || v.clientWidth || v.offsetWidth;
      const h = v.videoHeight || v.clientHeight || v.offsetHeight;
      return w > 50 && h > 50;
    });
    const pool = valid.length > 0 ? valid : videos;
    if (pool.length === 0) return { error: "No video found" };

    // Prefer the playing video, or the largest
    let video = pool.find(v => !v.paused);
    if (!video) {
      let maxArea = 0;
      for (const v of pool) {
        const area = (v.videoWidth || v.clientWidth || 0) * (v.videoHeight || v.clientHeight || 0);
        if (area > maxArea) { maxArea = area; video = v; }
      }
    }
    video = video || pool[0];

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

// --- Send command ---

async function sendCommand(tabId, command, value) {
  return runOnVideo(tabId, (cmd, val) => {
    const videos = Array.from(document.querySelectorAll("video"));
    const valid = videos.filter(v => {
      const w = v.videoWidth || v.clientWidth || v.offsetWidth;
      const h = v.videoHeight || v.clientHeight || v.offsetHeight;
      return w > 50 && h > 50;
    });
    const pool = valid.length > 0 ? valid : videos;
    if (pool.length === 0) return { error: "No video" };

    // Prefer the playing video for pause, or the largest for play
    let video = pool.find(v => !v.paused);
    if (!video) {
      let maxArea = 0;
      for (const v of pool) {
        const area = (v.videoWidth || v.clientWidth || 0) * (v.videoHeight || v.clientHeight || 0);
        if (area > maxArea) { maxArea = area; video = v; }
      }
    }
    video = video || pool[0];

    switch (cmd) {
      case "play": video.play(); break;
      case "pause":
        // Pause ALL videos in this frame to prevent ghost audio
        pool.forEach(v => { try { v.pause(); } catch(e) {} });
        break;
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
  const tabAId = $("tabA").value;
  const tabBId = $("tabB").value;

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

$("tabA").addEventListener("change", () => chrome.storage.local.set({ tabA: $("tabA").value }));
$("tabB").addEventListener("change", () => chrome.storage.local.set({ tabB: $("tabB").value }));

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
