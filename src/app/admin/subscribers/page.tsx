import { db } from "@/lib/db";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConfirmButton } from "@/components/admin/AdminForm";
import { deleteSubscriber } from "../actions";

export default async function Subscribers() {
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const subs = await db.subscriber.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString(lang === "ar" ? "ar-LY-u-nu-latn" : "en-GB") : "—");

  return (
    <AdminShell
      title={a.subscribers}
      role="ADMIN"
      actions={
        <a href="/api/admin/export/subscribers" className="btn btn-outline btn-sm">
          ⤓ {a.exportCsv}
        </a>
      }
    >
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist text-slate">
            <tr>
              <th className="px-4 py-3 text-start">{a.email}</th>
              <th className="px-4 py-3 text-start">Lang</th>
              <th className="px-4 py-3 text-start">{a.status}</th>
              <th className="px-4 py-3 text-start">{a.created}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {subs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate">
                  {a.noItems}
                </td>
              </tr>
            )}
            {subs.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3" dir="ltr">
                  {s.email}
                </td>
                <td className="px-4 py-3">{s.locale}</td>
                <td className="px-4 py-3">
                  {s.unsubscribedAt ? (
                    <span className="chip bg-mist text-slate">{a.unsubscribed}</span>
                  ) : s.confirmedAt ? (
                    <span className="chip bg-emerald-50 text-emerald-700">{a.confirmed}</span>
                  ) : (
                    <span className="chip bg-amber-50 text-amber-800">{a.pending}</span>
                  )}
                </td>
                <td className="px-4 py-3">{fmt(s.createdAt)}</td>
                <td className="px-4 py-3 text-end">
                  <ConfirmButton action={deleteSubscriber.bind(null, s.id)} label={a.delete} confirm={a.confirmDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
