import { getCurrentUser } from "@/lib/auth";
import { getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { PasswordForm } from "./PasswordForm";

export default async function Profile() {
  const lang = await getAdminLang();
  const user = await getCurrentUser();
  const ar = lang === "ar";
  return (
    <AdminShell title={ar ? "حسابي" : "My account"}>
      <div className="card max-w-md p-8">
        <p className="font-semibold text-navy">{user?.name}</p>
        <p className="text-sm text-slate" dir="ltr">
          {user?.email} · {user?.role}
        </p>
        <h2 className="mt-6 text-lg font-bold">{ar ? "تغيير كلمة المرور" : "Change password"}</h2>
        <PasswordForm labels={{ current: ar ? "كلمة المرور الحالية" : "Current password", next: ar ? "كلمة المرور الجديدة (10 أحرف على الأقل)" : "New password (min. 10 characters)", save: ar ? "حفظ" : "Save", ok: ar ? "تم تغيير كلمة المرور." : "Password changed.", invalid: ar ? "كلمة المرور الحالية غير صحيحة." : "Current password is incorrect.", short: ar ? "كلمة المرور قصيرة." : "Password too short." }} />
      </div>
    </AdminShell>
  );
}
