// Background service worker - handles keyboard shortcuts

// Helper: find the main video in a tab across all frames
async function getVideoState(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const videos = Array.from(document.querySelectorAll("video"));
        const valid = videos.filter(v => {
          const w = v.videoWidth || v.clientWidth || v.offsetWidth;
          const h = v.videoHeight || v.clientHeight || v.offsetHeight;
          return w > 50 && h > 50;
        });
        const pool = valid.length > 0 ? valid : videos;
        if (pool.length === 0) return null;

        let video = pool.find(v => !v.paused);
        if (!video) {
          let maxArea = 0;
          for (const v of pool) {
            const area = (v.videoWidth || v.clientWidth || 0) * (v.videoHeight || v.clientHeight || 0);
            if (area > maxArea) { maxArea = area; video = v; }
          }
        }
        video = video || pool[0];
        return { currentTime: video.currentTime, paused: video.paused };
      }
    });
    for (const r of results) {
      if (r.result) return { ...r.result, frameId: r.frameId };
    }
  } catch (e) {}
  return null;
}

async function sendVideoCommand(tabId, command, value) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (cmd, val) => {
        const videos = Array.from(document.querySelectorAll("video"));
        const valid = videos.filter(v => {
          const w = v.videoWidth || v.clientWidth || v.offsetWidth;
          const h = v.videoHeight || v.clientHeight || v.offsetHeight;
          return w > 50 && h > 50;
        });
        const pool = valid.length > 0 ? valid : videos;
        if (pool.length === 0) return null;

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
          case "toggle":
            if (video.paused) video.play();
            else pool.forEach(v => { try { v.pause(); } catch(e) {} });
            break;
          case "seek": video.currentTime = val; break;
        }
        return { ok: true, currentTime: video.currentTime, paused: video.paused };
      },
      args: [command, value ?? null]
    });
    for (const r of results) {
      if (r.result?.ok) return r.result;
    }
  } catch (e) {}
  return null;
}

async function getTabIds() {
  const stored = await chrome.storage.local.get(["tabA", "tabB"]);
  const tabA = stored.tabA ? parseInt(stored.tabA) : null;
  const tabB = stored.tabB ? parseInt(stored.tabB) : null;
  return { tabA, tabB };
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  const { tabA, tabB } = await getTabIds();
  if (!tabA || !tabB) return;

  if (command === "pause-both") {
    // Check if A is playing to decide toggle direction
    const stateA = await getVideoState(tabA);
    const cmd = stateA?.paused ? "play" : "pause";
    await sendVideoCommand(tabA, cmd);
    await sendVideoCommand(tabB, cmd);
  }

  if (command === "mark-sync") {
    const stateA = await getVideoState(tabA);
    const stateB = await getVideoState(tabB);
    if (stateA && stateB) {
      const syncPoint = { aTime: stateA.currentTime, bTime: stateB.currentTime };
      await chrome.storage.local.set({ syncPoint });
    }
  }

  if (command === "snap-back") {
    const stored = await chrome.storage.local.get(["syncPoint"]);
    if (!stored.syncPoint) return;

    const stateA = await getVideoState(tabA);
    if (!stateA) return;

    const aElapsed = stateA.currentTime - stored.syncPoint.aTime;
    const targetBTime = stored.syncPoint.bTime + aElapsed;
    await sendVideoCommand(tabB, "seek", targetBTime);
  }
});

// Clean up stale tab references
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.local.get(["tabA", "tabB"]);
  if (stored.tabA == tabId) chrome.storage.local.remove(["tabA"]);
  if (stored.tabB == tabId) chrome.storage.local.remove(["tabB"]);
});
