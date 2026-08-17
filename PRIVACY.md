# Privacy policy — Skim

Last updated: 17 August 2026

Skim summarises a YouTube video and lets you ask questions about it. The
extension has no server of its own: it talks straight to the AI provider you
choose, with the API key you provide.

## What is stored on your device

Everything is kept locally, in the extension's storage, and nothing is synced to
a Google account:

- **your API keys**, one per provider;
- **your settings**: active provider, model, summary language, interface
  language;
- **your prompt profiles**, including the ones you write yourself;
- **your conversations**: the summary produced for a video and the questions you
  asked afterwards.

The first three are kept until you delete them. Conversations only live for the
duration of the browser session: they are what the panel's tab bar shows,
closing a tab deletes the matching summary, and closing the browser deletes them
all.

This data leaves your device only towards the AI provider, as described below.

## What is sent, and to whom

When you ask for a summary, the extension sends **to the single AI provider you
chose**:

- the video's transcript, read from YouTube's transcript panel;
- the video's title, channel, description and duration;
- your prompt, then your follow-up questions.

It is sent with your own API key. Your data therefore passes through the
provider you chose and is subject to that provider's privacy policy:

- [Google (Gemini API)](https://ai.google.dev/gemini-api/terms)
- [OpenAI](https://openai.com/policies/privacy-policy)
- [Anthropic](https://www.anthropic.com/legal/privacy)
- [DeepSeek](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [OpenRouter](https://openrouter.ai/privacy)
- [OpenCode Zen](https://opencode.ai/docs/zen/)

**Signing in with OpenRouter.** If you connect an OpenRouter account rather than
pasting a key, an OpenRouter authorisation window opens and the extension
exchanges the resulting code for an API key, with OpenRouter and no one else.
That key is then stored like any other, on your device.

**Tab thumbnails.** Each tab in the panel shows its video's thumbnail, loaded
from YouTube's image server (`i.ytimg.com`). It is an ordinary image request,
carrying the id of a video you have just watched and nothing else: no key, no
setting, no summary content. Nothing beyond that is sent to Google.

## What is never done

- No data is sent to a server belonging to the extension: there is none.
- No analytics, no telemetry, no tracker, no cookie.
- No data is sold, nor shared with any third party other than the AI provider
  you chose.
- No data is used for anything unrelated to running the extension.
- The extension reads no page outside YouTube.

## Retention and deletion

Your data stays on your device until you delete it.

- The **Data** tab of the options page erases your API keys and resets every
  setting.
- Uninstalling the extension deletes its storage in full.

What the AI provider keeps on its side is governed by its own policy, linked
above.

## Changes

Any change to these practices will be published as an update to this document,
at the same address, carrying its own update date.

## Contact

For any question about privacy: skimai.extension@gmail.com
