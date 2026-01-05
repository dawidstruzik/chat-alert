// ChatGPT Completion Notifier - Background Service Worker
// Manages tab monitoring state and sends notifications

// Track all ChatGPT tabs with rich metadata
const tabsData = new Map(); // tabId -> TabInfo

// Ephemeral tab metadata persisted across service worker restarts (prefer session storage)
const EPHEMERAL_TABS_KEY = 'tabsDataEphemeral';

const VALID_STATES = new Set(['idle', 'generating', 'thinking', 'writing', 'completed']);

function getEphemeralStorageArea() {
  // chrome.storage.session persists across MV3 service worker restarts, but not browser restarts.
  // Fall back to local storage if session storage isn't available (older Chrome).
  return chrome.storage?.session || chrome.storage.local;
}

function normalizeState(value) {
  return VALID_STATES.has(value) ? value : null;
}

function normalizeTimestamp(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

async function loadEphemeralTabsData() {
  try {
    const storage = getEphemeralStorageArea();
    const result = await storage.get([EPHEMERAL_TABS_KEY]);
    return result[EPHEMERAL_TABS_KEY] || {};
  } catch (e) {
    console.warn('[ChatGPT Notifier] Failed to load ephemeral tabs data:', e);
    return {};
  }
}

async function upsertEphemeralTabData(tabId, patch) {
  try {
    const storage = getEphemeralStorageArea();
    const result = await storage.get([EPHEMERAL_TABS_KEY]);
    const data = result[EPHEMERAL_TABS_KEY] || {};
    const key = String(tabId);
    data[key] = { ...(data[key] || {}), ...patch };
    await storage.set({ [EPHEMERAL_TABS_KEY]: data });
  } catch (e) {
    // Best-effort; don't break main flow.
  }
}

async function removeEphemeralTabData(tabId) {
  try {
    const storage = getEphemeralStorageArea();
    const result = await storage.get([EPHEMERAL_TABS_KEY]);
    const data = result[EPHEMERAL_TABS_KEY] || {};
    const key = String(tabId);
    if (!data[key]) return;
    delete data[key];
    await storage.set({ [EPHEMERAL_TABS_KEY]: data });
  } catch (e) {
    // Best-effort.
  }
}

function persistEphemeralFields(tabId) {
  const tab = tabsData.get(tabId);
  if (!tab) return;
  void upsertEphemeralTabData(tabId, {
    currentState: tab.currentState,
    stateChangedAt: tab.stateChangedAt,
    lastMessageTime: tab.lastMessageTime,
    generationStartedAt: tab.generationStartedAt
  });
}

// TabInfo structure:
// {
//   tabId: number,
//   windowId: number,
//   url: string,
//   title: string,
//   isMonitored: boolean,
//   currentState: 'idle' | 'generating' | 'thinking' | 'writing' | 'completed',
//   stateChangedAt: number (timestamp),
//   lastMessageTime: number (timestamp from ChatGPT API, null if not available),
//   generationStartedAt: number (for timer display),
//   completions: [{ timestamp, duration, preview }] // last 5
// }

// Legacy compatibility - will migrate to tabsData
const monitoredTabs = new Set();

// Default settings
const DEFAULT_SETTINGS = {
  soundEnabled: true,
  soundVolume: 0.5,
  selectedSound: 'success',
  notificationsEnabled: true,
  previewLength: 100,
  autoEnableEnabled: true,
  stabilityWindowMs: 1500
};

// Current settings (loaded from storage)
let settings = { ...DEFAULT_SETTINGS };

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

function sanitizeSettings(raw) {
  const sanitized = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return sanitized;
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      sanitized[key] = raw[key];
    }
  }
  return sanitized;
}

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  settings = sanitizeSettings(result.settings);
  return settings;
}

// Save settings to storage
async function saveSettings(newSettings) {
  settings = sanitizeSettings({ ...settings, ...newSettings });
  await chrome.storage.sync.set({ settings });
  return settings;
}

// Initialize settings on startup
loadSettings().then(() => {
  console.log('[ChatGPT Notifier] Settings loaded:', settings);
});

