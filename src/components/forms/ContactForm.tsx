"use client";

import { useActionState } from "react";
import { submitContact, type FormState } from "@/app/actions/public";
import { WithQuery } from "@/components/WithQuery";
import { Consent, Field, FormAlert, FormMeta, Submit, SuccessPanel, TextArea, errText, type FormT } from "./FormKit";

type Props = { locale: string; t: FormT; defaultSubject?: string };

/** ?subject=… in the URL pre-fills the subject */
export function ContactForm(props: Props) {
  return <WithQuery fallback={<ContactFormInner {...props} />}>{(q) => <ContactFormInner {...props} defaultSubject={props.defaultSubject ?? q.get("subject") ?? undefined} />}</WithQuery>;
}

function ContactFormInner({ locale, t, defaultSubject }: Props) {
  const [state, action] = useActionState<FormState, FormData>(submitContact, { ok: false });
  const v = state.values ?? {};
  const e = (k: string) => errText(t, state.errors?.[k]);
  if (state.ok) return <SuccessPanel text={t.success.contact} />;

  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <FormAlert state={state} t={t} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label={t.name} t={t} required autoComplete="name" defaultValue={v.name} error={e("name")} />
        <Field name="email" type="email" label={t.email} t={t} required dir="ltr" autoComplete="email" defaultValue={v.email} error={e("email")} />
        <Field name="phone" type="tel" label={t.phone} t={t} dir="ltr" autoComplete="tel" defaultValue={v.phone} error={e("phone")} />
        <Field name="subject" label={t.subject} t={t} required defaultValue={v.subject ?? defaultSubject} error={e("subject")} />
      </div>
      <TextArea name="message" label={t.message} t={t} required rows={5} defaultValue={v.message} error={e("message")} />
      <Consent t={t} locale={locale} error={e("consent")} />
      <div>
        <Submit pendingText={t.submitting}>{t.submit}</Submit>
      </div>
    </form>
  );
}
