# <img src="public/icon/128.png" alt="" height="32"> Skim

Skim reads a YouTube video's transcript, writes a structured summary of it, and
answers your follow-up questions about what the video says — so you do not have
to watch it.

A Chrome extension (Manifest V3). It has no server of its own and resells no
subscription: it talks straight to the AI provider you choose, with the API key
you provide, and you are billed by that provider for what you use.

## Status

Not on the Chrome Web Store yet — the first submission is pending review. Until
then, [build it from source](#build-it-yourself); the result is a normal
unpacked extension.

## What it does

- Summarize the open video in one click, from the YouTube page or from the
  toolbar.
- Ask follow-up questions, answered from what the video actually says.
- Choose the language of your summaries, independently of the video's language
  and of the interface language (French and English).
- Write your own summarizing instructions and save them as profiles: a short
  format for news, a detailed one for a conference talk.
- Reopen a video already processed and get its summary back without spending a
  second call.

Supported providers: Google Gemini, OpenAI, Anthropic, DeepSeek, OpenRouter and
OpenCode Zen. OpenRouter can also be connected by signing in, instead of pasting
a key by hand.

## How it works

The transcript is read from YouTube's own transcript panel, by a content script
running in the page. That is the only path that works: the `timedtext` endpoint
requires an anti-bot attestation token and returns an empty body without it. A
video that offers no transcript cannot be summarized, whatever the provider.

The transcript, the video's metadata and your prompt then go to the one provider
you configured, with your own key. Nothing else leaves the machine — there is no
backend to send it to.

Your keys, settings and prompt profiles live in `chrome.storage.local`. Your
conversations live in `chrome.storage.session`, so closing the browser deletes
them.

## Privacy

No server, no analytics, no telemetry, no tracker, no cookie. The full statement
of what is stored and what is sent is in [PRIVACY.md](PRIVACY.md).

## Build it yourself

```sh
npm ci
npm run build     # unpacked extension in .output/chrome-mv3
```

Then load it: `chrome://extensions` → enable Developer mode → *Load unpacked* →
pick `.output/chrome-mv3`.

```sh
npm test          # Vitest
npm run typecheck # tsc --noEmit
npm run dev       # WXT dev server, rebuilds on save
```

### Verifying a published version

Every published version is a tag here. Check one out with a clean worktree and
the build recognises itself as that release: the manifest carries
`version: X.Y.Z` and no `version_name`, and no branch, sha or timestamp ships
inside the bundle.

Any other checkout — an untagged commit, or a modified worktree — produces a dev
build instead, which stamps its provenance into `version_name`. So the manifest
of a build tells you which of the two you are holding.

## Layout

| Path | Role |
| --- | --- |
| `entrypoints/background.ts` | Service worker. Routes messages, owns the in-flight guard, emits stream events. |
| `entrypoints/youtube.content.ts` | Content script. Reads the transcript panel and the video metadata; injects the summarize button. |
| `entrypoints/sidepanel/` | React side panel: summary, follow-up conversation, errors. |
| `entrypoints/options/` | React options page: providers, keys, profiles, languages, data. |
| `lib/` | Every decision worth testing. Pure modules, no `chrome.*` at import time. |
| `lib/llm/` | Provider adapters, SSE streaming, effort levels. |

Tests sit next to the code they cover, under `lib/`.

## About this repository

This is the published source of Skim. It is mirrored from a private development
repository, one commit per release, so its history is the release history rather
than the day-to-day one.

A handful of comments cite measurements made against a benchmark corpus that
stays upstream, so they name files you will not find here. The number they carry
is the point; the corpus is a few megabytes of YouTube transcripts.

Issues and questions are welcome here. Pull requests are read and appreciated,
but cannot be merged into a mirror: a change lands upstream and comes back with
the next release.

## Support

Skim is free and takes no cut of anything: you pay your AI provider directly,
for what you use, and nothing reaches me. If it saves you time:

<a href="https://buymeacoffee.com/robin974"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="60"></a>

## License

[GPL-3.0-only](LICENSE). You may use, study, modify and redistribute Skim; a
redistributed version, modified or not, must carry the same license and offer
its source.