// Listen for settings changes from other contexts (popup, options page)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.settings) {
    settings = sanitizeSettings(changes.settings.newValue);
    console.log('[ChatGPT Notifier] Settings updated:', settings);
  }
});

// Check if URL is a ChatGPT URL
function isChatGPTUrl(url) {
  return url && (url.includes('chatgpt.com') || url.includes('chat.openai.com'));
}

// Create a new TabInfo object
function createTabInfo(tab, existingEphemeral = null) {
  const existingState = normalizeState(existingEphemeral?.currentState);
  const existingStateChangedAt = normalizeTimestamp(existingEphemeral?.stateChangedAt);
  const existingLastMessageTime = normalizeTimestamp(existingEphemeral?.lastMessageTime);
  const existingGenerationStartedAt = normalizeTimestamp(existingEphemeral?.generationStartedAt);

  // On first discovery, use Chrome's lastAccessed as a more useful baseline than "now".
  const baseline = normalizeTimestamp(tab.lastAccessed) || Date.now();

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || '',
    title: tab.title || 'ChatGPT',
    isMonitored: monitoredTabs.has(tab.id),
    currentState: existingState || 'idle',
    stateChangedAt: existingStateChangedAt || baseline,
    lastMessageTime: existingLastMessageTime,  // Timestamp from ChatGPT API (more accurate)
    generationStartedAt: existingGenerationStartedAt,  // Timestamp when generation started (for timer display)
    completions: []
  };
}

// Update tab state
function updateTabState(tabId, state) {
  const tab = tabsData.get(tabId);
  if (tab && tab.currentState !== state) {
    tab.currentState = state;
    tab.stateChangedAt = Date.now();
    console.log('[ChatGPT Notifier] Tab', tabId, 'state changed to:', state);
    // Update global badge to reflect active sessions count
    updateGlobalBadge();
    persistEphemeralFields(tabId);
  }
}

// Add a completion to tab history (keep last 5)
function addCompletion(tabId, preview, duration) {
  const tab = tabsData.get(tabId);
  if (!tab) return;

  tab.completions.unshift({
    timestamp: Date.now(),
    duration: duration || 0,
    preview: preview || ''
  });

  // Keep only last 5
  if (tab.completions.length > 5) {
    tab.completions = tab.completions.slice(0, 5);
  }

  saveTabsData();
}

// Broadcast tabs update to popup
function broadcastTabsUpdate() {
  chrome.runtime.sendMessage({
    type: 'TABS_UPDATE',
    tabs: Array.from(tabsData.values())
  }).catch(() => {
    // Popup not open, that's ok
  });
}

// Discover all ChatGPT tabs
async function discoverChatGPTTabs(ephemeralData = {}) {
  try {
    const tabs = await chrome.tabs.query({
      url: ['*://chatgpt.com/*', '*://chat.openai.com/*']
    });

    for (const tab of tabs) {
      if (!tabsData.has(tab.id)) {
        const existing = ephemeralData[String(tab.id)] || null;
        tabsData.set(tab.id, createTabInfo(tab, existing));
        persistEphemeralFields(tab.id);
        console.log('[ChatGPT Notifier] Discovered ChatGPT tab:', tab.id, tab.title);
      } else {
        // Ensure legacy/older entries always have a usable timestamp
        const tabInfo = tabsData.get(tab.id);
        if (!normalizeTimestamp(tabInfo.stateChangedAt)) {
          tabInfo.stateChangedAt = normalizeTimestamp(tab.lastAccessed) || Date.now();
          persistEphemeralFields(tab.id);
        }
      }

      // Query content script for current state
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT_STATE' });
        if (response && response.state) {
          updateTabState(tab.id, response.state);
        }
      } catch (e) {
        // Content script not ready yet
      }
    }

    broadcastTabsUpdate();
  } catch (e) {
    console.error('[ChatGPT Notifier] Failed to discover tabs:', e);
  }
}

