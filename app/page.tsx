"use client";

import { useState, useCallback, useEffect } from "react";

const POLL_INTERVAL_MS = 2000;

interface JobOutput {
  job?: unknown;
  summary?: unknown;
  sources?: unknown;
  items?: Array<{ url?: string; title?: string; stats?: { views?: number }; analysis?: { hook?: string } }>;
  report?: {
    top_videos?: Array<{ title?: string; views?: number }>;
    winning_patterns?: string[];
    top_hooks?: string[];
    content_ideas?: string[];
  };
}
const TOP_N_MIN = 1;
const TOP_N_MAX = 20;
const LOOKBACK_DAYS_MIN = 7;
const LOOKBACK_DAYS_MAX = 365;
const WHISPER_TOP_K_MIN = 0;
const WHISPER_TOP_K_MAX = 20;
const MAX_CHANNELS = 5;

interface JobStatusResponse {
  status: string;
  progress?: { step: string; pct: number };
  downloadUrl?: string;
  error?: string;
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

export default function Home() {
  const [channels, setChannels] = useState("");
  const [topN, setTopN] = useState(5);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [whisperFallback, setWhisperFallback] = useState(true);
  const [whisperTopK, setWhisperTopK] = useState(5);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: string; pct: number } | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [jobResult, setJobResult] = useState<JobOutput | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setJobId(null);
    setStatus(null);
    setProgress(null);
    setDownloadUrl(null);
    setError(null);
    setLoading(false);
    setCopySuccess(false);
    setJobResult(null);
    setPreviewError(null);
  }, []);

  useEffect(() => {
    if (status !== "done" || !downloadUrl) return;
    setPreviewError(null);
    fetch(downloadUrl)
      .then((r) => r.json())
      .then((data: JobOutput) => setJobResult(data))
      .catch(() => setPreviewError("Could not load preview"));
  }, [status, downloadUrl]);

  const runAnalysis = async () => {
    const lines = channels
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setError("At least one channel is required");
      return;
    }
    if (lines.length > MAX_CHANNELS) {
      setError(`Maximum ${MAX_CHANNELS} channels allowed`);
      return;
    }

    const topNClamped = clamp(topN, TOP_N_MIN, TOP_N_MAX);
    const lookbackClamped = clamp(lookbackDays, LOOKBACK_DAYS_MIN, LOOKBACK_DAYS_MAX);
    const whisperTopKClamped = clamp(
      whisperFallback ? whisperTopK : 0,
      WHISPER_TOP_K_MIN,
      WHISPER_TOP_K_MAX
    );

    setLoading(true);
    setError(null);
    setJobId(null);
    setDownloadUrl(null);
    setStatus(null);
    setProgress(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: lines,
          topN: topNClamped,
          lookbackDays: lookbackClamped,
          whisperFallback,
          whisperTopK: whisperTopKClamped,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start job");
      }

      const id = data.jobId;
      setJobId(id);

      let pollCount = 0;
      const poll = async () => {
        const r = await fetch(`/api/jobs/${id}`);
        if (r.status === 404 && pollCount < 2) {
          pollCount += 1;
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        if (!r.ok && r.status !== 404) {
          setError(`Request failed: ${r.status}`);
          setLoading(false);
          return;
        }
        const d: JobStatusResponse = await r.json();
        if (r.status === 404) {
          setError(d.error ?? "Job not found");
          setLoading(false);
          return;
        }
        pollCount += 1;
        setStatus(d.status);
        setProgress(d.progress ?? null);
        setError(d.error ?? null);
        if (d.downloadUrl) setDownloadUrl(d.downloadUrl);

        if (d.downloadUrl || d.status === "failed") {
          setLoading(false);
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      };
      poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  const copyDownloadUrl = async () => {
    if (!downloadUrl) return;
    try {
      await navigator.clipboard.writeText(downloadUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const hasJobOutput = jobId && (status || downloadUrl);
  const topVideos = (jobResult?.items ?? [])
    .sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0))
    .slice(0, 10);
  const topHooks = (jobResult?.items ?? [])
    .filter((i) => i.analysis?.hook)
    .sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0))
    .slice(0, 10);
  const winningPatterns = jobResult?.report?.winning_patterns ?? [];
  const contentIdeas = jobResult?.report?.content_ideas ?? [];

  const copyIdea = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>YouTube Competitor Content Analyzer</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        Paste YouTube channels (one per line), run analysis, and download the JSON report.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
          YouTube Channels (one per line)
        </label>
        <textarea
          value={channels}
          onChange={(e) => setChannels(e.target.value)}
          placeholder={"https://www.youtube.com/@MrBeast\nUCX6OQ3DkcsbYNE6H8uQQuVA"}
          rows={4}
          style={{
            width: "100%",
            padding: 8,
            borderRadius: 6,
            border: "1px solid #ccc",
            boxSizing: "border-box",
          }}
        />
        <p style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
          Accepts channel ID or channel URL
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            topN
          </label>
          <input
            type="number"
            min={TOP_N_MIN}
            max={TOP_N_MAX}
            value={topN}
            onChange={(e) => setTopN(clamp(Number(e.target.value) || 5, TOP_N_MIN, TOP_N_MAX))}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
          <p style={{ fontSize: 11, color: "#888" }}>1–20</p>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontWeight: 500 }}>
            lookbackDays
          </label>
          <input
            type="number"
            min={LOOKBACK_DAYS_MIN}
            max={LOOKBACK_DAYS_MAX}
            value={lookbackDays}
            onChange={(e) =>
              setLookbackDays(clamp(Number(e.target.value) || 90, LOOKBACK_DAYS_MIN, LOOKBACK_DAYS_MAX))
            }
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
          <p style={{ fontSize: 11, color: "#888" }}>7–365</p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={whisperFallback}
            onChange={(e) => setWhisperFallback(e.target.checked)}
          />
          whisperFallback
        </label>
        {whisperFallback && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label>whisperTopK:</label>
            <input
              type="number"
              min={WHISPER_TOP_K_MIN}
              max={WHISPER_TOP_K_MAX}
              value={whisperTopK}
              onChange={(e) =>
                setWhisperTopK(clamp(Number(e.target.value) || 5, WHISPER_TOP_K_MIN, WHISPER_TOP_K_MAX))
              }
              style={{
                width: 56,
                padding: 6,
                borderRadius: 6,
                border: "1px solid #ccc",
              }}
            />
            <span style={{ fontSize: 11, color: "#888" }}>0–20</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={runAnalysis}
          disabled={loading}
          style={{
            padding: "10px 20px",
            background: loading ? "#999" : "#111",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Running…" : "Run Analysis"}
        </button>
        <button
          onClick={reset}
          disabled={loading}
          style={{
            padding: "10px 16px",
            background: "#eee",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: 6,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Reset
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "#fee",
            color: "#c00",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}

      {hasJobOutput && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: "#f5f5f5",
            borderRadius: 8,
          }}
        >
          {jobId && (
            <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              Job ID: <code style={{ background: "#e0e0e0", padding: "2px 6px" }}>{jobId}</code>
            </div>
          )}
          {status && (
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              Status: {status}
              {progress != null && ` (${progress.pct}%)`}
            </div>
          )}
          {progress != null && (
            <div style={{ marginBottom: 12, fontSize: 14, color: "#666" }}>
              {progress.step}
            </div>
          )}
          {downloadUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <a
                href={downloadUrl}
                download
                style={{
                  display: "inline-block",
                  padding: "8px 16px",
                  background: "#0a0",
                  color: "#fff",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                Download JSON
              </a>
              <button
                onClick={copyDownloadUrl}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  background: "#fff",
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                {copySuccess ? "Copied!" : "Copy download URL"}
              </button>
            </div>
          )}
          {previewError && (
            <p style={{ marginTop: 12, fontSize: 13, color: "#c60" }}>{previewError}</p>
          )}
          {jobResult && status === "done" && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #ddd" }}>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>Results Preview</h3>
              {topVideos.length > 0 && (
                <section style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Top Videos</h4>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {topVideos.map((item, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        <a
                          href={item.url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "#06c" }}
                        >
                          {item.title || "Untitled"}
                        </a>
                        {" — "}
                        {((item.stats?.views ?? 0) / 1000).toFixed(1)}K views
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {topHooks.length > 0 && (
                <section style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Top Hooks</h4>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {topHooks.map((item, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        {item.analysis?.hook}{" "}
                        <a
                          href={item.url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 12, color: "#06c" }}
                        >
                          Watch
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {winningPatterns.length > 0 && (
                <section style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                    Winning Patterns
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                    {winningPatterns.map((p, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {p}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {contentIdeas.length > 0 && (
                <section>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                    Content Ideas ({contentIdeas.length})
                  </h4>
                  <ul style={{ margin: 0, padding: 0, fontSize: 13, listStyle: "none" }}>
                    {contentIdeas.map((idea, i) => (
                      <li
                        key={i}
                        style={{
                          marginBottom: 8,
                          padding: 8,
                          background: "#fff",
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <span style={{ flex: 1 }}>{idea}</span>
                        <button
                          onClick={() => copyIdea(idea)}
                          style={{
                            padding: "4px 8px",
                            fontSize: 12,
                            background: "#eee",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
