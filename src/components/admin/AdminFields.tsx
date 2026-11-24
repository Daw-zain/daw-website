import { db } from "@/lib/db";
import type { FieldDef } from "@/lib/admin-resources";
import type { AdminLang } from "@/lib/admin-i18n";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown> | null;

function toInput(v: unknown, type: FieldDef["type"]) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return type === "date" ? v.toISOString().slice(0, 10) : v.toISOString();
  return String(v);
}

function Control({ f, col, value, dir, lang }: { f: FieldDef; col: string; value: unknown; dir?: "rtl" | "ltr"; lang: AdminLang }) {
  const common = { id: col, name: col, className: "field", dir: f.ltr ? "ltr" : dir } as const;
  switch (f.type) {
    case "textarea":
    case "markdown":
    case "json":
      return <textarea {...common} rows={f.rows ?? (f.type === "json" ? 8 : 4)} defaultValue={toInput(value, f.type)} className={cn("field", (f.type === "markdown" || f.type === "json") && "font-mono text-sm")} dir={f.type === "json" ? "ltr" : common.dir} />;
    case "number":
      return <input {...common} type="number" step={1} defaultValue={toInput(value, f.type)} dir="ltr" />;
    case "date":
      return <input {...common} type="date" defaultValue={value === undefined && f.required && f.name === "publishedAt" ? new Date().toISOString().slice(0, 10) : toInput(value, f.type)} dir="ltr" />;
    case "password":
      return <input {...common} type="password" autoComplete="new-password" dir="ltr" />;
    case "checkbox":
      return (
        <label className="inline-flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3">
          <input type="checkbox" name={col} id={col} defaultChecked={value === undefined || value === null ? !!f.default : !!value} className="h-5 w-5 accent-brand" />
          <span className="text-sm font-semibold text-navy">{f.label[lang]}</span>
        </label>
      );
    case "select":
      return (
        <select {...common} defaultValue={toInput(value, f.type)} className="field appearance-auto">
          {!f.required && <option value="">—</option>}
          {f.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "image":
    case "file": {
      const url = toInput(value, f.type);
      return (
        <div className="space-y-2 rounded-xl border border-line bg-white p-3">
          {url && f.type === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-28 rounded-lg border border-line object-cover" />
          )}
          <input {...common} type="text" defaultValue={url} placeholder="/uploads/… or https://…" dir="ltr" />
          <input
            type="file"
            name={`${col}__file`}
            accept={f.type === "image" ? "image/jpeg,image/png,image/webp,image/avif,image/svg+xml" : undefined}
            className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-sky file:px-3 file:py-1.5 file:font-semibold file:text-navy"
          />
        </div>
      );
    }
    default:
      return <input {...common} type="text" defaultValue={toInput(value, f.type)} />;
  }
}

async function RelationControl({ f, value }: { f: FieldDef; value: unknown }) {
  const rel = f.relation!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: { id: string; [k: string]: unknown }[] = await (db as any)[rel.model].findMany({ orderBy: rel.orderBy, select: { id: true, [rel.label]: true } });
  return (
    <select id={f.name} name={f.name} defaultValue={toInput(value, "text")} className="field appearance-auto" required={f.required}>
      <option value="">—</option>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {String(r[rel.label])}
        </option>
      ))}
    </select>
  );
}

export function fieldLabels(fields: FieldDef[], lang: AdminLang) {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.bilingual) {
      out[`${f.name}Ar`] = `${f.label[lang]} (AR)`;
      out[`${f.name}En`] = `${f.label[lang]} (EN)`;
    } else out[f.name] = f.label[lang];
  }
  return out;
}

export async function AdminFields({ fields, row, lang }: { fields: FieldDef[]; row: Row; lang: AdminLang }) {
  const val = (c: string) => (row ? row[c] : undefined);
  const flags = fields.filter((f) => f.type === "checkbox");
  const others = fields.filter((f) => f.type !== "checkbox");
  return (
    <div className="space-y-6">
      {others.map((f) => (
        <div key={f.name} className="rounded-2xl border border-line bg-white p-5">
          {f.bilingual ? (
            <>
              <p className="mb-3 text-sm font-bold text-navy">
                {f.label[lang]} {f.required && <span className="text-rose-600">*</span>}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label htmlFor={`${f.name}Ar`} className="mb-1 block text-xs font-semibold text-slate">
                    العربية
                  </label>
                  <Control f={f} col={`${f.name}Ar`} value={val(`${f.name}Ar`)} dir="rtl" lang={lang} />
                </div>
                <div>
                  <label htmlFor={`${f.name}En`} className="mb-1 block text-xs font-semibold text-slate">
                    English
                  </label>
                  <Control f={f} col={`${f.name}En`} value={val(`${f.name}En`)} dir="ltr" lang={lang} />
                </div>
              </div>
            </>
          ) : (
            <>
              <label htmlFor={f.name} className="mb-2 block text-sm font-bold text-navy">
                {f.label[lang]} {f.required && <span className="text-rose-600">*</span>}
              </label>
              {f.type === "relation" ? <RelationControl f={f} value={val(f.name)} /> : <Control f={f} col={f.name} value={val(f.name)} lang={lang} />}
            </>
          )}
          {f.help && <p className="mt-2 text-xs leading-5 text-slate">{f.help[lang]}</p>}
        </div>
      ))}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {flags.map((f) => (
            <div key={f.name}>
              <Control f={f} col={f.name} value={val(f.name)} lang={lang} />
              {f.help && <p className="mt-1 max-w-sm text-xs text-slate">{f.help[lang]}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
