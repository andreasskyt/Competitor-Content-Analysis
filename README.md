# YouTube Competitor Content Analyzer

Minimal MVP for analyzing competitor YouTube channels: fetch top videos, transcripts, run LLM analysis, and generate a downloadable JSON report.

## Features

- Input 1–5 YouTube channels (URL or Channel ID)
- Fetch top N videos per channel (last 90 days)
- Transcripts: captions (stub) or Whisper fallback
- Per-video analysis: hook, power words, theme, format, CTA
- Aggregate report: winning patterns, top hooks, CTA patterns, content ideas

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in:

```env
YOUTUBE_API_KEY=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
WHISPER_MODEL=whisper-1
BASE_URL=http://localhost:3000
```

### How to get YOUTUBE_API_KEY

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Enable **YouTube Data API v3**
4. Create credentials → API key
5. (Recommended) Restrict the key to YouTube Data API v3

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Transcript providers

- **NoAuthTranscriptProvider**: Stub for captions API. Returns `null` (captions often require OAuth/owner access). Code path kept for future implementation.
- **WhisperTranscriptProvider**: Downloads audio via ytdl-core, sends to OpenAI Whisper. Reliable fallback.

The MVP works with **Whisper-only** when captions are unavailable.

## Cost controls

- `topN` (default 5): Videos per channel
- `whisperTopK` (default 5): Max videos for Whisper across all channels
- Transcript cap: 4000 characters per video
- Use `gpt-4o-mini` for cheaper LLM analysis

## Output

JSON file at `/jobs/<jobId>.json` with:

- `job`, `sources`, `items` (per-video data + analysis)
- `report`: top videos, winning patterns, top hooks, CTA patterns, content formats, 20 content ideas, key takeaway

## Limitations

- In-memory job store (no persistence across restarts)
- Captions via API require OAuth for many videos; MVP uses Whisper
- ytdl-core may fail on age-restricted or region-locked videos
