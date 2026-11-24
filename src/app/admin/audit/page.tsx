import Link from "next/link";
import { db } from "@/lib/db";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";

const PAGE = 50;

export default async function Audit({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const page = Math.max(1, Number(sp.page) || 1);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { name: true, email: true } } } }),
    db.auditLog.count(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <AdminShell title={a.audit} role="ADMIN">
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist text-slate">
            <tr>
              {["Date", "User", "Action", "Entity", "Details", "IP"].map((h) => (
                <th key={h} className="px-4 py-3 text-start font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line" dir="ltr">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2.5">{r.createdAt.toLocaleString("en-GB")}</td>
                <td className="px-4 py-2.5">{r.user?.email ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span className="chip bg-mist text-navy">{r.action}</span>
                </td>
                <td className="px-4 py-2.5">
                  {r.entity}
                  {r.entityId ? <span className="text-slate"> #{r.entityId.slice(-6)}</span> : null}
                </td>
                <td className="max-w-xs truncate px-4 py-2.5">{r.details}</td>
                <td className="px-4 py-2.5 text-slate">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-5 flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link className="btn btn-outline btn-sm" href={`?page=${page - 1}`}>
              {a.prev}
            </Link>
          )}
          <span>
            {a.page} {page} {a.of} {pages}
          </span>
          {page < pages && (
            <Link className="btn btn-outline btn-sm" href={`?page=${page + 1}`}>
              {a.next}
            </Link>
          )}
        </div>
      )}
    </AdminShell>
  );
}
