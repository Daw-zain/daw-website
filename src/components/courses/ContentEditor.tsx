"use client";

import { useState, type FormEvent } from "react";
import { rpc, utcDate } from "@/lib/exams/client";
import {
  courseErrorKey,
  courseFileUrl,
  extensionOf,
  FILE_TYPES,
  fileSize,
  folderName,
  previewable,
  saveWithFile,
  type CourseContent,
  type CourseFolder,
  type CourseItem,
  type Section,
  type VideoSource,
} from "@/lib/exams/courses";
import { Notice, type ExamLabels } from "@/components/exams/ExamShell";
import { Modal } from "./Modal";

const accept = (section: Section) =>
  Object.keys(FILE_TYPES)
    .filter((e) => section === "MATERIAL" || e === "mp4" || e === "webm")
    .map((e) => `.${e}`)
    .join(",");

export const contentError = (e: unknown, labels: ExamLabels) => (labels.content.errors as Record<string, string>)[courseErrorKey(e)] ?? labels.errorGeneric;

/** add or edit one file or video of a course */
export function ItemEditor({
  programId,
  section,
  item,
  folderId,
  data,
  locale,
  labels,
  close,
  saved,
}: {
  programId: string;
  section: Section;
  item: CourseItem | null;
  folderId: string | null;
  data: CourseContent;
  locale: string;
  labels: ExamLabels;
  close: () => void;
  saved: () => void;
}) {
  const c = labels.content;
  const f = c.form;
  const video = section === "VIDEO";
  const [source, setSource] = useState<VideoSource>(item?.source ?? (video ? "YOUTUBE" : "FILE"));
  const [v, setV] = useState({
    titleAr: item?.titleAr ?? "",
    titleEn: item?.titleEn ?? "",
    descAr: item?.descAr ?? "",
    descEn: item?.descEn ?? "",
    folderId: item ? (item.folderId ?? "") : (folderId ?? ""),
    url: item?.url ?? "",
    published: item?.published ?? true,
    allowDownload: item?.allowDownload ?? !video,
  });
  const [shared, setShared] = useState<string[]>(item?.sharedWith ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const many = !item && files.length > 1;
  const set = (k: keyof typeof v, value: string | boolean) => setV((x) => ({ ...x, [k]: value }));
  const viewOnlyPossible = source !== "FILE" || (item ? previewable(item.mimeType) : files.every((x) => previewable(FILE_TYPES[extensionOf(x.name)] ?? "")));
  const folders = data.folders.filter((x) => x.section === section);
  // courses this item is already shared with stay listed even when the editor does not manage them
  const shareTargets = [...data.courses, ...shared.filter((id) => !data.courses.some((x) => x.programId === id)).map((id) => ({ programId: id, code: "—", titleAr: "—", titleEn: "—" }))];

  const payload = (extra: Record<string, unknown>) => ({
    p_program: programId,
    p_data: {
      ...(item ? { id: item.id } : { section, source }),
      ...v,
      folderId: v.folderId || "",
      allowDownload: source === "FILE" ? v.allowDownload : false,
      sharedWith: shared,
      ...extra,
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const needsFile = !item && source === "FILE";
    if (needsFile && !files.length) return setError(c.errors.no_file);
    if (!many && !v.titleAr.trim() && !v.titleEn.trim() && !(needsFile && files.length)) return setError(c.errors.title_missing);
    setBusy(c.saving);
    let added = 0;
    try {
      if (needsFile) {
        for (const [i, file] of files.entries()) {
          setBusy(c.uploading.replace("{n}", String(i + 1)).replace("{total}", String(files.length)));
          const name = file.name.replace(/\.[^.]+$/, "").slice(0, 200);
          const titles = many || (!v.titleAr.trim() && !v.titleEn.trim()) ? { titleAr: name, titleEn: "" } : {};
          await saveWithFile(programId, file, video, (stored) => rpc("exam_content_item_save", payload({ ...titles, ...(many ? { descAr: "", descEn: "" } : {}), ...stored })));
          added++;
        }
      } else await rpc("exam_content_item_save", payload({}));
      saved();
      close();
    } catch (err) {
      setError(`${many && added ? `${c.partly.replace("{n}", String(added))} ` : ""}${contentError(err, labels)}`);
      if (added) {
        setFiles(files.slice(added));
        saved();
      }
    } finally {
      setBusy("");
    }
  };

  const replace = async (file: File) => {
    if (!item) return;
    setError("");
    setBusy(c.uploading.replace("{n}", "1").replace("{total}", "1"));
    try {
      await saveWithFile(programId, file, video, (stored) => rpc("exam_content_replace", { p_id: item.id, p_file: stored }));
      saved();
      close();
    } catch (err) {
      setError(contentError(err, labels));
    } finally {
      setBusy("");
    }
  };

  const openVersion = async (path: string, name: string) => {
    try {
      window.location.assign(await courseFileUrl(path, 600, name));
    } catch (err) {
      setError(contentError(err, labels));
    }
  };

  const title = item ? f.edit : video ? f.addVideo : f.addFile;
  return (
    <Modal title={title} close={() => !busy && close()} closeLabel={c.close}>
      <form onSubmit={submit} className="space-y-4">
        {video && !item && (
          <label className="block">
            <span className="field-label">{f.source}</span>
            <select value={source} onChange={(e) => { setSource(e.target.value as VideoSource); setFiles([]); }} className="field w-full" disabled={!!busy}>
              {(["YOUTUBE", "VIMEO", "LINK", "FILE"] as const).map((s) => (
                <option key={s} value={s}>{f.sources[s]}</option>
              ))}
            </select>
          </label>
        )}
        {!video && !item && (
          <label className="block">
            <span className="field-label">{f.source}</span>
            <select value={source} onChange={(e) => { setSource(e.target.value as VideoSource); setFiles([]); }} className="field w-full" disabled={!!busy}>
              <option value="FILE">{f.sources.UPLOAD}</option>
              <option value="LINK">{f.sources.LINK}</option>
            </select>
          </label>
        )}

        {source !== "FILE" && (
          <label className="block">
            <span className="field-label">{f.url}</span>
            <input value={v.url} onChange={(e) => set("url", e.target.value)} dir="ltr" required className="field w-full" placeholder={source === "YOUTUBE" ? "https://youtu.be/…" : "https://…"} />
            {source === "YOUTUBE" && <span className="mt-1 block text-xs leading-5 text-slate">{f.youtubeHint}</span>}
          </label>
        )}
        {source === "FILE" && !item && (
          <label className="block">
            <span className="field-label">{video ? f.videoFile : f.files}</span>
            <input type="file" multiple accept={accept(section)} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="field w-full text-sm" disabled={!!busy} />
            <span className="mt-1 block text-xs leading-5 text-slate">{video ? f.videoHint : f.filesHint}</span>
            {many && <span className="mt-1 block text-xs font-semibold text-navy">{f.manyNote.replace("{n}", String(files.length))}</span>}
          </label>
        )}

        {!many && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="field-label">{f.titleAr}</span><input value={v.titleAr} onChange={(e) => set("titleAr", e.target.value)} dir="rtl" maxLength={200} className="field w-full" /></label>
            <label className="block"><span className="field-label">{f.titleEn}</span><input value={v.titleEn} onChange={(e) => set("titleEn", e.target.value)} dir="ltr" maxLength={200} className="field w-full" /></label>
            <label className="block"><span className="field-label">{f.descAr}</span><textarea value={v.descAr} onChange={(e) => set("descAr", e.target.value)} dir="rtl" rows={3} maxLength={2000} className="field w-full" /></label>
            <label className="block"><span className="field-label">{f.descEn}</span><textarea value={v.descEn} onChange={(e) => set("descEn", e.target.value)} dir="ltr" rows={3} maxLength={2000} className="field w-full" /></label>
          </div>
        )}

        <label className="block">
          <span className="field-label">{video ? f.unit : f.folder}</span>
          <select value={v.folderId} onChange={(e) => set("folderId", e.target.value)} className="field w-full">
            <option value="">{f.noFolder}</option>
            {folders.map((x) => (
              <option key={x.id} value={x.id}>{folderName(x, locale)}</option>
            ))}
          </select>
        </label>

        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={v.published} onChange={(e) => set("published", e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
            <span>{f.published}</span>
          </label>
          {source === "FILE" && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={v.allowDownload} onChange={(e) => set("allowDownload", e.target.checked)} disabled={v.allowDownload && !viewOnlyPossible} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
              <span>
                {f.allowDownload}
                <span className="block text-xs leading-5 text-slate">{viewOnlyPossible ? f.viewOnlyNote : f.viewOnlyType}</span>
              </span>
            </label>
          )}
        </div>

        {shareTargets.length > 0 && (
          <details className="rounded-xl border border-line p-3" open={shared.length > 0}>
            <summary className="cursor-pointer text-sm font-semibold text-navy">{f.share} {shared.length > 0 && `(${shared.length})`}</summary>
            <p className="mt-1 text-xs text-slate">{f.shareHint}</p>
            <div className="mt-2 grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {shareTargets.map((x) => (
                <label key={x.programId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={shared.includes(x.programId)} onChange={(e) => setShared(e.target.checked ? [...shared, x.programId] : shared.filter((s) => s !== x.programId))} className="h-4 w-4 accent-[var(--color-brand)]" />
                  <span className="min-w-0 truncate"><bdi dir="ltr">{x.code}</bdi> · {locale === "ar" ? x.titleAr : x.titleEn}</span>
                </label>
              ))}
            </div>
          </details>
        )}

        {item?.source === "FILE" && (
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm font-semibold text-navy">{f.currentFile}</p>
            <p className="mt-1 break-all text-xs text-slate" dir="ltr">{item.fileName} · {fileSize(item.size)} · v{item.version}</p>
            <label className={`btn btn-outline btn-sm mt-2 cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              {f.replace}
              <input type="file" accept={accept(section)} className="sr-only" onChange={(e) => e.target.files?.[0] && window.confirm(video ? f.replaceVideoConfirm : f.replaceConfirm) && replace(e.target.files[0])} />
            </label>
            {!!item.versions?.length && (
              <ul className="mt-3 space-y-1 border-t border-line pt-2">
                {item.versions.map((x) => (
                  <li key={x.version} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate">
                    <span className="break-all" dir="ltr">v{x.version} · {x.fileName} · {utcDate(x.replacedAt)?.toLocaleDateString(locale === "ar" ? "ar-LY" : "en-GB")}</span>
                    <button type="button" onClick={() => openVersion(x.filePath, x.fileName)} className="font-semibold text-brand hover:underline">{c.download}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {busy && <span className="text-sm text-slate" role="status">{busy}</span>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!!busy}>{c.save}</button>
        </div>
      </form>
    </Modal>
  );
}

export function FolderEditor({ programId, section, folder, labels, close, saved }: { programId: string; section: Section; folder: CourseFolder | null; labels: ExamLabels; close: () => void; saved: () => void }) {
  const c = labels.content;
  const f = c.form;
  const [v, setV] = useState({ nameAr: folder?.nameAr ?? "", nameEn: folder?.nameEn ?? "", published: folder?.published ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await rpc("exam_content_folder_save", { p_program: programId, p_data: { ...v, section, ...(folder ? { id: folder.id } : {}) } });
      saved();
      close();
    } catch (err) {
      setError(contentError(err, labels));
      setBusy(false);
    }
  };
  const video = section === "VIDEO";
  return (
    <Modal title={folder ? (video ? f.editUnit : f.editFolder) : video ? c.addUnit : c.addFolder} close={close} closeLabel={c.close}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="field-label">{f.nameAr}</span><input value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} dir="rtl" maxLength={150} className="field w-full" /></label>
          <label className="block"><span className="field-label">{f.nameEn}</span><input value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} dir="ltr" maxLength={150} className="field w-full" /></label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={v.published} onChange={(e) => setV({ ...v, published: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" />
          <span>{f.folderPublished}</span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{c.save}</button>
        </div>
      </form>
    </Modal>
  );
}
