/**
 * Whisper transcript provider - downloads YouTube audio, transcribes via OpenAI.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import { Cookie, CookieJar } from "tough-cookie";
import type { TranscriptResult } from "./types";

const MODERN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getExtFromMime(mime: string | undefined): string {
  if (!mime) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  return "webm";
}

function getMimeFromExt(ext: string): string {
  switch (ext) {
    case "m4a":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    default:
      return "audio/webm";
  }
}

interface YtdlVideoInfo {
  formats?: Array<{
    url?: string;
    mimeType?: string;
    hasVideo?: boolean;
    hasAudio?: boolean;
  }>;
  full?: boolean;
}

type YtdlDownloadOptions = {
  quality: string;
  agent?: unknown;
  requestOptions?: { headers?: Record<string, string> };
};

type YtdlApi = {
  getInfo: (url: string, opts?: { agent?: unknown; requestOptions?: Record<string, unknown> }) => Promise<YtdlVideoInfo>;
  chooseFormat: (formats: unknown, opts: { quality: string }) => { url?: string; mimeType?: string };
  downloadFromInfo?: (info: YtdlVideoInfo, opts: YtdlDownloadOptions) => NodeJS.ReadableStream;
  createAgent?: (cookies?: unknown[], opts?: { cookies?: { jar: CookieJar } }) => unknown;
};

async function buildYtdlAgent(): Promise<unknown | null> {
  const mod = await import("@distube/ytdl-core");
  const ytdl = (mod as unknown as { default?: { createAgent?: (c?: unknown[], o?: object) => unknown } }).default ?? mod;
  const createAgent = (ytdl as { createAgent?: (c?: unknown[], o?: object) => unknown }).createAgent;
  if (typeof createAgent !== "function") return null;

  const cookiesStr = (process.env.YTDL_COOKIES ?? "").trim();
  if (!cookiesStr) {
    return createAgent();
  }

  try {
    const trimmed = cookiesStr.trim();
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed) as Array<{ name?: string; value?: string }>;
      if (Array.isArray(arr) && arr.length > 0) {
        return createAgent(arr);
      }
    }
    const jar = new CookieJar();
    const parts = trimmed.split(";").map((s: string) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const c = Cookie.parse(part);
      if (c) jar.setCookieSync(c, "https://www.youtube.com");
    }
    return createAgent([], { cookies: { jar } });
  } catch {
    return createAgent();
  }
}

async function getYtdl(): Promise<YtdlApi | null> {
  try {
    const mod = await import("@distube/ytdl-core");
    const ytdl = (mod as unknown as { default?: YtdlApi }).default ?? mod;
    if (typeof ytdl?.getInfo !== "function" || typeof ytdl?.chooseFormat !== "function") {
      return null;
    }
    return {
      getInfo: ytdl.getInfo.bind(ytdl) as YtdlApi["getInfo"],
      chooseFormat: ytdl.chooseFormat.bind(ytdl) as YtdlApi["chooseFormat"],
        downloadFromInfo:
        typeof (ytdl as YtdlApi).downloadFromInfo === "function"
          ? (ytdl as YtdlApi).downloadFromInfo
          : undefined,
    };
  } catch {
    return null;
  }
}

function getRequestOptions(agent?: unknown): Record<string, unknown> {
  return {
    ...(agent != null ? { agent } : {}),
    requestOptions: {
      headers: {
        "User-Agent": MODERN_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  };
}

async function getVideoInfo(
  url: string,
  ytdl: YtdlApi,
  opts: { agent?: unknown; requestOptions?: Record<string, unknown> }
): Promise<{ info: YtdlVideoInfo } | { error: string }> {
  try {
    const info = await ytdl.getInfo(url, opts);
    return { info };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function chooseBestAudioFormat(
  info: YtdlVideoInfo
): { url: string; mimeType?: string } | null {
  const formats = info.formats ?? [];
  const withUrl = formats.filter(
    (f) => typeof f?.url === "string" && f.url.length > 0
  );
  const audioOnly = withUrl.filter(
    (f) => f.hasAudio && !f.hasVideo && f.mimeType
  );
  const audioAny = withUrl.filter((f) => f.hasAudio && f.mimeType);
  const candidates = audioOnly.length > 0 ? audioOnly : audioAny;
  const best = candidates[0];
  if (!best?.url) return null;
  return { url: best.url, mimeType: best.mimeType };
}

function errResult(
  error: string,
  reason: TranscriptResult["reason"] = "whisper_error"
): TranscriptResult {
  return {
    provider: "none",
    text: null,
    truncated: false,
    error,
    reason,
  };
}

export async function transcribeYouTubeWithWhisper(params: {
  videoUrl: string;
  maxChars: number;
}): Promise<TranscriptResult> {
  const { videoUrl, maxChars } = params;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.WHISPER_MODEL ?? "whisper-1";

  if (!apiKey) {
    return errResult("OPENAI_API_KEY not set");
  }

  const ytdl = await getYtdl();
  if (!ytdl) {
    return errResult(
      "ytdl-core: getInfo/chooseFormat not available (ESM interop)",
      "whisper_error"
    );
  }

  const agent = await buildYtdlAgent();
  const requestOpts = getRequestOptions(agent ?? undefined);

  const tmpDir = path.join(os.tmpdir(), "competitor-analysis");
  const prefix = `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await fs.promises.mkdir(tmpDir, { recursive: true });
  } catch (e) {
    return errResult(
      `Failed to create temp dir: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let tmpFile: string | null = null;

  try {
    const result = await getVideoInfo(videoUrl, ytdl, {
      agent: agent ?? undefined,
      ...requestOpts,
    });
    if ("error" in result) {
      return errResult(result.error, "whisper_error");
    }
    const info = result.info;

    let format = chooseBestAudioFormat(info);
    if (!format) {
      try {
        const chosen = ytdl.chooseFormat(info.formats ?? [], {
          quality: "lowestaudio",
        });
        if (chosen?.url) format = { url: chosen.url, mimeType: chosen.mimeType };
      } catch {
        /* ignore */
      }
    }

    if (!format?.url) {
      return errResult("No audio format available", "whisper_error");
    }

    const ext = getExtFromMime(format.mimeType);
    tmpFile = path.join(tmpDir, `${prefix}.${ext}`);

    if (ytdl.downloadFromInfo && info.full) {
      const downloadOpts: YtdlDownloadOptions = {
        quality: "lowestaudio",
        ...(agent != null ? { agent } : {}),
        ...(requestOpts.requestOptions
          ? { requestOptions: requestOpts.requestOptions as Record<string, string> }
          : {}),
      };
      const stream = ytdl.downloadFromInfo(info, downloadOpts);
      const writeStream = fs.createWriteStream(tmpFile);
      try {
        await pipeline(stream, writeStream);
      } catch (pipeErr: unknown) {
        const msg = pipeErr instanceof Error ? pipeErr.message : String(pipeErr);
        const is403 = /403|Status code: 403/i.test(msg);
        return errResult(
          is403
            ? "403 from YouTube while downloading audio; try setting YTDL_COOKIES"
            : msg,
          "whisper_error"
        );
      }
    } else {
      const res = await fetch(format.url);
      if (!res.ok) {
        const hint =
          res.status === 403
            ? "403 from YouTube while downloading audio; try setting YTDL_COOKIES"
            : `Audio fetch failed: ${res.status}`;
        return errResult(hint, "whisper_error");
      }
      const arrayBuffer = await res.arrayBuffer();
      await fs.promises.writeFile(tmpFile, Buffer.from(arrayBuffer));
    }

    const fileBuffer = await fs.promises.readFile(tmpFile);
    const mime = getMimeFromExt(ext);
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mime });
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", model);

    const uploadRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return errResult(
        `Whisper API error: ${uploadRes.status} - ${errText.slice(0, 200)}`
      );
    }

    const json = (await uploadRes.json()) as { text?: string };
    let raw = (json.text ?? "").trim();

    if (!raw) {
      return errResult("Empty transcription");
    }

    const truncated = raw.length > maxChars;
    const text = truncated ? raw.slice(0, maxChars) : raw;

    return {
      provider: "whisper",
      text,
      truncated,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const is403 = /403|Status code: 403/i.test(msg);
    return errResult(
      is403 ? "403 from YouTube while downloading audio; try setting YTDL_COOKIES" : msg,
      "whisper_error"
    );
  } finally {
    if (tmpFile) {
      try {
        await fs.promises.unlink(tmpFile);
      } catch {
        /* ignore */
      }
    }
  }
}
