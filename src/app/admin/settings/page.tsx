import { getSettings, type SettingKey } from "@/lib/settings";
import { getAdminDict, getAdminLang } from "@/lib/admin-i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminForm } from "@/components/admin/AdminForm";
import { saveSettings } from "../actions";
import { smtpSummary } from "@/lib/mail";
import { getCurrentUser } from "@/lib/auth";
import { SmtpTest } from "./SmtpTest";

type F = { key: SettingKey; label: { ar: string; en: string }; type?: "textarea" | "image" | "file"; ltr?: boolean; help?: { ar: string; en: string } };

const GROUPS: { title: { ar: string; en: string }; fields: F[] }[] = [
  {
    title: { ar: "بيانات التواصل", en: "Contact details" },
    fields: [
      { key: "contactEmail", label: { ar: "البريد الإلكتروني العام", en: "Public email" }, ltr: true },
      { key: "phone", label: { ar: "رقم الهاتف", en: "Phone" }, ltr: true },
      { key: "whatsapp", label: { ar: "رقم واتساب (بالصيغة الدولية، مثل 218912345678)", en: "WhatsApp number (international format, e.g. 218912345678)" }, ltr: true, help: { ar: "عند إدخاله يظهر زر واتساب العائم وأزرار الاستفسار.", en: "When set, the floating WhatsApp button and inquiry buttons appear." } },
      { key: "linkedin", label: { ar: "رابط لينكدإن", en: "LinkedIn URL" }, ltr: true },
      { key: "facebook", label: { ar: "رابط فيسبوك", en: "Facebook URL" }, ltr: true },
      { key: "youtube", label: { ar: "رابط يوتيوب", en: "YouTube URL" }, ltr: true },
      { key: "addressAr", label: { ar: "العنوان (عربي)", en: "Address (Arabic)" } },
      { key: "addressEn", label: { ar: "العنوان (إنجليزي)", en: "Address (English)" }, ltr: true },
      { key: "mapUrl", label: { ar: "رابط خرائط Google (رابط التضمين embed للخريطة)", en: "Google Maps URL (use the embed URL to show a map)" }, ltr: true },
      { key: "adminNotifyEmail", label: { ar: "بريد استقبال إشعارات الطلبات", en: "Email that receives request notifications" }, ltr: true },
    ],
  },
  {
    title: { ar: "الصور والملفات", en: "Images & files" },
    fields: [
      { key: "heroImage", label: { ar: "الصورة الشخصية في الواجهة (صورة حقيقية لصاحب الموقع)", en: "Hero portrait (real photo of the site owner)" }, type: "image", help: { ar: "يُفضل صورة عمودية 4:5 بجودة عالية بصيغة WebP أو JPG.", en: "Portrait 4:5, high quality, WebP or JPG recommended." } },
      { key: "aboutImage", label: { ar: "صورة صفحة من أنا (اختياري)", en: "About page photo (optional)" }, type: "image" },
      { key: "atpBadge", label: { ar: "شارة شريك التدريب المعتمد من PMI (اتركها فارغة لإخفائها)", en: "PMI Authorized Training Partner badge (leave empty to hide)" }, type: "image" },
      { key: "cvUrl", label: { ar: "ملف السيرة الذاتية PDF", en: "CV (PDF)" }, type: "file", help: { ar: "إن تُرك فارغًا، يُستخدم ملف السيرة القابل للطباعة المُنشأ تلقائيًا.", en: "If empty, the auto-generated printable CV page is used." } },
    ],
  },
  {
    title: { ar: "نصوص الصفحة الرئيسية (اختياري – تستبدل النص الافتراضي)", en: "Home page text (optional – overrides the default)" },
    fields: [
      { key: "heroTitleAr", label: { ar: "العنوان الرئيسي (عربي، سطر لكل جملة)", en: "Headline (Arabic, one sentence per line)" }, type: "textarea" },
      { key: "heroTitleEn", label: { ar: "العنوان الرئيسي (إنجليزي)", en: "Headline (English)" }, type: "textarea", ltr: true },
      { key: "heroTextAr", label: { ar: "النبذة (عربي)", en: "Intro (Arabic)" }, type: "textarea" },
      { key: "heroTextEn", label: { ar: "النبذة (إنجليزي)", en: "Intro (English)" }, type: "textarea", ltr: true },
      { key: "whatsappMessageAr", label: { ar: "رسالة واتساب الجاهزة (عربي)", en: "WhatsApp pre-filled message (Arabic)" } },
      { key: "whatsappMessageEn", label: { ar: "رسالة واتساب الجاهزة (إنجليزي)", en: "WhatsApp pre-filled message (English)" }, ltr: true },
    ],
  },
  {
    title: { ar: "سياسة الخصوصية (Markdown، اختياري)", en: "Privacy policy (Markdown, optional)" },
    fields: [
      { key: "privacyAr", label: { ar: "النص العربي", en: "Arabic text" }, type: "textarea" },
      { key: "privacyEn", label: { ar: "النص الإنجليزي", en: "English text" }, type: "textarea", ltr: true },
    ],
  },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  const lang = await getAdminLang();
  const a = getAdminDict(lang);
  const s = await getSettings();
  const me = await getCurrentUser();
  const labels = Object.fromEntries(GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label[lang]])));

  return (
    <AdminShell title={a.settings} role="ADMIN">
      {sp.saved && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">✓ {a.saved}</p>}
      <div className="max-w-4xl space-y-6">
        <SmtpTest summary={smtpSummary()} defaultTo={s.adminNotifyEmail || process.env.ADMIN_NOTIFY_EMAIL || me?.email || ""} lang={lang} />
        <AdminForm action={saveSettings} labels={labels} lang={lang} submitLabel={a.save} errorTitle={a.errors} multipart>
          {GROUPS.map((g) => (
            <fieldset key={g.title.en} className="rounded-2xl border border-line bg-white p-6">
              <legend className="px-2 text-lg font-bold text-navy">{g.title[lang]}</legend>
              <div className="grid gap-5 md:grid-cols-2">
                {g.fields.map((f) => (
                  <div key={f.key} className={f.type ? "md:col-span-2" : undefined}>
                    <label htmlFor={f.key} className="field-label">
                      {f.label[lang]}
                    </label>
                    {f.type === "textarea" ? (
                      <textarea id={f.key} name={f.key} defaultValue={s[f.key]} rows={f.key.startsWith("privacy") ? 10 : 3} className="field" dir={f.ltr ? "ltr" : undefined} />
                    ) : f.type === "image" || f.type === "file" ? (
                      <div className="space-y-2 rounded-xl border border-line p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {f.type === "image" && s[f.key] && <img src={s[f.key]} alt="" className="h-32 rounded-lg object-cover" />}
                        <input id={f.key} name={f.key} defaultValue={s[f.key]} className="field" dir="ltr" placeholder="/uploads/…" />
                        <input type="file" name={`${f.key}__file`} accept={f.type === "image" ? "image/jpeg,image/png,image/webp,image/avif" : "application/pdf"} className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-sky file:px-3 file:py-1.5 file:font-semibold file:text-navy" />
                      </div>
                    ) : (
                      <input id={f.key} name={f.key} defaultValue={s[f.key]} className="field" dir={f.ltr ? "ltr" : undefined} />
                    )}
                    {f.help && <p className="mt-1 text-xs text-slate">{f.help[lang]}</p>}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </AdminForm>
      </div>
    </AdminShell>
  );
}
