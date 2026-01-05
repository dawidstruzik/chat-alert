// Offscreen document for audio playback
// Service workers can't play audio directly, so we use this offscreen document

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PLAY_SOUND') {
    const soundFile = message.sound || 'chime';
    const audio = new Audio(`sounds/${soundFile}.mp3`);
    // Apply volume from settings (0.0 - 1.0)
    if (typeof message.volume === 'number') {
      audio.volume = Math.max(0, Math.min(1, message.volume));
    }
    audio.play().catch(err => {
      console.error('[ChatGPT Notifier] Failed to play sound:', err);
    });
  }
});
