// ChatGPT Completion Notifier - Content Script
// Monitors DOM for generation state changes and notifies background worker

(function() {
  'use strict';

  // Note: Fetch interceptor is now in inject.js (runs in MAIN world via manifest)

  // State constants
  const STATES = {
    IDLE: 'idle',
    GENERATING: 'generating',
    THINKING: 'thinking',
    WRITING: 'writing',
    COMPLETED: 'completed'
  };

  // State
  let isMonitoring = false;
  let wasGenerating = false;
  let cooldownTimer = null;
  let pollInterval = null;
  let lastAssistantText = '';
  let generationStartTime = null;
  let stabilityWindowMs = 1500; // Default, can be overridden by settings
  let currentState = STATES.IDLE;

  const POLL_INTERVAL_MS = 500; // Check every 500ms

  // Safe message sending - handles extension context invalidation
  function safeSendMessage(message) {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        console.log('[ChatGPT Notifier] Extension context invalidated, stopping monitoring');
        stopMonitoring();
        return Promise.resolve(null);
      }
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (e) {
      // Extension was unloaded/reloaded - stop monitoring
      console.log('[ChatGPT Notifier] Extension context invalidated, stopping monitoring');
      stopMonitoring();
      return Promise.resolve(null);
    }
  }

  // Listen for timestamp messages from the injected fetch interceptor
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'CHATGPT_NOTIFIER_TIMESTAMP') {
      // Forward to background script
      safeSendMessage({
        type: 'CONVERSATION_TIMESTAMP',
        updateTime: event.data.updateTime
      });
    }
  });

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

  // Detect "Answer now" button (Pro model thinking state)
  function findAnswerNowButton() {
    const buttons = document.querySelectorAll('button');
    return Array.from(buttons).find(b => b.innerText?.includes('Answer now'));
  }

  function isThinking() {
    return !!findAnswerNowButton();
  }

  // Report state change to background
  function reportStateChange(newState) {
    if (newState !== currentState) {
      const oldState = currentState;
      currentState = newState;
      console.log('[ChatGPT Notifier] State changed:', oldState, '->', newState);
      safeSendMessage({
        type: 'STATE_CHANGE',
        state: newState,
        generationStartTime: generationStartTime  // Include for timer display in popup
      });
    }
  }

  // Determine current detailed state
  function determineDetailedState() {
    const generating = isGenerating();
    const thinking = isThinking();
    const currentAssistantText = getAssistantText();

    if (!generating) {
      // Not generating - either idle or in cooldown (completed)
      if (cooldownTimer) {
        return STATES.COMPLETED; // In cooldown, basically completed
      }
      return STATES.IDLE;
    }

    // Generating is true (Stop button visible)
    if (thinking) {
      return STATES.THINKING; // Pro model thinking
    }

    // Check if assistant text is growing (writing)
    if (currentAssistantText.length > 0 && currentAssistantText !== lastAssistantText) {
      return STATES.WRITING;
    }

    return STATES.GENERATING; // Generic generating state
  }

  // State Machine

  function checkState() {
    if (!isMonitoring) return;

    const generating = isGenerating();
    const currentAssistantText = getAssistantText();

    // Report detailed state change
    const detailedState = determineDetailedState();
    reportStateChange(detailedState);

    // Transition: was generating -> not generating
    if (wasGenerating && !generating) {
      // Only treat this as a "completion" if we observed a generation start while monitoring.
      // This prevents false positives on page refresh where a transient "Stop" UI can appear
      // even though no new response was generated.
      if (generationStartTime) {
        // Start cooldown - wait for text to stabilize
        startCooldown();
      } else {
        console.log('[ChatGPT Notifier] Ignoring generating->idle transition (no observed generation start)');
      }
    }

    // Transition: not generating -> generating
    if (!wasGenerating && generating) {
      // Cancel any pending cooldown
      cancelCooldown();
      generationStartTime = Date.now();
      console.log('[ChatGPT Notifier] Generation started');
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

    // Report completed state
    reportStateChange(STATES.COMPLETED);

    // Send message to background script
    safeSendMessage({
      type: 'GENERATION_COMPLETE',
      preview: preview,
      duration: duration
    });

    // After a short delay, transition to idle if nothing new starts
    setTimeout(() => {
      if (!isGenerating() && currentState === STATES.COMPLETED) {
        reportStateChange(STATES.IDLE);
      }
    }, 3000);
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
    } else if (message.type === 'GET_CONTENT_STATE') {
      // Return current detailed state for background to query
      sendResponse({
        state: currentState,
        isMonitoring: isMonitoring,
        isGenerating: isGenerating()
      });
    }
    return true; // Keep channel open for async response
  });

  // Initialize - check if we should be monitoring (in case of page refresh)
  safeSendMessage({ type: 'GET_TAB_STATE' }).then(response => {
    if (response && response.isMonitored) {
      startMonitoring();
    }
  });

  console.log('[ChatGPT Notifier] Content script loaded');
})();
