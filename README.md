# ChatGPT Completion Notifier

Chrome extension that notifies you when ChatGPT finishes generating a response. Get a sound alert and desktop notification so you can switch tabs while waiting.

## Features

- 🔔 **Sound alert** when response completes
- 💬 **Desktop notifications** with response preview
- ⚡ **Auto-monitoring** - automatically watches ChatGPT tabs
- ⏱️ **Badge indicator** showing generation duration
- 🌙 **Dark mode** support (follows system theme)
- ⚙️ **Configurable** - adjust volume, preview length, detection timing

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extension folder
5. Open [ChatGPT](https://chatgpt.com) - monitoring starts automatically

## How It Works

The extension watches for ChatGPT's "Stop" button. When it disappears and the response text stabilizes (configurable delay), you get notified. Works with both regular ChatGPT and Pro models that have extended thinking phases.

## Settings

Click the extension icon to configure:

| Setting | Description |
|---------|-------------|
| Sound | Enable/disable audio alert |
| Volume | Adjust alert volume |
| Notifications | Enable/disable desktop notifications |
| Preview | Characters to show in notification (0-200) |
| Auto-monitor | Automatically watch new ChatGPT tabs |
| Detection delay | Wait time before confirming completion |
| Badge | Show duration, indicator, or nothing |

## Privacy

This extension:

- Runs entirely locally
- Does not collect or transmit any data
- Only activates on `chatgpt.com` and `chat.openai.com`
- Source code is fully available for review
