// ChatGPT Completion Notifier - Popup Script (Dashboard)

// DOM Elements - Dashboard
const dashboardView = document.getElementById('dashboard-view');
const settingsView = document.getElementById('settings-view');
const settingsToggle = document.getElementById('settings-toggle');
const settingsBack = document.getElementById('settings-back');
const searchInput = document.getElementById('search-input');
const tabsCount = document.getElementById('tabs-count');
const tabsList = document.getElementById('tabs-list');
const emptyState = document.getElementById('empty-state');

// DOM Elements - Settings
const soundToggle = document.getElementById('sound-toggle');
const volumeRow = document.getElementById('volume-row');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const soundRow = document.getElementById('sound-row');
const soundSelect = document.getElementById('sound-select');
const previewSoundBtn = document.getElementById('preview-sound');
const notificationsToggle = document.getElementById('notifications-toggle');
const previewSelect = document.getElementById('preview-select');
const autoEnableToggle = document.getElementById('auto-enable-toggle');
const delaySelect = document.getElementById('delay-select');

// State
let allTabs = [];
let settingsVisible = false;
let searchQuery = '';
let timerInterval = null;
let relativeTimeInterval = null;

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

// State labels
const STATE_LABELS = {
  idle: 'Idle',
  generating: 'Generating...',
  thinking: 'Thinking...',
  writing: 'Writing...',
  completed: 'Completed'
};