// Save tabs data to storage (only persistent fields)
function saveTabsData() {
  const persistData = {};
  for (const [tabId, tab] of tabsData) {
    persistData[tabId] = {
      isMonitored: tab.isMonitored,
      completions: tab.completions
    };
  }
  chrome.storage.local.set({ tabsDataPersist: persistData });
}

// Load persisted tabs data
async function loadPersistedTabsData() {
  const result = await chrome.storage.local.get(['tabsDataPersist']);
  return result.tabsDataPersist || {};
}

// Format duration in ms to human readable string
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}s`;
}

// Play notification sound using offscreen document
async function playSound(volume, sound) {
  try {
    // Use provided values or fall back to settings
    const vol = volume !== undefined ? volume : settings.soundVolume;
    const snd = sound || settings.selectedSound;

    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play notification sound when ChatGPT response completes'
      });
      // Wait a bit for the offscreen document to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    chrome.runtime.sendMessage({ type: 'PLAY_SOUND', volume: vol, sound: snd }).catch(() => {
      // Offscreen document might not be ready yet, that's ok
    });
  } catch (e) {
    console.error('[ChatGPT Notifier] Failed to play sound:', e);
  }
}

// Initialize from storage
chrome.storage.local.get(['monitoredTabs'], (result) => {
  if (result.monitoredTabs) {
    result.monitoredTabs.forEach(tabId => monitoredTabs.add(tabId));
  }
});

// Initialize tabs data on startup
async function initializeTabsData() {
  // Load persisted data (monitoring state + completions)
  const persistedData = await loadPersistedTabsData();
  const ephemeralData = await loadEphemeralTabsData();

  // Discover all current ChatGPT tabs
  await discoverChatGPTTabs(ephemeralData);

  // Merge persisted completions and monitoring state
  for (const [tabIdStr, data] of Object.entries(persistedData)) {
    const tabId = parseInt(tabIdStr);
    if (tabsData.has(tabId)) {
      const tab = tabsData.get(tabId);
      tab.completions = data.completions || [];
      // isMonitored is already synced from monitoredTabs Set
    }
  }

  console.log('[ChatGPT Notifier] Tabs data initialized:', tabsData.size, 'tabs');
  updateGlobalBadge();
}

// Run initialization
initializeTabsData();

// Save monitored tabs to storage
function saveMonitoredTabs() {
  chrome.storage.local.set({ monitoredTabs: Array.from(monitoredTabs) });
}

// Update global badge with count of active (generating) tabs
function updateGlobalBadge() {
  const activeStates = ['generating', 'thinking', 'writing'];
  let activeCount = 0;

  for (const tab of tabsData.values()) {
    if (activeStates.includes(tab.currentState)) {
      activeCount++;
    }
  }

  if (activeCount > 0) {
    // Show count of active sessions
    const text = activeCount.toString();
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#FF9800' }); // Orange for active

    // Ensure any historical per-tab badge values don't override the global count.
    for (const tab of tabsData.values()) {
      chrome.action.setBadgeText({ text, tabId: tab.tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#FF9800', tabId: tab.tabId });
    }
  } else {
    // Clear badge when no active sessions
    chrome.action.setBadgeText({ text: '' });

    // Clear per-tab values too (keeps behavior consistent across focused tabs).
    for (const tab of tabsData.values()) {
      chrome.action.setBadgeText({ text: '', tabId: tab.tabId });
    }
  }
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'GENERATION_COMPLETE':
      if (tabId) {
        // Update tabsData state and add completion
        updateTabState(tabId, 'completed');
        addCompletion(tabId, message.preview, message.duration);
        broadcastTabsUpdate();

        // Only notify if monitored
        if (monitoredTabs.has(tabId)) {
          // Show notification if enabled
          if (settings.notificationsEnabled) {
            showNotification(message.preview, tabId, message.duration);
          }
          // Play notification sound if enabled
          if (settings.soundEnabled) {
            playSound();
          }
        }
      }
      sendResponse({ success: true });
      break;

    case 'STATE_CHANGE':
      if (tabId && tabsData.has(tabId)) {
        updateTabState(tabId, message.state);
        // Store generation start time for timer display
        const tabInfo = tabsData.get(tabId);
        if (['generating', 'thinking', 'writing'].includes(message.state)) {
          // Only set if not already set (preserve original start time)
          if (!tabInfo.generationStartedAt) {
            tabInfo.generationStartedAt = message.generationStartTime || Date.now();
          }
        } else {
          // Clear when not generating
          tabInfo.generationStartedAt = null;
        }
        persistEphemeralFields(tabId);
        broadcastTabsUpdate();
      }
      sendResponse({ success: true });
      break;

    case 'CONVERSATION_TIMESTAMP':
      // Received real timestamp from ChatGPT API (via fetch interceptor)
      if (tabId && tabsData.has(tabId)) {
        const tabInfo = tabsData.get(tabId);
        tabInfo.lastMessageTime = message.updateTime;
        console.log('[ChatGPT Notifier] Received API timestamp for tab', tabId, new Date(message.updateTime).toLocaleString());
        persistEphemeralFields(tabId);
        broadcastTabsUpdate();
      }
      sendResponse({ success: true });
      break;

    case 'GET_ALL_TABS':
      sendResponse({ tabs: Array.from(tabsData.values()) });
      break;

    case 'FOCUS_TAB':
      if (message.tabId) {
        chrome.tabs.update(message.tabId, { active: true }).then(() => {
          if (message.windowId) {
            chrome.windows.update(message.windowId, { focused: true });
          }
        }).catch(e => {
          console.error('[ChatGPT Notifier] Failed to focus tab:', e);
        });
        sendResponse({ success: true });
      }
      break;

    case 'GET_TAB_STATE':
      sendResponse({ isMonitored: tabId ? monitoredTabs.has(tabId) : false });
      break;

    case 'TOGGLE_MONITORING':
      if (message.tabId) {
        toggleMonitoring(message.tabId).then(result => {
          sendResponse(result);
        });
        return true; // Keep channel open for async response
      }
      break;

    case 'GET_MONITORING_STATE':
      if (message.tabId) {
        sendResponse({ isMonitored: monitoredTabs.has(message.tabId) });
      }
      break;

    case 'GET_SETTINGS':
      sendResponse({ settings });
      break;

    case 'SET_SETTINGS':
      saveSettings(message.settings).then(updatedSettings => {
        sendResponse({ settings: updatedSettings });
      });
      return true; // Keep channel open for async response

    case 'PLAY_SOUND':
      // Handle sound preview from popup
      playSound(message.volume, message.sound);
      sendResponse({ success: true });
      break;
  }

  return true;
});

// Toggle monitoring for a tab
async function toggleMonitoring(tabId) {
  const isCurrentlyMonitored = monitoredTabs.has(tabId);

  if (isCurrentlyMonitored) {
    // Stop monitoring
    monitoredTabs.delete(tabId);

    // Update tabsData
    const tab = tabsData.get(tabId);
    if (tab) {
      tab.isMonitored = false;
      saveTabsData();
      broadcastTabsUpdate();
    }

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'STOP_MONITORING' });
    } catch (e) {
      // Tab might not have content script loaded
    }

    saveMonitoredTabs();
    return { isMonitored: false };
  } else {
    // Start monitoring
    monitoredTabs.add(tabId);

    // Update tabsData
    const tab = tabsData.get(tabId);
    if (tab) {
      tab.isMonitored = true;
      saveTabsData();
      broadcastTabsUpdate();
    }

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_MONITORING', stabilityWindowMs: settings.stabilityWindowMs });
    } catch (e) {
      // Tab might not have content script loaded yet
      console.error('Failed to start monitoring:', e);
    }

    saveMonitoredTabs();
    return { isMonitored: true };
  }
}

// Show notification
function showNotification(preview, tabId, duration) {
  const notificationId = `chatgpt-done-${tabId}-${Date.now()}`;

  // Build message with optional duration and preview length
  let message = 'Your ChatGPT response is complete!';
  if (preview && settings.previewLength > 0) {
    // Truncate preview to setting length
    message = preview.length > settings.previewLength
      ? preview.substring(0, settings.previewLength) + '...'
      : preview;
  }
  if (duration) {
    message = `(${formatDuration(duration)}) ${message}`;
  }

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'ChatGPT Response Ready',
    message: message,
    priority: 2,
    requireInteraction: false
  });

  // Click notification to focus the tab
  chrome.notifications.onClicked.addListener(function handler(clickedId) {
    if (clickedId === notificationId) {
      chrome.tabs.update(tabId, { active: true });
      // Get the tab's window and focus it
      chrome.tabs.get(tabId).then(tab => {
        if (tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true });
        }
      }).catch(() => {});
      chrome.notifications.onClicked.removeListener(handler);
    }
  });

  console.log('[ChatGPT Notifier] Notification shown for tab', tabId);
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove from tabsData
  if (tabsData.has(tabId)) {
    tabsData.delete(tabId);
    void removeEphemeralTabData(tabId);
    saveTabsData();
    broadcastTabsUpdate();
    updateGlobalBadge(); // Update active count
    console.log('[ChatGPT Notifier] Tab closed, removed from tabsData:', tabId);
  }

  // Remove from monitored tabs
  if (monitoredTabs.has(tabId)) {
    monitoredTabs.delete(tabId);
    saveMonitoredTabs();
    console.log('[ChatGPT Notifier] Tab closed, removed from monitoring:', tabId);
  }
});

// Track ChatGPT tabs + Auto-enable + Clean up
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isChatGPT = isChatGPTUrl(tab.url);

  // Track ALL ChatGPT tabs when they finish loading
  if (changeInfo.status === 'complete' && tab.url && isChatGPT) {
    if (!tabsData.has(tabId)) {
      // New ChatGPT tab discovered
      tabsData.set(tabId, createTabInfo(tab));
      persistEphemeralFields(tabId);
      console.log('[ChatGPT Notifier] New ChatGPT tab detected:', tabId, tab.title);
    } else {
      // Update existing tab info (title/url may have changed)
      const tabInfo = tabsData.get(tabId);
      tabInfo.title = tab.title || 'ChatGPT';
      tabInfo.url = tab.url;
      tabInfo.windowId = tab.windowId;
    }
    broadcastTabsUpdate();

    // Auto-enable monitoring if setting enabled
    if (settings.autoEnableEnabled && !monitoredTabs.has(tabId)) {
      monitoredTabs.add(tabId);

      const tabInfo = tabsData.get(tabId);
      if (tabInfo) {
        tabInfo.isMonitored = true;
      }

      chrome.tabs.sendMessage(tabId, { type: 'START_MONITORING', stabilityWindowMs: settings.stabilityWindowMs }).catch(() => {
        // Content script might not be ready yet
      });
      saveMonitoredTabs();
      saveTabsData();
      broadcastTabsUpdate();
      console.log('[ChatGPT Notifier] Auto-enabled monitoring for tab:', tabId);
    }
  }

  // Update title when it changes (ChatGPT updates title after first message)
  if (changeInfo.title && isChatGPT && tabsData.has(tabId)) {
    const tabInfo = tabsData.get(tabId);
    if (tabInfo.title !== changeInfo.title) {
      tabInfo.title = changeInfo.title;
      broadcastTabsUpdate();
      console.log('[ChatGPT Notifier] Tab title updated:', tabId, changeInfo.title);
    }
  }

  // Clean up when navigating away from ChatGPT
  if (changeInfo.url && !isChatGPTUrl(changeInfo.url)) {
    // Remove from tabsData
    if (tabsData.has(tabId)) {
      tabsData.delete(tabId);
      void removeEphemeralTabData(tabId);
      saveTabsData();
      broadcastTabsUpdate();
      updateGlobalBadge();
      console.log('[ChatGPT Notifier] Tab navigated away, removed from tabsData:', tabId);
    }

    // Remove from monitored
    if (monitoredTabs.has(tabId)) {
      monitoredTabs.delete(tabId);
      saveMonitoredTabs();
      console.log('[ChatGPT Notifier] Tab navigated away, removed from monitoring:', tabId);
    }
  }
});

console.log('[ChatGPT Notifier] Background service worker loaded');
