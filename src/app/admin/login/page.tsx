import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { LogoMark } from "@/components/Logo";
import { AdminLoginForm } from "./LoginForm";

export default async function AdminLogin() {
  const user = await getCurrentUser();
  if (user && (user.role === "ADMIN" || user.role === "EDITOR")) redirect("/admin");
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  return (
    <div className="grid min-h-screen place-items-center bg-navy px-5">
      <div className="grid-bg pointer-events-none fixed inset-0" aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <LogoMark className="h-12 w-12" />
        <h1 className="mt-5 text-2xl font-bold">{a.login}</h1>
        <p className="mt-1 text-sm text-slate" dir="ltr">
          Al Daleel Raqamee · Admin
        </p>
        <div className="mt-6">
          <AdminLoginForm labels={{ email: a.email, password: a.password, login: a.login, invalidLogin: a.invalidLogin, tooMany: a.tooMany }} />
        </div>
      </div>
    </div>
  );
}
