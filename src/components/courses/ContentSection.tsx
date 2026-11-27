"use client";

import { useState } from "react";
import { rpc } from "@/lib/exams/client";
import {
  courseFileUrl,
  extensionOf,
  fileSize,
  folderName,
  itemDesc,
  itemTitle,
  previewable,
  removeCourseFiles,
  type CourseContent,
  type CourseFolder,
  type CourseItem,
  type Section,
} from "@/lib/exams/courses";
import { cn } from "@/lib/utils";
import { Notice, type ExamLabels } from "@/components/exams/ExamShell";
import { contentError, FolderEditor, ItemEditor } from "./ContentEditor";
import { Modal } from "./Modal";
import { VideoPlayer } from "./VideoPlayer";

type Editing = { kind: "item"; item: CourseItem | null; folderId: string | null } | { kind: "folder"; folder: CourseFolder | null } | null;
type Viewing = { item: CourseItem; url: string } | null;

const SMALL = "rounded-lg px-2.5 py-1.5 text-sm font-semibold text-brand hover:bg-brand/10 disabled:opacity-40";

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** the files or the videos of one course: what trainees study, and (for managers) how it is organised */
export function ContentSection({
  programId,
  section,
  data,
  setData,
  reload,
  locale,
  labels,
}: {
  programId: string;
  section: Section;
  data: CourseContent;
  setData: (fn: (d: CourseContent) => CourseContent) => void;
  reload: () => void;
  locale: string;
  labels: ExamLabels;
}) {
  const c = labels.content;
  const video = section === "VIDEO";
  const [editing, setEditing] = useState<Editing>(null);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [playing, setPlaying] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const folders = data.folders.filter((f) => f.section === section);
  const own = data.items.filter((i) => i.section === section);
  const shared = data.shared.filter((i) => i.section === section);
  const loose = own.filter((i) => !i.folderId || !folders.some((f) => f.id === i.folderId));
  const player = [...own, ...shared].find((i) => i.id === playing);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      reload();
    } catch (e) {
      setError(contentError(e, labels));
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: string, progress: { percent: number; completed: boolean; positionSec: number }) =>
    setData((d) => {
      const apply = (list: CourseItem[]) =>
        list.map((i) => (i.id === id ? { ...i, progress: { ranges: [], durationSec: null, ...i.progress, ...progress, percent: progress.percent } } : i));
      const items = apply(d.items);
      const other = apply(d.shared);
      // the course total follows what the trainee has just completed
      const before = [...d.items, ...d.shared].find((i) => i.id === id)?.progress?.completed ?? false;
      const done = Math.max(0, d.progress.done + (progress.completed === before ? 0 : progress.completed ? 1 : -1));
      return { ...d, items, shared: other, progress: { ...d.progress, done, percent: d.progress.total ? Math.floor((done * 100) / d.progress.total) : 0 } };
    });

  /** records that a trainee opened it (managers' previews are not recorded) */
  const opened = async (i: CourseItem) => {
    try {
      const r = await rpc<{ recorded: boolean; completed?: boolean }>("exam_content_open", { p_id: i.id });
      if (r.recorded && r.completed && !i.progress?.completed) patch(i.id, { percent: 100, completed: true, positionSec: 0 });
    } catch {
      /* opening the file matters more than counting it */
    }
  };

  const view = async (i: CourseItem) => {
    setError("");
    try {
      setViewing({ item: i, url: await courseFileUrl(i.filePath as string, 1800) });
      opened(i);
    } catch (e) {
      setError(contentError(e, labels));
    }
  };

  const save = async (i: CourseItem) => {
    setError("");
    try {
      const url = await courseFileUrl(i.filePath as string, 600, i.fileName || "file");
      await opened(i);
      window.location.assign(url);
    } catch (e) {
      setError(contentError(e, labels));
    }
  };

  const play = (i: CourseItem) => {
    setPlaying(i.id);
    opened(i);
  };

  const remove = (i: CourseItem) =>
    window.confirm(c.confirmDelete.replace("{name}", itemTitle(i, locale))) &&
    run(async () => {
      const r = await rpc<{ paths: string[] }>("exam_content_item_delete", { p_id: i.id });
      await removeCourseFiles(r.paths);
    });

  const row = (i: CourseItem, index: number, count: number, manage: boolean) => {
    const file = i.source === "FILE";
    const done = i.progress?.completed;
    return (
      <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span
          className={cn("grid h-9 w-12 shrink-0 place-items-center rounded-lg text-[0.65rem] font-bold uppercase", done ? "bg-emerald-50 text-emerald-700" : "bg-mist text-slate")}
          dir="ltr"
          title={done ? c.completed : undefined}
        >
          {done ? "✓" : video ? "▶" : file ? extensionOf(i.fileName) || "file" : "link"}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="break-words font-semibold text-navy">{itemTitle(i, locale)}</p>
          {itemDesc(i, locale) && <p className="whitespace-pre-line break-words text-sm leading-6 text-slate">{itemDesc(i, locale)}</p>}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate">
            {file ? <span dir="ltr">{fileSize(i.size)}</span> : <span>{c.sources[i.source]}</span>}
            {video && !done && !!i.progress?.percent && <span>{c.watched.replace("{p}", String(i.progress.percent))}</span>}
            {file && !i.allowDownload && <span className="rounded-md bg-mist px-1.5 py-0.5 font-semibold">{c.viewOnly}</span>}
            {i.fromCode && <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-semibold text-brand">{c.from} <bdi dir="ltr">{i.fromCode}</bdi></span>}
            {manage && i.published === false && <span className="rounded-md bg-gold/10 px-1.5 py-0.5 font-semibold text-gold-600">{c.hidden}</span>}
            {data.staff && !!i.sharedWith?.length && <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-semibold text-brand">{c.sharedWith.replace("{n}", String(i.sharedWith.length))}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {video ? (
            <>
              <button type="button" onClick={() => play(i)} className="btn btn-primary btn-sm">{c.play}</button>
              {file && i.allowDownload && <button type="button" onClick={() => save(i)} className="btn btn-outline btn-sm">{c.download}</button>}
            </>
          ) : file ? (
            <>
              {previewable(i.mimeType) && <button type="button" onClick={() => view(i)} className="btn btn-primary btn-sm">{c.view}</button>}
              {i.allowDownload && <button type="button" onClick={() => save(i)} className="btn btn-outline btn-sm">{c.download}</button>}
            </>
          ) : (
            <a href={i.url} target="_blank" rel="noopener noreferrer" onClick={() => opened(i)} className="btn btn-primary btn-sm">{c.openLink} ↗</a>
          )}
          {manage && (
            <>
              <button type="button" className={SMALL} disabled={busy || index === 0} onClick={() => run(() => rpc("exam_content_move", { p_kind: "ITEM", p_id: i.id, p_up: true }))} aria-label={c.moveUp} title={c.moveUp}>↑</button>
              <button type="button" className={SMALL} disabled={busy || index === count - 1} onClick={() => run(() => rpc("exam_content_move", { p_kind: "ITEM", p_id: i.id, p_up: false }))} aria-label={c.moveDown} title={c.moveDown}>↓</button>
              <button type="button" className={SMALL} disabled={busy} onClick={() => run(() => rpc("exam_content_item_save", { p_program: programId, p_data: { id: i.id, published: !i.published } }))}>{i.published ? c.hide : c.publish}</button>
              <button type="button" className={SMALL} disabled={busy} onClick={() => setEditing({ kind: "item", item: i, folderId: i.folderId })}>{c.edit}</button>
              <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gold-600 hover:bg-gold/10 disabled:opacity-40" disabled={busy} onClick={() => remove(i)}>{c.remove}</button>
            </>
          )}
        </div>
      </li>
    );
  };

  const list = (items: CourseItem[], manage: boolean) =>
    items.length ? <ul className="divide-y divide-line">{items.map((x, n) => row(x, n, items.length, manage))}</ul> : <p className="px-4 py-4 text-sm text-slate">{c.emptyFolder}</p>;

  const empty = !own.length && !shared.length && !folders.length;

  return (
    <div className="space-y-5">
      {data.canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ kind: "item", item: null, folderId: null })}>+ {video ? c.form.addVideo : c.form.addFile}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing({ kind: "folder", folder: null })}>+ {video ? c.addUnit : c.addFolder}</button>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {empty && <p className="card p-6 text-sm text-slate">{video ? c.noVideos : c.noFiles}</p>}

      {folders.map((f, n) => {
        const inside = own.filter((i) => i.folderId === f.id);
        return (
          <section key={f.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-mist/60 px-4 py-3">
              <h3 className="min-w-0 break-words font-bold text-navy">
                {folderName(f, locale)} <span className="text-sm font-semibold text-slate">({inside.length})</span>
                {!f.published && <span className="ms-2 rounded-md bg-gold/10 px-1.5 py-0.5 text-xs font-semibold text-gold-600">{c.hidden}</span>}
              </h3>
              {data.canManage && (
                <div className="flex flex-wrap gap-1">
                  <button type="button" className={SMALL} disabled={busy} onClick={() => setEditing({ kind: "item", item: null, folderId: f.id })}>+ {c.addHere}</button>
                  <button type="button" className={SMALL} disabled={busy || n === 0} onClick={() => run(() => rpc("exam_content_move", { p_kind: "FOLDER", p_id: f.id, p_up: true }))} aria-label={c.moveUp} title={c.moveUp}>↑</button>
                  <button type="button" className={SMALL} disabled={busy || n === folders.length - 1} onClick={() => run(() => rpc("exam_content_move", { p_kind: "FOLDER", p_id: f.id, p_up: false }))} aria-label={c.moveDown} title={c.moveDown}>↓</button>
                  <button type="button" className={SMALL} disabled={busy} onClick={() => setEditing({ kind: "folder", folder: f })}>{c.edit}</button>
                  <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gold-600 hover:bg-gold/10" disabled={busy} onClick={() => window.confirm(c.confirmDeleteFolder.replace("{name}", folderName(f, locale))) && run(() => rpc("exam_content_folder_delete", { p_id: f.id }))}>{c.remove}</button>
                </div>
              )}
            </header>
            {list(inside, data.canManage)}
          </section>
        );
      })}

      {loose.length > 0 && (
        <section className="card overflow-hidden">
          {folders.length > 0 && <header className="border-b border-line bg-mist/60 px-4 py-3"><h3 className="font-bold text-navy">{c.other}</h3></header>}
          {list(loose, data.canManage)}
        </section>
      )}

      {shared.length > 0 && (
        <section className="card overflow-hidden">
          <header className="border-b border-line bg-mist/60 px-4 py-3"><h3 className="font-bold text-navy">{c.sharedTitle}</h3></header>
          {list(shared, false)}
        </section>
      )}

      {editing?.kind === "item" && (
        <ItemEditor programId={programId} section={section} item={editing.item} folderId={editing.folderId} data={data} locale={locale} labels={labels} close={() => setEditing(null)} saved={reload} />
      )}
      {editing?.kind === "folder" && <FolderEditor programId={programId} section={section} folder={editing.folder} labels={labels} close={() => setEditing(null)} saved={reload} />}

      {viewing && (
        <Modal wide title={itemTitle(viewing.item, locale)} close={() => setViewing(null)} closeLabel={c.close}>
          {viewing.item.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL from private storage
            <img src={viewing.url} alt={itemTitle(viewing.item, locale)} className="max-h-[75vh] w-full rounded-lg object-contain" onContextMenu={viewing.item.allowDownload ? undefined : (e) => e.preventDefault()} />
          ) : viewing.item.mimeType.startsWith("audio/") ? (
            <audio src={viewing.url} controls className="w-full" controlsList={viewing.item.allowDownload ? undefined : "nodownload"} />
          ) : viewing.item.mimeType.startsWith("video/") ? (
            <video src={viewing.url} controls playsInline className="max-h-[75vh] w-full rounded-lg bg-navy" controlsList={viewing.item.allowDownload ? undefined : "nodownload"} />
          ) : (
            <>
              <iframe src={`${viewing.url}${viewing.item.allowDownload ? "" : "#toolbar=0"}`} title={itemTitle(viewing.item, locale)} className="h-[72vh] w-full rounded-lg border border-line bg-mist" />
              {viewing.item.allowDownload && (
                <p className="mt-2 text-sm text-slate">
                  {c.noPreview}{" "}
                  <a href={viewing.url} target="_blank" rel="noopener" className="font-semibold text-brand hover:underline">{c.newTab} ↗</a>
                </p>
              )}
            </>
          )}
        </Modal>
      )}

      {player && (
        <Modal wide title={itemTitle(player, locale)} close={() => { setPlaying(""); window.setTimeout(reload, 800); }} closeLabel={c.close}>
          <VideoPlayer key={player.id} item={player} title={itemTitle(player, locale)} labels={labels} onProgress={(p) => patch(player.id, p)} />
          {!!player.progress?.percent && (
            <div className="mt-4">
              <ProgressBar percent={player.progress.percent} label={itemTitle(player, locale)} />
              <p className="mt-1 text-sm text-slate">{player.progress.completed ? c.completed : c.watched.replace("{p}", String(player.progress.percent))}</p>
            </div>
          )}
          {itemDesc(player, locale) && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate">{itemDesc(player, locale)}</p>}
        </Modal>
      )}
    </div>
  );
}
