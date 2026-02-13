// Content script - injected into every page to find and control video elements

// Guard against duplicate injection
if (window.__dualVideoSyncLoaded) {
  // Already loaded, skip
} else {
  window.__dualVideoSyncLoaded = true;

  function findMainVideo() {
    const videos = document.querySelectorAll("video");
    if (videos.length === 0) return null;

    // Return the largest video (most likely the main player)
    let main = null;
    let maxArea = 0;
    videos.forEach((v) => {
      const area = v.videoWidth * v.videoHeight || v.clientWidth * v.clientHeight;
      if (area > maxArea) {
        maxArea = area;
        main = v;
      }
    });
    return main || videos[0];
  }

  function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function safeSendMessage(msg) {
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage(msg).catch(() => {});
      }
    } catch (e) {
      // Extension context invalidated, ignore
    }
  }

  // Auto-register on load if video found
  setTimeout(() => {
    const video = findMainVideo();
    if (video) {
      safeSendMessage({ type: "REGISTER_TAB", hasVideo: true });
    }
  }, 2000);

  // Listen for commands from popup/background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCAN_FOR_VIDEO") {
      const video = findMainVideo();
      sendResponse({
        hasVideo: !!video,
        url: window.location.href,
        title: document.title
      });
      return true;
    }

    if (msg.type === "GET_VIDEO_STATE") {
      const video = findMainVideo();
      if (!video) {
        sendResponse({ error: "No video found" });
        return true;
      }
      sendResponse({
        currentTime: video.currentTime,
        duration: video.duration,
        paused: video.paused,
        playbackRate: video.playbackRate,
        formattedTime: formatTime(video.currentTime),
        formattedDuration: formatTime(video.duration)
      });
      return true;
    }

    if (msg.type === "VIDEO_COMMAND") {
      const video = findMainVideo();
      if (!video) {
        sendResponse({ error: "No video found" });
        return true;
      }

      switch (msg.command) {
        case "play":
          video.play();
          break;
        case "pause":
          video.pause();
          break;
        case "toggle":
          video.paused ? video.play() : video.pause();
          break;
        case "seek":
          video.currentTime = msg.value;
          break;
        case "nudge":
          video.currentTime += msg.value;
          break;
        case "setRate":
          video.playbackRate = msg.value;
          break;
      }

      sendResponse({
        ok: true,
        currentTime: video.currentTime,
        paused: video.paused
      });
      return true;
    }
  });
}
