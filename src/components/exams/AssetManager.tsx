"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/static/supabase";
import { rpc } from "@/lib/exams/client";
import { ASSET_BUCKET, ASSET_MAX, ASSET_TYPES, bankErrorKey, type ExamAsset, type OwnerType } from "@/lib/exams/bank";
import { Notice, type ExamLabels } from "./ExamShell";

/** Signed (expiring) URLs for private files — the bucket has no public URLs */
export async function signedUrls(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase().storage.from(ASSET_BUCKET).createSignedUrls(paths, seconds);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
}

/** Remove files from Storage after their records were deleted (paths returned by the database) */
export async function removeFiles(paths: string[]) {
  if (paths.length) await supabase().storage.from(ASSET_BUCKET).remove(paths);
}

/** Images / PDFs of one question or scenario: upload → register → list with signed URLs → caption / remove */
export function AssetManager({
  programId,
  ownerType,
  ownerId,
  canEdit,
  labels,
  onChange,
}: {
  programId: string;
  ownerType: OwnerType;
  ownerId: string;
  canEdit: boolean;
  labels: ExamLabels;
  onChange?: (assets: ExamAsset[]) => void;
}) {
  const a = labels.bank.assets;
  const [assets, setAssets] = useState<ExamAsset[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<string, { ar: string; en: string }>>({});
  const input = useRef<HTMLInputElement>(null);
  // kept in a ref so an inline callback from the parent does not re-trigger loading on every render
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    try {
      const list = await rpc<ExamAsset[]>("exam_assets", { p_owner_type: ownerType, p_owner_id: ownerId });
      setAssets(list);
      setCaptions(Object.fromEntries(list.map((x) => [x.id, { ar: x.captionAr, en: x.captionEn }])));
      setUrls(await signedUrls(list.map((x) => x.path)));
      onChangeRef.current?.(list);
    } catch {
      setError(labels.errorGeneric);
    }
  }, [ownerType, ownerId, labels.errorGeneric]);

  useEffect(() => {
    load();
  }, [load]);

  const fail = (e: unknown) => setError((labels.bank.errors as Record<string, string>)[bankErrorKey(e)] ?? labels.errorGeneric);

  const upload = async (file: File) => {
    setError(null);
    const ext = ASSET_TYPES[file.type];
    if (!ext) return setError(a.badType);
    if (file.size > ASSET_MAX) return setError(a.tooBig);
    setBusy(true);
    const path = `${programId}/${ownerId}/${crypto.randomUUID()}.${ext}`;
    try {
      const { error: upErr } = await supabase().storage.from(ASSET_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      try {
        await rpc("exam_asset_register", { p_owner_type: ownerType, p_owner_id: ownerId, p_path: path, p_mime: file.type, p_size: file.size, p_file_name: file.name, p_caption_ar: "", p_caption_en: "" });
      } catch (e) {
        await removeFiles([path]); // never leave an unregistered file behind
        throw e;
      }
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (x: ExamAsset) => {
    if (!window.confirm(a.confirmRemove)) return;
    setBusy(true);
    try {
      const r = await rpc<{ path: string }>("exam_asset_delete", { p_id: x.id });
      await removeFiles([r.path]);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const saveCaption = async (x: ExamAsset) => {
    setBusy(true);
    try {
      await rpc("exam_asset_update", { p_id: x.id, p_caption_ar: captions[x.id]?.ar ?? "", p_caption_en: captions[x.id]?.en ?? "" });
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="field-label mb-0">{a.title}</p>
        {canEdit && (
          <label className={`btn btn-outline btn-sm cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? a.uploading : `+ ${a.upload}`}
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        )}
      </div>
      <p className="text-xs text-slate">{a.hint}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {assets && assets.length === 0 && <p className="text-sm text-slate">{a.none}</p>}
      {assets && assets.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {assets.map((x) => (
            <li key={x.id} className="rounded-xl border border-line bg-white p-3">
              {x.kind === "IMAGE" && urls[x.path] ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL from private storage
                <img src={urls[x.path]} alt={x.captionAr || x.fileName} className="max-h-48 w-full rounded-lg bg-mist object-contain" draggable={false} />
              ) : (
                <a href={urls[x.path]} target="_blank" rel="noopener" className="flex items-center gap-2 rounded-lg bg-mist px-3 py-4 text-sm font-semibold text-brand">
                  PDF · {x.fileName || a.openFile}
                </a>
              )}
              <p className="mt-1 truncate text-xs text-slate" dir="ltr">{x.fileName} · {(x.size / 1024).toFixed(0)} KB</p>
              {canEdit ? (
                <div className="mt-2 space-y-2">
                  <input value={captions[x.id]?.ar ?? ""} onChange={(e) => setCaptions({ ...captions, [x.id]: { ...captions[x.id], ar: e.target.value } })} placeholder={a.captionAr} className="field py-1.5 text-sm" dir="rtl" />
                  <input value={captions[x.id]?.en ?? ""} onChange={(e) => setCaptions({ ...captions, [x.id]: { ...captions[x.id], en: e.target.value } })} placeholder={a.captionEn} className="field py-1.5 text-sm" dir="ltr" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => saveCaption(x)} disabled={busy} className="btn btn-outline btn-sm">{a.saveCaption}</button>
                    <button type="button" onClick={() => remove(x)} disabled={busy} className="rounded-lg px-2.5 py-1 text-sm text-gold-600 hover:bg-gold/10">{a.remove}</button>
                  </div>
                </div>
              ) : (
                (x.captionAr || x.captionEn) && <p className="mt-1 text-sm">{x.captionAr || x.captionEn}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
