import Link from "next/link";
import { notFound } from "next/navigation";
import { INBOX, type InboxKey } from "@/lib/inbox";
import { INBOX_VIEW, cell } from "@/lib/inbox-config";
import { getAdminDict, getAdminLang, statusLabels } from "@/lib/admin-i18n";
import { getCurrentUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConfirmButton } from "@/components/admin/AdminForm";
import { deleteRequest, updateRequest } from "../../../actions";
import { whatsappLink } from "@/lib/utils";

export default async function InboxDetail({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { type, id } = await params;
  const sp = await searchParams;
  if (!(type in INBOX)) notFound();
  const key = type as InboxKey;
  const cfg = INBOX[key];
  const view = INBOX_VIEW[key];
  const [row] = await view.load({ id }, 0, 1);
  if (!row) notFound();
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const st = statusLabels[lang];
  const user = await getCurrentUser();
  const update = updateRequest.bind(null, key, id);
  const del = deleteRequest.bind(null, key, id);
  const email = String(row.email ?? "");
  const phone = row.phone ? String(row.phone) : "";
  const wa = whatsappLink(phone);

  return (
    <AdminShell
      title={`${view.title[lang]} – ${a.details}`}
      actions={
        <Link href={`/admin/inbox/${key}`} className="btn btn-outline btn-sm">
          ← {a.back}
        </Link>
      }
    >
      {sp.saved && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ {a.saved}</p>}
      <div className="grid max-w-6xl gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-2xl border border-line bg-white p-6">
          <dl className="divide-y divide-line">
            {view.cols.map((c) => (
              <div key={c.key} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
                <dt className="text-sm text-slate">{c.label[lang]}</dt>
                <dd className="whitespace-pre-wrap break-words text-navy" dir={["email", "phone"].includes(c.key) ? "ltr" : "auto"}>
                  {c.key === "status" ? st[String(row.status)] : cell(row[c.key], lang)}
                </dd>
              </div>
            ))}
            <div className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-sm text-slate">Lang</dt>
              <dd>{String(row.locale ?? "")}</dd>
            </div>
          </dl>
          {key === "corporate" && row.attachmentPath ? (
            <a href={`/api/admin/file/${id}`} className="btn btn-outline btn-sm mt-4">
              ⤓ {a.attachment}: {String(row.attachmentName)}
            </a>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            {email && (
              <a href={`mailto:${email}`} className="btn btn-primary btn-sm">
                ✉ {email}
              </a>
            )}
            {phone && (
              <a href={`tel:${phone.replace(/\s/g, "")}`} className="btn btn-outline btn-sm" dir="ltr">
                ☎ {phone}
              </a>
            )}
            {wa && (
              <a href={wa} target="_blank" className="btn btn-outline btn-sm">
                WhatsApp
              </a>
            )}
          </div>
        </div>
        <form action={update} className="h-fit space-y-4 rounded-2xl border border-line bg-white p-6">
          <div>
            <label htmlFor="status" className="field-label">
              {a.status}
            </label>
            <select id="status" name="status" defaultValue={String(row.status)} className="field appearance-auto">
              {cfg.statuses.map((s) => (
                <option key={s} value={s}>
                  {st[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="adminNotes" className="field-label">
              {a.notes}
            </label>
            <textarea id="adminNotes" name="adminNotes" rows={6} defaultValue={String(row.adminNotes ?? "")} className="field" />
          </div>
          <button className="btn btn-primary">{a.updateStatus}</button>
          {user?.role === "ADMIN" && (
            <div className="border-t border-line pt-4">
              <ConfirmButton action={del} label={a.delete} confirm={a.confirmDelete} />
            </div>
          )}
        </form>
      </div>
    </AdminShell>
  );
}
