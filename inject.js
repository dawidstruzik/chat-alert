// ChatGPT Completion Notifier - Fetch Interceptor
// Runs in MAIN world to intercept fetch requests and extract timestamps

(function() {
  'use strict';

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    // Check if this is a conversation API call
    const url = args[0]?.toString() || '';
    if (url.includes('/backend-api/conversation/') && !url.includes('/generation')) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        console.log('[ChatGPT Notifier] Intercepted API response:', url, 'update_time:', data.update_time);
        if (data.update_time) {
          // Send timestamp to content script via postMessage
          window.postMessage({
            type: 'CHATGPT_NOTIFIER_TIMESTAMP',
            updateTime: data.update_time * 1000  // Convert to ms
          }, '*');
          console.log('[ChatGPT Notifier] Posted timestamp:', new Date(data.update_time * 1000).toLocaleString());
        }
      } catch (e) {
        console.log('[ChatGPT Notifier] Failed to parse API response:', url, e.message);
      }
    }
    return response;
  };

  console.log('[ChatGPT Notifier] Fetch interceptor installed');
})();
