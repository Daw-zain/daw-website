"use client";

import { useActionState } from "react";
import { submitConsultation, type FormState } from "@/app/actions/public";
import { WithQuery } from "@/components/WithQuery";
import { Consent, Field, FormAlert, FormMeta, Select, Submit, SuccessPanel, TextArea, errText, type FormT } from "./FormKit";

type Props = {
  locale: string;
  t: FormT;
  services: { id: string; slug?: string; title: string }[];
  methods: Record<string, string>;
  defaultService?: string;
};

/** ?service=<slug> in the URL preselects the service */
export function ConsultationForm(props: Props) {
  return (
    <WithQuery fallback={<ConsultationFormInner {...props} />}>
      {(q) => <ConsultationFormInner {...props} defaultService={props.defaultService ?? props.services.find((s) => s.slug === q.get("service"))?.id} />}
    </WithQuery>
  );
}

function ConsultationFormInner({
  locale,
  t,
  services,
  methods,
  defaultService,
}: {
  locale: string;
  t: FormT;
  services: { id: string; title: string }[];
  methods: Record<string, string>;
  defaultService?: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(submitConsultation, { ok: false });
  const v = state.values ?? {};
  const e = (k: string) => errText(t, state.errors?.[k]);
  if (state.ok) return <SuccessPanel text={t.success.consultation} />;

  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <FormAlert state={state} t={t} />
      <Select
        name="serviceId"
        label={t.service}
        t={t}
        defaultValue={v.serviceId ?? defaultService ?? ""}
        options={[{ value: "", label: t.generalConsultation }, ...services.map((s) => ({ value: s.id, label: s.title }))]}
      />
      <TextArea name="description" label={t.needDescription} t={t} required rows={4} defaultValue={v.description} error={e("description")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="name" label={t.name} t={t} required autoComplete="name" defaultValue={v.name} error={e("name")} />
        <Field name="organization" label={t.organization} t={t} autoComplete="organization" defaultValue={v.organization} />
        <Field name="email" type="email" label={t.email} t={t} required dir="ltr" autoComplete="email" defaultValue={v.email} error={e("email")} />
        <Field name="phone" type="tel" label={t.phone} t={t} dir="ltr" autoComplete="tel" defaultValue={v.phone} error={e("phone")} />
        <Select
          name="contactMethod"
          label={t.contactMethod}
          t={t}
          required
          defaultValue={v.contactMethod ?? "EMAIL"}
          options={Object.entries(methods).map(([value, label]) => ({ value, label }))}
          error={e("contactMethod")}
        />
        <Field name="preferredDate" type="date" label={t.preferredDate} t={t} defaultValue={v.preferredDate} min={new Date().toISOString().slice(0, 10)} />
      </div>
      <Consent t={t} locale={locale} error={e("consent")} />
      <div>
        <Submit pendingText={t.submitting}>{t.submit}</Submit>
      </div>
    </form>
  );
}
