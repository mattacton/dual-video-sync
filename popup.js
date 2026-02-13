// Popup script - UI logic for the sync controller

// Sync point: when marked, records each video's time at the moment of sync
// syncPoint = { aTime: 120.5, bTime: 45.2 }
// means "A at 2:00.5 corresponds to B at 0:45.2"
// so expectedB = stateB - syncPoint.bTime should equal stateA - syncPoint.aTime
let syncPoint = null;
let pollInterval = null;

// Cache: tabId -> frameId that has the main video
let videoFrames = {};

const $ = (id) => document.getElementById(id);

function fmt(s) {
  if (isNaN(s)) return "00:00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

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
        videoTabs.push({ id: tab.id, title: tab.title, url: tab.url });
      }
    } catch (e) {}
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

// --- Core execution helper ---

async function runOnVideo(tabId, fn, args = []) {
  if (!tabId) return null;
  const tid = parseInt(tabId);
  const frameId = videoFrames[tid];

  const target = frameId !== undefined
    ? { tabId: tid, frameIds: [frameId] }
    : { tabId: tid, allFrames: true };

  try {
    const results = await chrome.scripting.executeScript({ target, func: fn, args });

    if (frameId !== undefined) {
      return results?.[0]?.result;
    }

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
    const f = (s) => {
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
      formattedTime: f(t),
      formattedDuration: f(d)
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
        pool.forEach(v => { try { v.pause(); } catch(e) {} });
        break;
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

  // Update Video A display
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

  // Update Video B display
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
  const statusEl = $("syncStatus");
  if (!syncPoint) {
    statusEl.className = "sync-status unset";
    statusEl.textContent = "Start both videos, then mark sync point";
    return;
  }

  if (stateA && stateB && !stateA.error && !stateB.error) {
    // How far A has progressed since sync point
    const aElapsed = stateA.currentTime - syncPoint.aTime;
    // How far B has progressed since sync point
    const bElapsed = stateB.currentTime - syncPoint.bTime;
    // Drift = difference in elapsed times
    const drift = bElapsed - aElapsed;
    const absDrift = Math.abs(drift);

    if (absDrift < 0.5) {
      statusEl.className = "sync-status synced";
      statusEl.textContent = `✓ In sync`;
    } else if (absDrift < 2) {
      const dir = drift > 0 ? "ahead" : "behind";
      statusEl.className = "sync-status drifting";
      statusEl.textContent = `⚠ B is ${absDrift.toFixed(1)}s ${dir}`;
    } else {
      const dir = drift > 0 ? "ahead" : "behind";
      statusEl.className = "sync-status off";
      statusEl.textContent = `✗ B is ${absDrift.toFixed(1)}s ${dir} — nudge or re-sync`;
    }
  }
}

// --- Sync point display ---

function updateSyncPointDisplay() {
  const info = $("syncPointInfo");
  if (!syncPoint) {
    info.innerHTML = "<div>No sync point set</div>";
    return;
  }
  info.innerHTML = `
    <div><span class="label">A was at</span> <span class="value">${fmt(syncPoint.aTime)}</span></div>
    <div><span class="label">B was at</span> <span class="value">${fmt(syncPoint.bTime)}</span></div>
  `;
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

// Mark as synced: snapshot both videos' current times
$("markSync").addEventListener("click", async () => {
  const stateA = await getState($("tabA").value);
  const stateB = await getState($("tabB").value);

  if (!stateA || stateA.error || !stateB || stateB.error) {
    $("syncStatus").className = "sync-status off";
    $("syncStatus").textContent = "Could not read both videos — make sure both are playing";
    return;
  }

  syncPoint = {
    aTime: stateA.currentTime,
    bTime: stateB.currentTime
  };

  updateSyncPointDisplay();
  console.log("[DualSync] Sync point set:", syncPoint);
});

// Nudge: physically seeks Video B forward or back
document.querySelectorAll("[data-nudge]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const nudge = parseFloat(btn.dataset.nudge);
    await sendCommand($("tabB").value, "nudge", nudge);

    // Update the sync point to reflect the nudge so drift stays accurate
    if (syncPoint) {
      syncPoint.bTime -= nudge; // if we nudged B forward, its reference point is effectively earlier
    }
    updateSyncPointDisplay();
  });
});

// Re-sync: seek B to where it should be based on A's current position
$("resync").addEventListener("click", async () => {
  if (!syncPoint) {
    $("syncStatus").textContent = "Set a sync point first";
    return;
  }

  const stateA = await getState($("tabA").value);
  if (!stateA || stateA.error) return;

  const aElapsed = stateA.currentTime - syncPoint.aTime;
  const targetBTime = syncPoint.bTime + aElapsed;

  await sendCommand($("tabB").value, "seek", targetBTime);
});

// Clear sync
$("clearSync").addEventListener("click", () => {
  syncPoint = null;
  updateSyncPointDisplay();
});

$("tabA").addEventListener("change", () => chrome.storage.local.set({ tabA: $("tabA").value }));
$("tabB").addEventListener("change", () => chrome.storage.local.set({ tabB: $("tabB").value }));

// --- Init ---

async function init() {
  await scanTabs();
  startPolling();
}

init();
