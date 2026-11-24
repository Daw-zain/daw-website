import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function Backup() {
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  return (
    <AdminShell title={a.backup} role="ADMIN">
      <div className="card max-w-2xl p-8">
        <p className="leading-7 text-slate">{a.backupText}</p>
        <a href="/api/admin/backup" className="btn btn-primary mt-6">
          ⤓ {a.downloadBackup}
        </a>
      </div>
    </AdminShell>
  );
}
