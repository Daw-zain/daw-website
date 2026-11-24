import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { RESOURCES } from "@/lib/admin-resources";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { formatDate } from "@/lib/utils";

const PAGE = 30;

function get(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), row);
}

export default async function ResourceList({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<{ q?: string; page?: string; saved?: string; deleted?: string }> }) {
  const { resource } = await params;
  const sp = await searchParams;
  const def = RESOURCES[resource];
  if (!def) notFound();
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim();
  const where = q && def.searchFields.length ? { OR: def.searchFields.map((f) => ({ [f]: { contains: q } })) } : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (db as any)[def.model];
  const [rows, total] = await Promise.all([
    m.findMany({ where, orderBy: def.orderBy, include: def.include, skip: (page - 1) * PAGE, take: PAGE }) as Promise<Record<string, unknown>[]>,
    m.count({ where }) as Promise<number>,
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <AdminShell
      title={def.title[lang]}
      role={def.role}
      actions={
        <Link href={`/admin/content/${resource}/new`} className="btn btn-primary btn-sm">
          + {a.add}
        </Link>
      }
    >
      {(sp.saved || sp.deleted) && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ {a.saved}</p>}
      {def.searchFields.length > 0 && (
        <form className="mb-5 flex max-w-md gap-2">
          <input name="q" defaultValue={q} placeholder={a.search} className="field py-2" />
          <button className="btn btn-outline btn-sm">{a.filter}</button>
        </form>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-mist text-slate">
            <tr>
              {def.list.map((c) => (
                <th key={c.field} className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                  {c.label[lang]}
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={def.list.length + 1} className="px-4 py-10 text-center text-slate">
                  {a.noItems}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={String(r.id)} className="hover:bg-sky-50/50">
                {def.list.map((c) => {
                  const v = get(r, c.field);
                  let out: React.ReactNode = v == null || v === "" ? "—" : String(v);
                  if (c.kind === "bool") out = v ? <span className="text-emerald-600">●</span> : <span className="text-slate/40">○</span>;
                  if (c.kind === "date" && v) out = formatDate(v as Date, lang);
                  if (c.kind === "chip" && v) out = <span className="chip bg-mist text-navy">{String(v)}</span>;
                  if (c.kind === "relation") out = (v as { titleAr?: string; titleEn?: string } | null)?.[lang === "ar" ? "titleAr" : "titleEn"] ?? "—";
                  return (
                    <td key={c.field} className="max-w-xs truncate px-4 py-3">
                      {out}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-4 py-3 text-end">
                  {def.publicPath && r.published ? (
                    <a href={def.publicPath(r) ?? "#"} target="_blank" className="me-3 text-slate hover:text-brand">
                      ↗
                    </a>
                  ) : null}
                  <Link href={`/admin/content/${resource}/${r.id}`} className="font-semibold text-brand hover:underline">
                    {a.edit}
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
            <Link className="btn btn-outline btn-sm" href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}>
              {a.prev}
            </Link>
          )}
          <span>
            {a.page} {page} {a.of} {pages}
          </span>
          {page < pages && (
            <Link className="btn btn-outline btn-sm" href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}>
              {a.next}
            </Link>
          )}
        </div>
      )}
    </AdminShell>
  );
}
