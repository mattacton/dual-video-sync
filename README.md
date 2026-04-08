# ⚡ Dual Video Sync

A Chrome extension that syncs two browser-based video players — perfect for watching reaction videos alongside the original show.

Built for watching Katee Sackhoff react to Battlestar Galactica on Patreon while streaming the show on Amazon Prime, but works with any two browser-based video players.

![543EC8DD-08B2-412B-9C39-710DEDBA3C79_1_105_c](https://github.com/user-attachments/assets/2a72c9c5-a8d8-4bda-8e9a-222cde03985b)


## What it does

- Detects video players across browser tabs (including embedded YouTube/Vimeo iframes)
- Play/pause both videos simultaneously
- Set a sync point to track drift between the two videos
- Nudge Video B forward or back in 0.1s, 0.5s, 1s, or 5s increments
- Snap Video B back to its synced position if it drifts
- Keyboard shortcuts for hands-free control

## Installation

1. **Download or clone this repo**

   ```
   git clone https://github.com/mattacton/dual-video-sync.git
   ```

   Or click **Code → Download ZIP** and extract it.

2. **Load into Chrome**

   - Open `chrome://extensions/` in Chrome
   - Enable **Developer mode** (toggle in the top right)
   - Click **Load unpacked**
   - Select the `dual-video-sync` folder

3. **Pin the extension** — click the puzzle piece icon in your toolbar and pin "Dual Video Sync" for easy access.

## Usage

### Dual Sync Window
<img width="423" height="599" alt="image" src="https://github.com/user-attachments/assets/a359d7b5-18f1-45de-9ec9-cab934b7b830" />
<img width="423" height="604" alt="image" src="https://github.com/user-attachments/assets/0f8a5c69-b113-4ee0-99c6-b002e87e8184" />




### Setup

1. Open the show in one browser tab (e.g., Amazon Prime Video)
2. Open the reaction video in another tab (e.g., a Patreon post with an embedded YouTube video)
3. Click the extension icon — it automatically scans for tabs with video players
4. Assign **Video A** (the show) and **Video B** (the reaction) from the dropdowns

### Syncing

1. Start the reaction video and let it play through any intro
2. When the reactor says "hit play" (or whenever they start watching), start the show
3. Use the **nudge buttons** to fine-tune alignment — the 0.1s buttons are great for getting audio perfectly matched
4. Once aligned, click **Mark as Synced Now** to lock in the sync point
5. The extension will now track drift and show you if B falls behind or gets ahead
6. If drift occurs, click **Snap B back to sync** to automatically re-align

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+P` | Toggle play/pause both videos |
| `Alt+Shift+S` | Mark as synced |
| `Alt+Shift+R` | Snap B back to sync |

Customize shortcuts at `chrome://extensions/shortcuts`.

## Compatibility

Works with any site that uses standard HTML5 `<video>` elements, including:

- ✅ Amazon Prime Video
- ✅ Patreon (embedded YouTube/Vimeo players)
- ✅ YouTube
- ✅ Most streaming sites that play in-browser

Does **not** work with:

- ❌ Desktop apps (Apple TV app, Netflix desktop app)
- ❌ DRM-protected players that don't expose a `<video>` element

## File Structure

```
dual-video-sync/
├── manifest.json          # Extension configuration
├── background.js          # Keyboard shortcut handling
├── content.js             # Injected into pages to find video elements
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic and sync controls
├── generate-icons.html    # Utility to generate extension icons
├── README.md
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Troubleshooting

**Scan doesn't find my video tab**
- Make sure the video is loaded (not just the page — click play at least once)
- Click **Scan Tabs** to manually re-scan
- Reload the video tab and try again

**Play/Pause buttons don't work**
- Some sites may override programmatic video control. Try using the site's own play button and the extension's sync/nudge features.

**Double audio on the reaction video**
- This can happen if the embedded player has multiple video elements. Pause both and restart.

**Sync point lost**
- The sync point persists when you close and reopen the popup. It's stored until you click **Clear Sync** or close the video tabs.

## License

MIT
