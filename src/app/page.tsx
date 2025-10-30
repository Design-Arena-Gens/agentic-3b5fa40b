"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";
import type { IndiaUpdate } from "./api/india-news/route";

const MIN_VIDEO_DURATION_SECONDS = 240;
const FALLBACK_SLIDE_DURATION = 40;
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FFMPEG_CORE_URL =
  "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js";

type FFmpegInstance = ReturnType<typeof createFFmpeg>;

export default function Home() {
  const [updates, setUpdates] = useState<IndiaUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narration, setNarration] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const ffmpegRef = useRef<FFmpegInstance | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const totalDuration = useMemo(() => {
    if (updates.length === 0) {
      return 0;
    }
    const perSlide = Math.max(
      Math.ceil(MIN_VIDEO_DURATION_SECONDS / updates.length),
      FALLBACK_SLIDE_DURATION,
    );
    return perSlide * updates.length;
  }, [updates.length]);

  const fetchUpdates = async () => {
    setLoadingUpdates(true);
    setError(null);
    try {
      const response = await fetch("/api/india-news");
      if (!response.ok) {
        throw new Error("Unable to fetch updates right now.");
      }
      const payload = (await response.json()) as { items: IndiaUpdate[] };

      if (!payload.items || payload.items.length === 0) {
        throw new Error("No fresh updates available. Try again shortly.");
      }

      setUpdates(payload.items);
      const generatedNarration = buildNarration(payload.items);
      setNarration(generatedNarration);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Unexpected error while fetching updates.",
      );
    } finally {
      setLoadingUpdates(false);
    }
  };

  const ensureFFmpeg = async () => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    const instance = createFFmpeg({
      log: true,
      corePath: FFMPEG_CORE_URL,
    });

    instance.setLogger(({ message }) => {
      if (!isMountedRef.current) {
        return;
      }
      setLogs((prev) => {
        const next = [...prev, message];
        return next.slice(-120);
      });
    });

    await instance.load();
    ffmpegRef.current = instance;
    return instance;
  };

  const handleGenerateVideo = async () => {
    if (updates.length === 0) {
      setError("Fetch the latest India updates before generating a video.");
      return;
    }
    setIsGenerating(true);
    setError(null);
    setLogs([]);

    try {
      const ffmpeg = await ensureFFmpeg();

      const perSlideDuration = Math.max(
        Math.ceil(MIN_VIDEO_DURATION_SECONDS / updates.length),
        FALLBACK_SLIDE_DURATION,
      );
      const finalDuration = perSlideDuration * updates.length;

      // Prepare slides
      const slideNames: string[] = [];
      for (let index = 0; index < updates.length; index += 1) {
        const update = updates[index];
        const slideName = `slide-${index}.png`;
        const slideData = await renderSlide(update, index, updates.length);
        await ffmpeg.FS("writeFile", slideName, slideData);
        slideNames.push(slideName);
      }

      // Build concat playlist
      const concatScript = buildConcatScript(slideNames, perSlideDuration);
      await ffmpeg.FS(
        "writeFile",
        "slides.txt",
        new TextEncoder().encode(concatScript),
      );

      // Generate silent audio
      const silence = generateSilenceWav(finalDuration);
      await ffmpeg.FS("writeFile", "silence.wav", silence);

      // Render final video
      await ffmpeg.run(
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "slides.txt",
        "-i",
        "silence.wav",
        "-shortest",
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "output.mp4",
      );

      const data = ffmpeg.FS("readFile", "output.mp4");
      const videoBuffer = data.buffer as ArrayBuffer;
      const url = URL.createObjectURL(
        new Blob([videoBuffer], { type: "video/mp4" }),
      );

      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      setVideoUrl(url);
      setVideoDuration(finalDuration);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while generating the video.",
      );
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-4 rounded-3xl bg-white/5 p-8 shadow-2xl shadow-sky-500/20 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.6em] text-sky-300">
                Autonomous Studio
              </p>
              <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
                India Pulse – YouTube News Reel Generator
              </h1>
            </div>
            <button
              onClick={fetchUpdates}
              disabled={loadingUpdates || isGenerating}
              className="rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-sky-500/60"
            >
              {loadingUpdates ? "Refreshing..." : "Fetch Latest Updates"}
            </button>
          </div>
          <p className="max-w-3xl text-sm text-slate-300">
            Pull today&apos;s biggest headlines from r/india, autogenerate a
            four-minute news narrative, and compile a ready-to-upload YouTube
            video complete with smooth broadcast visuals.
          </p>
          {error && (
            <p className="rounded-lg border border-red-500/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <article className="flex flex-col gap-6 rounded-3xl bg-white/5 p-6 shadow-xl shadow-sky-700/10">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold text-white">
                Bulletin Board
              </h2>
              <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-4 py-1 text-xs uppercase tracking-[0.4em] text-sky-200">
                {updates.length > 0 ? `${updates.length} stories` : "Idle"}
              </span>
            </div>
            <div className="grid gap-4">
              {updates.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
                  Tap &ldquo;Fetch Latest Updates&rdquo; to populate the news
                  stack with today&apos;s trendline across India.
                </div>
              )}
              {updates.map((update, index) => (
                <UpdateCard key={update.id} update={update} index={index} />
              ))}
            </div>
          </article>

          <article className="flex h-full flex-col gap-6 rounded-3xl bg-white/5 p-6 shadow-xl shadow-sky-700/10">
            <header className="space-y-1">
              <h2 className="text-2xl font-semibold text-white">
                Narration Draft
              </h2>
              <p className="text-xs uppercase tracking-[0.5em] text-slate-400">
                Editable Voiceover Script
              </p>
            </header>
            <textarea
              value={narration}
              onChange={(event) => setNarration(event.target.value)}
              rows={16}
              placeholder="Your narration script will appear here for quick edits."
              className="flex-1 rounded-2xl border border-transparent bg-slate-900/60 px-4 py-3 text-sm leading-6 text-slate-100 shadow-inner shadow-black/50 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            />
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span className="rounded-full border border-slate-700 px-3 py-1">
                  Target length · 4+ minutes
                </span>
                {totalDuration > 0 && (
                  <span className="rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-1 text-sky-100">
                    Current cut · {Math.round(totalDuration / 60)} min{" "}
                    {totalDuration % 60} sec
                  </span>
                )}
              </div>
              <button
                onClick={handleGenerateVideo}
                disabled={isGenerating || updates.length === 0}
                className="rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:from-sky-300 hover:via-blue-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? "Rendering master..." : "Generate YouTube Cut"}
              </button>
              {videoUrl && (
                <div className="flex flex-col gap-2 rounded-2xl border border-sky-400/40 bg-slate-900/60 p-4 text-sm text-sky-100">
                  <p className="font-medium text-white">
                    Final Render Ready · {formatDuration(videoDuration)}
                  </p>
                  <a
                    href={videoUrl}
                    download="india-pulse-news.mp4"
                    className="inline-flex w-fit items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow shadow-sky-500/40 transition hover:bg-sky-400"
                  >
                    Download MP4
                  </a>
                  <p className="text-xs text-slate-400">
                    Upload directly to your YouTube channel. The file includes a
                    silent audio track to satisfy platform requirements; layer
                    your own voiceover in your preferred editor if desired.
                  </p>
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="grid gap-6 rounded-3xl bg-white/5 p-6 shadow-xl shadow-sky-800/10">
          <h2 className="text-lg font-semibold text-white">
            Encoder Console
          </h2>
          <div className="h-48 overflow-y-auto rounded-2xl bg-slate-950/70 p-4 text-xs font-mono text-sky-200">
            {logs.length === 0 ? (
              <p className="text-slate-500">Awaiting render pipeline events…</p>
            ) : (
              logs.map((line, index) => (
                <p key={index} className="whitespace-pre-wrap">
                  {line}
                </p>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function UpdateCard({ update, index }: { update: IndiaUpdate; index: number }) {
  const postedAt = useMemo(
    () =>
      new Date(update.postedAt).toLocaleString("en-IN", {
        hour12: true,
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }),
    [update.postedAt],
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-inner shadow-black/40">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.45em] text-slate-500">
        <span>Headliner {index + 1}</span>
        <span>{postedAt}</span>
      </div>
      <h3 className="text-xl font-semibold text-white">{update.title}</h3>
      <p className="text-sm leading-relaxed text-slate-300">{update.summary}</p>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="rounded-full border border-slate-700 px-3 py-1">
          Author · {update.author}
        </span>
        <span className="rounded-full border border-slate-700 px-3 py-1">
          Upvote ratio · {(update.stats.upvoteRatio * 100).toFixed(0)}%
        </span>
        <span className="rounded-full border border-slate-700 px-3 py-1">
          Comments · {update.stats.comments}
        </span>
        <a
          href={update.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-sky-500/60 px-3 py-1 text-sky-200 transition hover:bg-sky-500/20"
        >
          Source thread ↗
        </a>
      </div>
    </div>
  );
}

async function renderSlide(
  update: IndiaUpdate,
  index: number,
  total: number,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to initialise canvas rendering context.");
  }

  // Background gradient
  const gradient = context.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  gradient.addColorStop(0, "#050C1A");
  gradient.addColorStop(0.55, "#0B2659");
  gradient.addColorStop(1, "#122B61");
  context.fillStyle = gradient;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Overlay
  context.fillStyle = "rgba(6, 14, 48, 0.45)";
  context.fillRect(80, 80, CANVAS_WIDTH - 160, CANVAS_HEIGHT - 160);

  // Frame border
  context.strokeStyle = "rgba(56, 189, 248, 0.6)";
  context.lineWidth = 6;
  context.strokeRect(80, 80, CANVAS_WIDTH - 160, CANVAS_HEIGHT - 160);

  // Slide meta
  context.fillStyle = "rgba(56, 189, 248, 0.9)";
  context.font = "bold 36px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  context.fillText(
    `Update ${index + 1} of ${total}`,
    120,
    150,
  );

  context.fillStyle = "rgba(226,232,240,0.9)";
  context.font = "bold 64px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  drawWrappedText(context, update.title, 120, 230, CANVAS_WIDTH - 240, 72, 3);

  context.fillStyle = "rgba(148, 163, 184, 0.95)";
  context.font = "28px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  const nextY = drawWrappedText(
    context,
    update.summary,
    120,
    420,
    CANVAS_WIDTH - 240,
    44,
    6,
  );

  context.fillStyle = "rgba(94,234,212,0.9)";
  context.font = "24px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  const footY = Math.max(nextY + 40, CANVAS_HEIGHT - 140);
  const postedAt = new Date(update.postedAt).toLocaleString("en-IN", {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  context.fillText(
    `Source · reddit.com${new URL(update.url).pathname} · Posted ${postedAt}`,
    120,
    footY,
  );

  context.fillStyle = "rgba(148, 163, 184, 0.8)";
  context.font = "22px 'IBM Plex Sans', 'Segoe UI', sans-serif";
  context.fillText(
    "Generated by India Pulse • Refresh daily for new stories",
    120,
    footY + 46,
  );

  const dataUrl = canvas.toDataURL("image/png");
  return fetchFile(dataUrl);
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const { width } = context.measureText(testLine);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  let truncated = lines;
  if (lines.length > maxLines) {
    truncated = lines.slice(0, maxLines);
    const last = truncated[truncated.length - 1];
    truncated[truncated.length - 1] = `${last.replace(/[.·]+$/, "")}…`;
  }

  truncated.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });

  return y + truncated.length * lineHeight;
}

function buildNarration(items: IndiaUpdate[]) {
  return items
    .map((item, index) => {
      const postedAt = new Date(item.postedAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      });
      return `Story ${index + 1}: ${item.title}.
${item.summary}
Published by ${item.author} on ${postedAt}.`;
    })
    .join("\n\n");
}

function buildConcatScript(slideNames: string[], durationSeconds: number) {
  const body = slideNames
    .map(
      (name) =>
        `file '${name}'
duration ${durationSeconds}`,
    )
    .join("\n");
  const last = slideNames[slideNames.length - 1];
  return `${body}
file '${last}'`;
}

function generateSilenceWav(durationSeconds: number) {
  const sampleRate = 44100;
  const channels = 1;
  const bytesPerSample = 2;
  const totalSamples = durationSeconds * sampleRate;
  const dataLength = totalSamples * bytesPerSample * channels;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function formatDuration(durationSeconds: number | null) {
  if (!durationSeconds || Number.isNaN(durationSeconds)) {
    return "4 min runtime";
  }
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} sec`;
}
