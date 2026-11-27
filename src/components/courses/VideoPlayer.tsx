"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/exams/client";
import { courseFileUrl, type CourseItem, type ItemProgress } from "@/lib/exams/courses";
import { Notice, Spinner, type ExamLabels } from "@/components/exams/ExamShell";

type Report = (p: { percent: number; completed: boolean; positionSec: number }) => void;

/**
 * Collects the parts of a video that were actually played and sends them to the database, which merges
 * them. A jump (seeking) starts a new part, so skipping ahead is not counted as watched.
 */
function useWatchTracker(itemId: string, onProgress: Report) {
  const state = useRef({ current: null as [number, number] | null, done: [] as [number, number][], duration: 0, last: 0, sending: false });
  const report = useRef(onProgress);
  report.current = onProgress;

  const flush = useCallback(async () => {
    const s = state.current;
    const parts = [...s.done, ...(s.current && s.current[1] - s.current[0] >= 1 ? [s.current] : [])].map(([a, b]) => [Math.floor(a), Math.ceil(b)] as [number, number]);
    if (s.sending || !parts.length || s.duration < 1) return;
    s.sending = true;
    const kept = s.done;
    s.done = [];
    if (s.current) s.current = [s.current[1], s.current[1]];
    const position = Math.round(s.last);
    try {
      const r = await rpc<{ recorded: boolean; percent?: number; completed?: boolean }>("exam_content_watch", {
        p_id: itemId,
        p_ranges: parts.slice(-200),
        p_duration: Math.round(s.duration),
        p_position: position,
      });
      if (r.recorded) report.current({ percent: r.percent ?? 0, completed: !!r.completed, positionSec: position });
    } catch {
      s.done = [...kept, ...parts].slice(-200); // try again with the next report
    } finally {
      s.sending = false;
    }
  }, [itemId]);

  const tick = useCallback((time: number, duration: number) => {
    const s = state.current;
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    s.duration = duration;
    s.last = time;
    // up to 4 s between two readings is normal playback (even at double speed); more is a jump
    if (s.current && time >= s.current[1] - 1 && time - s.current[1] <= 4) s.current[1] = Math.max(s.current[1], time);
    else {
      if (s.current && s.current[1] - s.current[0] >= 1) s.done.push(s.current);
      s.current = [time, time];
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(flush, 15000);
    const hide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      flush();
    };
  }, [flush]);

  return { tick, flush };
}

type YouTubePlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; destroy(): void };
type YouTubeApi = { Player: new (el: HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTube: Promise<YouTubeApi> | null = null;
function loadYouTube(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  youTube ??= new Promise<YouTubeApi>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve(window.YT as YouTubeApi);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      youTube = null;
      script.remove();
      reject(new Error("youtube"));
    };
    document.head.appendChild(script);
  });
  return youTube;
}

const resumeAt = (p: ItemProgress | null) => (p && !p.completed && p.durationSec && p.positionSec > 5 && p.positionSec < p.durationSec - 10 ? p.positionSec : 0);

function YouTube({ item, title, onProgress, labels }: { item: CourseItem; title: string; onProgress: Report; labels: ExamLabels }) {
  const host = useRef<HTMLDivElement>(null);
  const { tick, flush } = useWatchTracker(item.id, onProgress);
  const [failed, setFailed] = useState(false);
  const start = useRef(resumeAt(item.progress));

  useEffect(() => {
    let player: YouTubePlayer | null = null;
    let timer = 0;
    let gone = false;
    loadYouTube()
      .then((YT) => {
        if (gone || !host.current) return;
        const el = document.createElement("div");
        host.current.replaceChildren(el);
        player = new YT.Player(el, {
          host: "https://www.youtube-nocookie.com",
          videoId: item.videoRef,
          width: "100%",
          height: "100%",
          playerVars: { rel: 0, playsinline: 1, start: start.current },
          events: {
            onReady: () => {
              host.current?.querySelector("iframe")?.setAttribute("title", title);
              timer = window.setInterval(() => player && player.getPlayerState() === 1 && tick(player.getCurrentTime(), player.getDuration()), 1000);
            },
            // paused (2) or ended (0): report at once
            onStateChange: (e: { data: number }) => {
              if (e.data === 0 && player) tick(player.getDuration(), player.getDuration());
              if (e.data === 0 || e.data === 2) flush();
            },
          },
        });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      window.clearInterval(timer);
      try {
        player?.destroy();
      } catch {
        /* the frame is already gone */
      }
    };
  }, [item.videoRef, title, tick, flush]);

  if (failed) return <Notice tone="error">{labels.content.errors.youtube_blocked}</Notice>;
  return <div ref={host} className="aspect-video w-full overflow-hidden rounded-xl bg-navy [&>iframe]:h-full [&>iframe]:w-full" />;
}

function Uploaded({ item, onProgress, labels }: { item: CourseItem; onProgress: Report; labels: ExamLabels }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const { tick, flush } = useWatchTracker(item.id, onProgress);
  const start = useRef(resumeAt(item.progress));

  useEffect(() => {
    let live = true;
    // long enough to watch and rewind; the link stops working afterwards
    courseFileUrl(item.filePath as string, 4 * 3600)
      .then((u) => live && setUrl(u))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [item.filePath]);

  if (failed) return <Notice tone="error">{labels.content.errors.unavailable}</Notice>;
  if (!url) return <Spinner />;
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      controlsList={item.allowDownload ? undefined : "nodownload"}
      onContextMenu={item.allowDownload ? undefined : (e) => e.preventDefault()}
      onLoadedMetadata={(e) => {
        if (start.current) e.currentTarget.currentTime = start.current;
      }}
      onTimeUpdate={(e) => !e.currentTarget.paused && tick(e.currentTarget.currentTime, e.currentTarget.duration)}
      onPause={flush}
      onEnded={(e) => {
        tick(e.currentTarget.duration, e.currentTarget.duration);
        flush();
      }}
      className="max-h-[70vh] w-full rounded-xl bg-navy"
    />
  );
}

export function VideoPlayer({ item, title, onProgress, labels }: { item: CourseItem; title: string; onProgress: Report; labels: ExamLabels }) {
  const c = labels.content;
  const [busy, setBusy] = useState(false);
  const done = !!item.progress?.completed;

  const mark = async () => {
    setBusy(true);
    try {
      const r = await rpc<{ recorded: boolean }>("exam_content_mark", { p_id: item.id, p_done: !done });
      if (r.recorded) onProgress({ percent: done ? 0 : 100, completed: !done, positionSec: 0 });
    } finally {
      setBusy(false);
    }
  };

  if (item.source === "YOUTUBE") return <YouTube item={item} title={title} onProgress={onProgress} labels={labels} />;
  if (item.source === "FILE") return <Uploaded item={item} onProgress={onProgress} labels={labels} />;
  return (
    <div className="space-y-3">
      {item.source === "VIMEO" ? (
        <iframe src={`https://player.vimeo.com/video/${encodeURIComponent(item.videoRef)}`} title={title} allow="fullscreen; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-xl bg-navy" />
      ) : (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
          {c.openLink} ↗
        </a>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={mark} disabled={busy} className="btn btn-outline btn-sm">
          {done ? c.unmark : c.markWatched}
        </button>
        <p className="text-xs text-slate">{c.manualNote}</p>
      </div>
    </div>
  );
}
