// ChatGPT Completion Notifier - Content Script
// Monitors DOM for generation state changes and notifies background worker

(function() {
  'use strict';

  // State
  let isMonitoring = false;
  let wasGenerating = false;
  let cooldownTimer = null;
  let pollInterval = null;
  let lastAssistantText = '';
  let generationStartTime = null;
  let stabilityWindowMs = 1500; // Default, can be overridden by settings

  const POLL_INTERVAL_MS = 500; // Check every 500ms

  // DOM Detection Functions (verified Jan 2025)

  function findStopButton() {
    // Stop button has class btn-secondary and text "Stop"
    const buttons = document.querySelectorAll('button');
    return Array.from(buttons).find(b => b.innerText === 'Stop');
  }

  function isGenerating() {
    return !!findStopButton();
  }

  function getLastAssistantMessage() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (messages.length === 0) return null;
    return messages[messages.length - 1];
  }

  function getAssistantPreview() {
    const lastMsg = getLastAssistantMessage();
    if (!lastMsg) return '';
    const text = lastMsg.innerText || '';
    // Return first ~100 chars as preview
    if (text.length <= 100) return text;
    return text.substring(0, 100) + '...';
  }

  function getAssistantText() {
    const lastMsg = getLastAssistantMessage();
    return lastMsg ? (lastMsg.innerText || '') : '';
  }

  // State Machine

  function checkState() {
    if (!isMonitoring) return;

    const generating = isGenerating();
    const currentAssistantText = getAssistantText();

    // Transition: was generating -> not generating
    if (wasGenerating && !generating) {
      // Start cooldown - wait for text to stabilize
      startCooldown();
    }

    // Transition: not generating -> generating
    if (!wasGenerating && generating) {
      // Cancel any pending cooldown
      cancelCooldown();
      generationStartTime = Date.now();
      console.log('[ChatGPT Notifier] Generation started');
    }

    // During cooldown, check if text is still changing
    if (cooldownTimer && currentAssistantText !== lastAssistantText) {
      // Text still changing, reset cooldown
      console.log('[ChatGPT Notifier] Text still changing, resetting cooldown');
      startCooldown();
    }

    wasGenerating = generating;
    lastAssistantText = currentAssistantText;
  }

  function startCooldown() {
    cancelCooldown();
    console.log('[ChatGPT Notifier] Starting cooldown timer (' + stabilityWindowMs + 'ms)');

    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      onGenerationComplete();
    }, stabilityWindowMs);
  }

  function cancelCooldown() {
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  }

  function onGenerationComplete() {
    console.log('[ChatGPT Notifier] Generation complete!');

    const preview = getAssistantPreview();
    const duration = generationStartTime ? Date.now() - generationStartTime : null;

    // Reset start time
    generationStartTime = null;

    // Send message to background script
    chrome.runtime.sendMessage({
      type: 'GENERATION_COMPLETE',
      preview: preview,
      duration: duration
    }).catch(err => {
      console.error('[ChatGPT Notifier] Failed to send message:', err);
    });
  }

  // Monitoring Control

  function startMonitoring(options = {}) {
    if (isMonitoring) return;

    // Apply settings if provided
    if (options.stabilityWindowMs) {
      stabilityWindowMs = options.stabilityWindowMs;
    }

    isMonitoring = true;
    wasGenerating = isGenerating();
    lastAssistantText = getAssistantText();

    console.log('[ChatGPT Notifier] Monitoring started. Currently generating:', wasGenerating, 'Stability window:', stabilityWindowMs + 'ms');

    // Poll for state changes (only start if not already polling)
    if (!pollInterval) {
      pollInterval = setInterval(checkState, POLL_INTERVAL_MS);
    }
  }

  function stopMonitoring() {
    isMonitoring = false;
    cancelCooldown();
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    console.log('[ChatGPT Notifier] Monitoring stopped');
  }

  // Message Handling

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_MONITORING') {
      startMonitoring({ stabilityWindowMs: message.stabilityWindowMs });
      sendResponse({ success: true, generating: isGenerating() });
    } else if (message.type === 'STOP_MONITORING') {
      stopMonitoring();
      sendResponse({ success: true });
    } else if (message.type === 'GET_STATUS') {
      sendResponse({
        isMonitoring: isMonitoring,
        isGenerating: isGenerating()
      });
    }
    return true; // Keep channel open for async response
  });

  // Initialize - check if we should be monitoring (in case of page refresh)
  chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' }).then(response => {
    if (response && response.isMonitored) {
      startMonitoring();
    }
  }).catch(() => {
    // Background script not ready yet, that's ok
  });

  console.log('[ChatGPT Notifier] Content script loaded');
})();
