// ChatGPT Completion Notifier - Popup Script

// DOM Elements
const statusCard = document.getElementById('status-card');
const statusText = document.getElementById('status-text');
const statusBtn = document.getElementById('status-btn');

const soundToggle = document.getElementById('sound-toggle');
const volumeRow = document.getElementById('volume-row');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const notificationsToggle = document.getElementById('notifications-toggle');
const previewSelect = document.getElementById('preview-select');

const autoEnableToggle = document.getElementById('auto-enable-toggle');
const delaySelect = document.getElementById('delay-select');

const badgeOptions = document.getElementById('badge-options');
const badgeOptionEls = badgeOptions.querySelectorAll('.badge-option');

// State
let currentTabId = null;
let isMonitored = false;
let isChatGPT = false;

// Default settings
const DEFAULT_SETTINGS = {
  soundEnabled: true,
  soundVolume: 0.5,
  notificationsEnabled: true,
  previewLength: 100,
  autoEnableEnabled: true,
  stabilityWindowMs: 1500,
  badgeMode: 'duration'
};

// Check if URL is ChatGPT
function isChatGPTUrl(url) {
  return url && (url.includes('chatgpt.com') || url.includes('chat.openai.com'));
}

// Update status UI
function updateStatusUI() {
  if (!isChatGPT) {
    statusCard.className = 'status-card not-chatgpt';
    statusText.textContent = 'Not a ChatGPT tab';
    statusBtn.disabled = true;
    statusBtn.textContent = 'Open ChatGPT first';
    statusBtn.className = 'status-btn';
    return;
  }

  if (isMonitored) {
    statusCard.className = 'status-card monitoring';
    statusText.textContent = 'Monitoring this tab';
    statusBtn.disabled = false;
    statusBtn.textContent = 'Disable';
    statusBtn.className = 'status-btn disable';
  } else {
    statusCard.className = 'status-card not-monitoring';
    statusText.textContent = 'Not monitoring';
    statusBtn.disabled = false;
    statusBtn.textContent = 'Enable';
    statusBtn.className = 'status-btn enable';
  }
}

// Toggle monitoring for current tab
async function toggleMonitoring() {
  if (!currentTabId || !isChatGPT) return;

  statusBtn.disabled = true;
  statusBtn.textContent = 'Please wait...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TOGGLE_MONITORING',
      tabId: currentTabId
    });

    isMonitored = response.isMonitored;
    updateStatusUI();
  } catch (err) {
    console.error('Failed to toggle monitoring:', err);
    statusText.textContent = 'Error - try refreshing';
  }
}

// Load settings from storage
async function loadSettings() {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = { ...DEFAULT_SETTINGS, ...result.settings };

  // Apply to UI
  soundToggle.checked = settings.soundEnabled;
  volumeSlider.value = settings.soundVolume * 100;
  volumeValue.textContent = Math.round(settings.soundVolume * 100) + '%';
  updateVolumeRowVisibility();

  notificationsToggle.checked = settings.notificationsEnabled;
  previewSelect.value = settings.previewLength.toString();

  autoEnableToggle.checked = settings.autoEnableEnabled;
  delaySelect.value = settings.stabilityWindowMs.toString();

  // Badge mode
  badgeOptionEls.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.value === settings.badgeMode);
  });
}

// Save a single setting
async function saveSetting(key, value) {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = { ...DEFAULT_SETTINGS, ...result.settings };
  settings[key] = value;
  await chrome.storage.sync.set({ settings });
}

// Update volume row visibility based on sound toggle
function updateVolumeRowVisibility() {
  volumeRow.classList.toggle('hidden', !soundToggle.checked);
}

// Update volume display
function updateVolumeDisplay() {
  volumeValue.textContent = volumeSlider.value + '%';
}

// Set up event listeners
function setupEventListeners() {
  // Status button
  statusBtn.addEventListener('click', toggleMonitoring);

  // Sound toggle
  soundToggle.addEventListener('change', () => {
    saveSetting('soundEnabled', soundToggle.checked);
    updateVolumeRowVisibility();
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

  // Badge options
  badgeOptionEls.forEach(option => {
    option.addEventListener('click', () => {
      badgeOptionEls.forEach(o => o.classList.remove('active'));
      option.classList.add('active');
      saveSetting('badgeMode', option.dataset.value);
    });
  });
}

// Initialize
async function init() {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      statusText.textContent = 'No active tab';
      return;
    }

    currentTabId = tab.id;
    isChatGPT = isChatGPTUrl(tab.url);

    if (isChatGPT) {
      // Check if already monitoring
      const response = await chrome.runtime.sendMessage({
        type: 'GET_MONITORING_STATE',
        tabId: currentTabId
      });
      isMonitored = response?.isMonitored || false;
    }

    // Load settings
    await loadSettings();

    // Update UI
    updateStatusUI();

    // Set up event listeners
    setupEventListeners();

  } catch (err) {
    console.error('Init error:', err);
    statusText.textContent = 'Error initializing';
  }
}

init();
