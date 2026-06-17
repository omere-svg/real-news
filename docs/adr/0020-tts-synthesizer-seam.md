# ADR-0020: Text-to-speech behind a Synthesizer seam

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

The Telegram bot (ADR-0019) should deliver the podcast as a real audio file, not just the
script text. That needs text-to-speech. We already depend on OpenAI (ADR-0012/0018), which
exposes a speech API, and we want the same swappability and "degrade, don't crash" hygiene
as the other model seams.

## Decision

Add a **`Synthesizer`** seam — `synthesize(text) → audio bytes | null` — with an
**`OpenAITTS`** adapter (`audio.speech`, mp3). Wrap it in a **`ResilientSynthesizer`** that
returns `null` on any failure (ADR-0001 hygiene). The bot's podcast flow synthesizes the
narrated script; if it gets bytes it sends audio, otherwise it **falls back to sending the
script as text**. The synthesizer is optional — when no TTS is configured the bot simply
sends text.

## Consequences

- Completes the "audio podcast" half of the vision; the existing `narrate` (ADR-0014) still
  produces the script, TTS only voices it.
- A TTS outage degrades to a text podcast, never a failed reply.
- The seam keeps a fake in tests, so the bot's audio path is unit-tested without network.

## Alternatives considered

- **Local TTS (piper/coqui)** — offline, but heavy native deps and lower quality; the OpenAI
  key already exists.
- **No audio (text only)** — simpler, but the vision explicitly wants an audio podcast.
