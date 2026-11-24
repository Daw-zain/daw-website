import "../globals.css";
import type { Metadata } from "next";
import { inter, plexArabic } from "../fonts";
import { getAdminLang } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin | Daw Zainelabideen", robots: { index: false, follow: false } };

export default async function AdminRoot({ children }: { children: React.ReactNode }) {
  const lang = await getAdminLang();
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`${inter.variable} ${plexArabic.variable}`}>
      <body className="min-h-screen bg-mist">{children}</body>
    </html>
  );
}
