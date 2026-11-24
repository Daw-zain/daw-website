import Link from "next/link";
import { notFound } from "next/navigation";
import { INBOX, type InboxKey } from "@/lib/inbox";
import { INBOX_VIEW, cell } from "@/lib/inbox-config";
import { getAdminDict, getAdminLang, statusLabels } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { cn } from "@/lib/utils";

const PAGE = 30;
const LIST_COLS = 6;

export default async function InboxList({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ status?: string; page?: string; q?: string; deleted?: string }> }) {
  const { type } = await params;
  const sp = await searchParams;
  if (!(type in INBOX)) notFound();
  const key = type as InboxKey;
  const cfg = INBOX[key];
  const view = INBOX_VIEW[key];
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const st = statusLabels[lang];
  const status = (cfg.statuses as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const q = (sp.q ?? "").trim();
  const searchKey = key === "corporate" ? "organization" : key === "registrations" ? "fullName" : "name";
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ email: { contains: q } }, { [searchKey]: { contains: q } }] } : {}),
  };
  const page = Math.max(1, Number(sp.page) || 1);
  const [rows, total] = await Promise.all([view.load(where, (page - 1) * PAGE, PAGE), view.count(where)]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (patch: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ status, q: q || undefined, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `?${s}` : "?";
  };

  return (
    <AdminShell
      title={view.title[lang]}
      actions={
        <a href={`/api/admin/export/${key}${status ? `?status=${status}` : ""}`} className="btn btn-outline btn-sm">
          ⤓ {a.exportCsv}
        </a>
      }
    >
      {sp.deleted && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓</p>}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {[undefined, ...cfg.statuses].map((s) => (
          <Link key={s ?? "all"} href={qs({ status: s, page: undefined })} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", status === s ? "border-navy bg-navy text-white" : "border-line bg-white text-navy hover:border-brand")}>
            {s ? st[s] : a.all}
          </Link>
        ))}
        <form className="ms-auto flex gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder={a.search} className="field py-2" />
        </form>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist text-slate">
            <tr>
              {view.cols.slice(0, LIST_COLS).map((c) => (
                <th key={c.key} className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                  {c.label[lang]}
                </th>
              ))}
              <th className="px-4 py-3 text-start font-semibold">{a.status}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={LIST_COLS + 2} className="px-4 py-10 text-center text-slate">
                  {a.noItems}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={String(r.id)} className={cn("hover:bg-sky-50/50", r.status === "NEW" && "font-semibold")}>
                {view.cols.slice(0, LIST_COLS).map((c) => (
                  <td key={c.key} className="max-w-[220px] truncate px-4 py-3" dir={["email", "phone"].includes(c.key) ? "ltr" : undefined}>
                    {cell(key === "registrations" && c.key === "program" && lang === "ar" ? r.programAr : r[c.key], lang)}
                  </td>
                ))}
                <td className="px-4 py-3">
                  <span className={cn("chip", r.status === "NEW" ? "bg-gold/20 text-gold-600" : "bg-mist text-navy")}>{st[String(r.status)] ?? String(r.status)}</span>
                </td>
                <td className="px-4 py-3 text-end">
                  <Link href={`/admin/inbox/${key}/${r.id}`} className="font-semibold text-brand hover:underline">
                    {a.open}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-5 flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link className="btn btn-outline btn-sm" href={qs({ page: String(page - 1) })}>
              {a.prev}
            </Link>
          )}
          <span>
            {a.page} {page} {a.of} {pages}
          </span>
          {page < pages && (
            <Link className="btn btn-outline btn-sm" href={qs({ page: String(page + 1) })}>
              {a.next}
            </Link>
          )}
        </div>
      )}
    </AdminShell>
  );
}
