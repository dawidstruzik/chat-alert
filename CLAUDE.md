# ChatGPT Completion Notifier

Chrome extension that monitors ChatGPT tabs (popup dashboard + active-session badge) and sends notifications when AI response generation completes.

## Development

### Load Extension

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this folder
4. Open ChatGPT to test

### Test Changes

- Edit code → click refresh icon on extension card
- Check console: background page (click "service worker" link) or DevTools on ChatGPT tab
- Content script logs prefixed with `[ChatGPT Notifier]`

## Architecture

```
manifest.json     → Extension config (Manifest V3)
background.js     → Service worker: tab tracking, notifications, settings, badge
content.js        → DOM observer: detects generation state via Stop button
popup.html/js     → Settings UI (all config in popup)
offscreen.html/js → Audio playback (service workers can't play audio directly)
```

### State Machine

```
IDLE → GENERATING (Stop button appears)
     → THINKING (Pro: "Answer now" visible, no assistant text yet)
     → WRITING (assistant text growing)
     → COMPLETED (Stop button gone, text stable for 1.5s)
```

### Message Flow

1. `content.js` detects Stop button disappears
2. Waits for text stability (configurable delay)
3. Sends `GENERATION_COMPLETE` to background
4. `background.js` shows notification, plays sound, updates badge

## DOM Selectors (Jan 2025)

ChatGPT's DOM changes frequently. These selectors are verified working:

### Stop Button Detection

```javascript
Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Stop')
```

- No `data-testid` or `aria-label` available
- Text match is most reliable

### Message Detection

```javascript
document.querySelectorAll('[data-message-author-role="assistant"]')
document.querySelectorAll('[data-message-author-role="user"]')
```

### Pro Model "Thinking" Detection

```javascript
Array.from(document.querySelectorAll('button')).find(b => b.innerText?.includes('Answer now'))
```

## Common Tasks

### Adding a New Setting

1. Add default to `DEFAULT_SETTINGS` in both `background.js` and `popup.js`
2. Add UI element in `popup.html`
3. Add event listener in `popup.js` → `setupEventListeners()`
4. Use setting in `background.js` where needed

### Debugging Detection Issues

1. Open DevTools on ChatGPT tab
2. Check console for `[ChatGPT Notifier]` logs
3. Verify Stop button selector still works: paste selector in console
4. Check `isGenerating()` returns correct boolean

### If Selectors Break

ChatGPT updates their DOM periodically. If detection stops working:

1. Inspect the Stop button element
2. Find a reliable selector (text content preferred over classes)
3. Update `findStopButton()` in `content.js`
