import { db } from "@/lib/db";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminForm, ConfirmButton, CopyButton } from "@/components/admin/AdminForm";
import { deleteMedia, uploadMedia } from "../actions";

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ saved?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const items = await db.media.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <AdminShell title={a.media}>
      {(sp.saved || sp.deleted) && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ {a.saved}</p>}
      <div className="max-w-3xl">
        <AdminForm action={uploadMedia} labels={{}} lang={lang} submitLabel={a.upload} errorTitle={a.errors} multipart>
          <div className="rounded-2xl border border-line bg-white p-5">
            <input type="file" name="files" multiple required className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-sky file:px-3 file:py-2 file:font-semibold file:text-navy" />
            <p className="mt-2 text-xs text-slate">JPG, PNG, WebP, AVIF, SVG (≤ 8 MB) · PDF, Word, Excel, CSV, MP4 (≤ 50 MB)</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input name="altAr" placeholder={lang === "ar" ? "وصف بديل للصورة (عربي)" : "Alt text (Arabic)"} className="field" />
              <input name="altEn" placeholder={lang === "ar" ? "وصف بديل للصورة (إنجليزي)" : "Alt text (English)"} className="field" dir="ltr" />
            </div>
          </div>
        </AdminForm>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.length === 0 && <p className="text-slate">{a.noItems}</p>}
        {items.map((m) => (
          <div key={m.id} className="card overflow-hidden">
            <div className="grid aspect-video place-items-center bg-mist">
              {m.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.altEn || m.filename} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="text-2xl font-bold text-slate">{m.filename.split(".").pop()?.toUpperCase()}</span>
              )}
            </div>
            <div className="space-y-2 p-3">
              <p className="truncate text-sm font-semibold" title={m.filename}>
                {m.filename}
              </p>
              <p className="truncate text-xs text-slate" dir="ltr">
                {m.url} · {(m.size / 1024).toFixed(0)} KB
              </p>
              <div className="flex gap-2">
                <CopyButton text={m.url} label={a.copy} done={a.copied} />
                <ConfirmButton action={deleteMedia.bind(null, m.id)} label={a.delete} confirm={a.confirmDelete} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
