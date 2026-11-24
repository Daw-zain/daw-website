import type { Metadata } from "next";
import { isLocale, type Locale } from "@/lib/constants";
import { getDictionary } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { renderMarkdown } from "@/lib/markdown";
import { pageMeta } from "@/lib/seo";
import { PageHero } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMeta({ locale, path: "/privacy", title: t.privacy.title });
}

const defaultAr = `## البيانات التي نجمعها
عند تعبئة نماذج التسجيل أو الاستشارة أو التدريب المؤسسي أو التواصل أو الاشتراك في النشرة البريدية، نجمع البيانات التي تقدمها مثل الاسم والبريد الإلكتروني ورقم الهاتف وجهة العمل وتفاصيل طلبك، وأي ملف ترفقه.

## كيف نستخدم البيانات
- للرد على طلبك والتواصل معك بشأنه.
- لإدارة التسجيل في البرامج والدورات.
- لإرسال النشرة البريدية فقط لمن أكد اشتراكه، مع إمكانية الإلغاء في أي وقت عبر الرابط الموجود في كل رسالة.

## مشاركة البيانات
لا نبيع بياناتك ولا نشاركها مع أطراف ثالثة لأغراض تسويقية. قد تُعالج البيانات لدى مزودي خدمات تقنية (مثل الاستضافة والبريد الإلكتروني) لغرض تشغيل الموقع فقط.

## الاحتفاظ والحماية
نحتفظ بالبيانات للمدة اللازمة لتقديم الخدمة أو وفق المتطلبات النظامية، ونستخدم اتصالًا مشفرًا (HTTPS) وصلاحيات وصول محدودة لحمايتها.

## ملفات تعريف الارتباط
يستخدم الموقع ملفات تعريف ارتباط ضرورية لحفظ اللغة المختارة وجلسة تسجيل الدخول. وفي حال تفعيل أدوات التحليلات، تُستخدم بصورة مجمّعة لتحسين الموقع.

## حقوقك
يمكنك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها عبر صفحة التواصل.`;

const defaultEn = `## Data we collect
When you complete the registration, consultation, corporate training, contact or newsletter forms, we collect the information you provide — such as your name, email, phone number, organization, the details of your request, and any file you attach.

## How we use it
- To respond to and follow up on your request.
- To manage registrations for programs and sessions.
- To send the newsletter only to people who confirmed their subscription; you can unsubscribe at any time using the link in every email.

## Sharing
We do not sell your data or share it with third parties for marketing. Data may be processed by technical service providers (such as hosting and email) solely to operate this website.

## Retention and security
We keep data only as long as needed to provide the service or as required by law, and protect it using encrypted connections (HTTPS) and restricted access.

## Cookies
The site uses essential cookies to remember your language and sign-in session. If analytics is enabled, it is used in aggregate to improve the site.

## Your rights
You can ask to access, correct or delete your data via the contact page.`;

export default async function Privacy({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDictionary(locale);
  const settings = await getSettings();
  const body = (locale === "ar" ? settings.privacyAr : settings.privacyEn) || (locale === "ar" ? defaultAr : defaultEn);
  return (
    <>
      <PageHero title={t.privacy.title} crumbs={[{ href: `/${locale}`, label: t.common.breadcrumbHome }, { label: t.privacy.title }]} />
      <section className="py-14">
        <div className="container-x max-w-3xl">
          <div className="prose-site" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        </div>
      </section>
    </>
  );
}