// Bell icon SVG
const BELL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
</svg>`;

// Format relative time
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

// Format elapsed time for active generation (e.g., "5m 16s")
function formatElapsedTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

// Get best available timestamp (API timestamp preferred, fallback to local)
function getTimestamp(tab) {
  return tab.lastMessageTime || tab.stateChangedAt || null;
}

// Get state label with relative time for completed/idle
function getStateLabel(tab) {
  // For active states with timer, return just the base label (timer shown separately)
  const isActive = ['generating', 'thinking', 'writing'].includes(tab.currentState);
  if (isActive && tab.generationStartedAt) {
    return STATE_LABELS[tab.currentState];
  }

  const timestamp = getTimestamp(tab);

  if (tab.currentState === 'completed' && timestamp) {
    return `Completed ${formatRelativeTime(timestamp)}`;
  }
  if (tab.currentState === 'idle') {
    // Show time if we have a timestamp (API or local)
    if (timestamp) {
      const relTime = formatRelativeTime(timestamp);
      if (relTime) {
        return `Idle · ${relTime}`;
      }
    }
    return 'Idle';  // No timestamp available yet
  }
  return STATE_LABELS[tab.currentState] || 'Unknown';
}

// Start interval for updating relative-time state labels (idle/completed)
function startRelativeTimeUpdates() {
  if (relativeTimeInterval) return;
  // 30s keeps "just now" -> "1m ago" reasonably fresh without being noisy.
  relativeTimeInterval = setInterval(updateRelativeTimeLabels, 30000);
}

function stopRelativeTimeUpdates() {
  if (relativeTimeInterval) {
    clearInterval(relativeTimeInterval);
    relativeTimeInterval = null;
  }
}

function updateRelativeTimeLabels() {
  // Update in-place to avoid scroll jumps from rerendering the whole list.
  document.querySelectorAll('.tab-row').forEach(row => {
    const tabId = parseInt(row.dataset.tabId, 10);
    if (!tabId) return;

    const tab = allTabs.find(t => t.tabId === tabId);
    if (!tab) return;

    const stateEl = row.querySelector('.tab-state');
    if (!stateEl) return;

    const nextLabel = getStateLabel(tab);
    if (stateEl.textContent !== nextLabel) {
      stateEl.textContent = nextLabel;
    }
  });
}

// Clean title (remove "ChatGPT" prefix if present)
function cleanTitle(title) {
  if (!title) return 'ChatGPT';
  // Remove common prefixes
  let cleaned = title.replace(/^ChatGPT\s*[-|]\s*/i, '');
  if (cleaned.length === 0 || cleaned === 'ChatGPT') {
    return 'ChatGPT';
  }
  return cleaned;
}

// Render a single tab row
function renderTabRow(tab) {
  const stateClass = tab.currentState || 'idle';
  const stateLabel = getStateLabel(tab);
  const title = cleanTitle(tab.title);
  const isActive = ['generating', 'thinking', 'writing'].includes(tab.currentState);

  // Build timer display for active states
  let timerHtml = '';
  if (isActive && tab.generationStartedAt) {
    const elapsed = formatElapsedTime(Date.now() - tab.generationStartedAt);
    timerHtml = `<span class="tab-timer" data-start-time="${tab.generationStartedAt}">${elapsed}</span>`;
  }

  return `
    <div class="tab-row" data-tab-id="${tab.tabId}" data-window-id="${tab.windowId}">
      <div class="tab-main">
        <div class="tab-status">
          <div class="status-dot ${stateClass}"></div>
        </div>
        <div class="tab-info">
          <div class="tab-title" title="${tab.title || 'ChatGPT'}">${title}</div>
          <div class="tab-meta">
            <span class="tab-state ${stateClass}">${stateLabel}</span>
            ${timerHtml}
          </div>
        </div>
      </div>
      <div class="tab-actions">
        <button class="monitor-toggle ${tab.isMonitored ? 'active' : ''}"
                title="${tab.isMonitored ? 'Notifications on' : 'Notifications off'}">
          ${BELL_ICON}
        </button>
      </div>
    </div>
  `;
}

// Render the tabs list
function renderTabsList() {
  if (allTabs.length === 0) {
    tabsList.classList.add('hidden');
    emptyState.classList.remove('hidden');
    tabsCount.textContent = 'No ChatGPT tabs';
    stopRelativeTimeUpdates();
    return;
  }

  // Filter tabs by search query
  const filteredTabs = allTabs.filter(tab =>
    !searchQuery ||
    cleanTitle(tab.title).toLowerCase().includes(searchQuery)
  );

  // Show empty state if no matches
  if (filteredTabs.length === 0) {
    tabsList.classList.add('hidden');
    emptyState.classList.remove('hidden');
    tabsCount.textContent = `0 of ${allTabs.length} tabs`;
    stopRelativeTimeUpdates();
    return;
  }

  tabsList.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Count active (generating) tabs in filtered list
  const activeTabs = filteredTabs.filter(t =>
    ['generating', 'thinking', 'writing'].includes(t.currentState)
  ).length;

  // Update header with filtered count
  if (searchQuery) {
    const matchWord = filteredTabs.length === 1 ? 'tab' : 'tabs';
    tabsCount.textContent = `${filteredTabs.length} of ${allTabs.length} ${matchWord}`;
  } else {
    const tabWord = allTabs.length === 1 ? 'tab' : 'tabs';
    if (activeTabs > 0) {
      tabsCount.textContent = `${allTabs.length} ChatGPT ${tabWord} (${activeTabs} active)`;
    } else {
      tabsCount.textContent = `${allTabs.length} ChatGPT ${tabWord}`;
    }
  }

  // Sort tabs: active first, then by most recent activity
  const sortedTabs = [...filteredTabs].sort((a, b) => {
    const aActive = ['generating', 'thinking', 'writing'].includes(a.currentState);
    const bActive = ['generating', 'thinking', 'writing'].includes(b.currentState);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return (getTimestamp(b) || 0) - (getTimestamp(a) || 0);
  });

  // Render rows
  tabsList.innerHTML = sortedTabs.map(renderTabRow).join('');

  // Attach event listeners
  attachTabRowListeners();

  // Start/stop timer updates based on active tabs
  const hasActiveTabs = sortedTabs.some(t =>
    ['generating', 'thinking', 'writing'].includes(t.currentState) && t.generationStartedAt
  );
  if (hasActiveTabs) {
    startTimerUpdates();
  } else {
    stopTimerUpdates();
  }

  // Keep relative timestamps (idle/completed) fresh while popup is open
  startRelativeTimeUpdates();
}

// Start timer interval for updating elapsed time display
function startTimerUpdates() {
  if (timerInterval) return;
  timerInterval = setInterval(updateActiveTimers, 1000);
}

// Stop timer interval
function stopTimerUpdates() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update all active timer displays
function updateActiveTimers() {
  document.querySelectorAll('.tab-timer').forEach(el => {
    const startTime = parseInt(el.dataset.startTime);
    if (startTime) {
      el.textContent = formatElapsedTime(Date.now() - startTime);
    }
  });
}

// Attach click handlers to tab rows
function attachTabRowListeners() {
  document.querySelectorAll('.tab-row').forEach(row => {
    const tabId = parseInt(row.dataset.tabId);
    const windowId = parseInt(row.dataset.windowId);

    // Click main area to switch to tab
    row.querySelector('.tab-main').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'FOCUS_TAB',
        tabId: tabId,
        windowId: windowId
      });
      window.close(); // Close popup after switching
    });

    // Click bell to toggle monitoring
    row.querySelector('.monitor-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTabMonitoring(tabId);
    });
  });
}

// Toggle monitoring for a specific tab
async function toggleTabMonitoring(tabId) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_MONITORING',
      tabId: tabId
    });

    // Update local state and re-render
    const tab = allTabs.find(t => t.tabId === tabId);
    if (tab) {
      tab.isMonitored = response.isMonitored;
      renderTabsList();
    }
  } catch (err) {
    console.error('Failed to toggle monitoring:', err);
  }
}

// Toggle between dashboard and settings view
function showSettings(show) {
  settingsVisible = show;
  dashboardView.classList.toggle('hidden', show);
  settingsView.classList.toggle('hidden', !show);
  settingsToggle.classList.toggle('active', show);
}

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = sanitizeSettings(result.settings);

  // Apply to UI
  soundToggle.checked = settings.soundEnabled;
  volumeSlider.value = settings.soundVolume * 100;
  volumeValue.textContent = Math.round(settings.soundVolume * 100) + '%';
  soundSelect.value = settings.selectedSound;
  updateSoundRowsVisibility();

  notificationsToggle.checked = settings.notificationsEnabled;
  previewSelect.value = settings.previewLength.toString();

  autoEnableToggle.checked = settings.autoEnableEnabled;
  delaySelect.value = settings.stabilityWindowMs.toString();
}

// Save a single setting
async function saveSetting(key, value) {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = sanitizeSettings(result.settings);
  settings[key] = value;
  await chrome.storage.sync.set({ settings });
}

// Update volume and sound rows visibility based on sound toggle
function updateSoundRowsVisibility() {
  const hidden = !soundToggle.checked;
  volumeRow.classList.toggle('hidden', hidden);
  soundRow.classList.toggle('hidden', hidden);
}

// Update volume display
function updateVolumeDisplay() {
  volumeValue.textContent = volumeSlider.value + '%';
}

// Set up event listeners
function setupEventListeners() {
  // Search input
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderTabsList();
  });

  // Settings toggle
  settingsToggle.addEventListener('click', () => {
    showSettings(!settingsVisible);
  });

  // Settings back button
  settingsBack.addEventListener('click', () => {
    showSettings(false);
  });

  // Sound toggle
  soundToggle.addEventListener('change', () => {
    saveSetting('soundEnabled', soundToggle.checked);
    updateSoundRowsVisibility();
  });

  // Sound select
  soundSelect.addEventListener('change', () => {
    saveSetting('selectedSound', soundSelect.value);
  });

  // Preview sound button
  previewSoundBtn.addEventListener('click', async () => {
    const result = await chrome.storage.sync.get(['settings']);
    const settings = sanitizeSettings(result.settings);
    chrome.runtime.sendMessage({
      type: 'PLAY_SOUND',
      volume: settings.soundVolume,
      sound: soundSelect.value
    });
  });

  // Volume slider
  volumeSlider.addEventListener('input', updateVolumeDisplay);
  volumeSlider.addEventListener('change', () => {
    saveSetting('soundVolume', volumeSlider.value / 100);
  });

  // Notifications toggle
  notificationsToggle.addEventListener('change', () => {
    saveSetting('notificationsEnabled', notificationsToggle.checked);
  });

  // Preview select
  previewSelect.addEventListener('change', () => {
    saveSetting('previewLength', parseInt(previewSelect.value));
  });

  // Auto-enable toggle
  autoEnableToggle.addEventListener('change', () => {
    saveSetting('autoEnableEnabled', autoEnableToggle.checked);
  });

  // Delay select
  delaySelect.addEventListener('change', () => {
    saveSetting('stabilityWindowMs', parseInt(delaySelect.value));
  });

  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TABS_UPDATE') {
      allTabs = message.tabs || [];
      renderTabsList();
    }
  });
}

// Initialize
async function init() {
  try {
    // Load all tabs from background
    const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' });
    allTabs = response?.tabs || [];

    // Render dashboard
    renderTabsList();

    // Load settings
    await loadSettings();

    // Set up event listeners
    setupEventListeners();

  } catch (err) {
    console.error('Init error:', err);
    tabsCount.textContent = 'Error loading tabs';
  }
}

init();
