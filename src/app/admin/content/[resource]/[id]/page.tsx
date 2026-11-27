import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { RESOURCES } from "@/lib/admin-resources";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminFields, fieldLabels } from "@/components/admin/AdminFields";
import { AdminForm, ConfirmButton } from "@/components/admin/AdminForm";
import { courseDependents } from "@/lib/course-guard";
import { deleteResource, saveResource } from "../../../actions";

export default async function ResourceEdit({ params, searchParams }: { params: Promise<{ resource: string; id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { resource, id } = await params;
  const sp = await searchParams;
  const def = RESOURCES[resource];
  if (!def) notFound();
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const isNew = id === "new";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = isNew ? null : ((await (db as any)[def.model].findUnique({ where: { id } })) as Record<string, unknown> | null);
  if (!isNew && !row) notFound();
  if (row && "passwordHash" in row) delete row.passwordHash;

  // what a course holds: while there is anything, the delete button is replaced by an explanation
  const holds = !isNew && def.model === "program" ? await courseDependents(db, id) : [];

  const save = saveResource.bind(null, resource, isNew ? null : id);
  const del = deleteResource.bind(null, resource, id);
  const title = `${def.title[lang]} – ${isNew ? a.add : a.edit}`;

  return (
    <AdminShell
      title={title}
      role={def.role}
      actions={
        <Link href={`/admin/content/${resource}`} className="btn btn-outline btn-sm">
          ← {a.back}
        </Link>
      }
    >
      {sp.error === "self" && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{lang === "ar" ? "لا يمكنك حذف حسابك." : "You can't delete your own account."}</p>}
      {sp.error === "hasData" && (
        <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {lang === "ar" ? "لم تُحذف الدورة لأنها تحتوي بيانات. أزل علامة «منشور» لإخفائها." : "The course was not deleted because it holds data. Switch “published” off to hide it."}
        </p>
      )}
      <div className="max-w-5xl">
        <AdminForm action={save} labels={fieldLabels(def.fields, lang)} lang={lang} submitLabel={a.save} errorTitle={a.errors} multipart>
          <AdminFields fields={def.fields} row={row} lang={lang} />
        </AdminForm>
        {!isNew && (
          <div className="mt-6 flex items-center justify-between border-t border-line pt-6 text-xs text-slate">
            <span>
              {row?.updatedAt instanceof Date ? `${a.updated}: ${row.updatedAt.toLocaleString(lang === "ar" ? "ar-LY-u-nu-latn" : "en-GB")}` : ""}
            </span>
            {holds.length === 0 ? (
              <ConfirmButton action={del} label={a.delete} confirm={a.confirmDelete} />
            ) : (
              <p className="max-w-xl text-sm leading-6 text-navy">
                {lang === "ar" ? "لا يمكن حذف هذه الدورة لأن فيها: " : "This course cannot be deleted because it holds: "}
                {holds.map((h) => `${h[lang]} (${h.count})`).join(lang === "ar" ? "، " : ", ")}
                {lang === "ar" ? ". لإخفائها أزل علامة «منشور» ثم احفظ." : ". To hide it, switch “published” off and save."}
              </p>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
