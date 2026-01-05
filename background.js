// ChatGPT Completion Notifier - Background Service Worker
// Manages tab monitoring state and sends notifications

// Track monitored tabs
const monitoredTabs = new Set();

// Default settings
const DEFAULT_SETTINGS = {
  soundEnabled: true,
  soundVolume: 0.5,
  notificationsEnabled: true,
  previewLength: 100,
  autoEnableEnabled: true,
  stabilityWindowMs: 1500,
  badgeMode: 'duration' // 'duration' | 'on' | 'none'
};

// Current settings (loaded from storage)
let settings = { ...DEFAULT_SETTINGS };

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  if (result.settings) {
    settings = { ...DEFAULT_SETTINGS, ...result.settings };
  }
  return settings;
}

// Save settings to storage
async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
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
    settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    console.log('[ChatGPT Notifier] Settings updated:', settings);
  }
});

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
async function playSound() {
  try {
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
    }

    chrome.runtime.sendMessage({ type: 'PLAY_SOUND', volume: settings.soundVolume }).catch(() => {
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
    updateAllBadges();
  }
});

// Save monitored tabs to storage
function saveMonitoredTabs() {
  chrome.storage.local.set({ monitoredTabs: Array.from(monitoredTabs) });
}

// Update badge for a specific tab
function updateBadge(tabId, text, color) {
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

// Update badges for all monitored tabs
function updateAllBadges() {
  monitoredTabs.forEach(tabId => {
    updateBadge(tabId, 'ON', '#4CAF50');
  });
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'GENERATION_COMPLETE':
      if (tabId && monitoredTabs.has(tabId)) {
        // Show notification if enabled
        if (settings.notificationsEnabled) {
          showNotification(message.preview, tabId, message.duration);
        }
        // Update badge based on settings
        if (settings.badgeMode === 'duration' && message.duration) {
          updateBadge(tabId, formatDuration(message.duration), '#2196F3');
        } else if (settings.badgeMode === 'on') {
          updateBadge(tabId, '!', '#2196F3');
        } else if (settings.badgeMode === 'none') {
          updateBadge(tabId, '', '#000000');
        } else {
          updateBadge(tabId, '!', '#2196F3');
        }
        // Play notification sound if enabled
        if (settings.soundEnabled) {
          playSound();
        }
      }
      sendResponse({ success: true });
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
  }

  return true;
});

// Toggle monitoring for a tab
async function toggleMonitoring(tabId) {
  const isCurrentlyMonitored = monitoredTabs.has(tabId);

  if (isCurrentlyMonitored) {
    // Stop monitoring
    monitoredTabs.delete(tabId);
    updateBadge(tabId, '', '#000000');

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
    updateBadge(tabId, 'ON', '#4CAF50');

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
  if (monitoredTabs.has(tabId)) {
    monitoredTabs.delete(tabId);
    saveMonitoredTabs();
    console.log('[ChatGPT Notifier] Tab closed, removed from monitoring:', tabId);
  }
});

// Auto-enable on ChatGPT tabs + Clean up when navigating away
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Auto-enable when tab finishes loading ChatGPT (if setting enabled)
  if (settings.autoEnableEnabled && changeInfo.status === 'complete' && tab.url) {
    const isChatGPT = tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com');
    if (isChatGPT && !monitoredTabs.has(tabId)) {
      monitoredTabs.add(tabId);
      updateBadge(tabId, 'ON', '#4CAF50');
      chrome.tabs.sendMessage(tabId, { type: 'START_MONITORING', stabilityWindowMs: settings.stabilityWindowMs }).catch(() => {
        // Content script might not be ready yet
      });
      saveMonitoredTabs();
      console.log('[ChatGPT Notifier] Auto-enabled monitoring for tab:', tabId);
    }
  }

  // Clean up when navigating away from ChatGPT
  if (changeInfo.url && monitoredTabs.has(tabId)) {
    const url = changeInfo.url;
    if (!url.includes('chatgpt.com') && !url.includes('chat.openai.com')) {
      monitoredTabs.delete(tabId);
      updateBadge(tabId, '', '#000000');
      saveMonitoredTabs();
      console.log('[ChatGPT Notifier] Tab navigated away, removed from monitoring:', tabId);
    }
  }
});

console.log('[ChatGPT Notifier] Background service worker loaded');
