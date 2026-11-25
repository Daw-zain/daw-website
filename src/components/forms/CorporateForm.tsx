"use client";

import { useActionState } from "react";
import { submitCorporate, type FormState } from "@/app/actions/public";
import { WithQuery } from "@/components/WithQuery";
import { IS_STATIC } from "@/lib/env-public";
import { Consent, Field, FormAlert, FormMeta, Select, Submit, SuccessPanel, TextArea, errText, type FormT } from "./FormKit";

type Props = {
  locale: string;
  t: FormT;
  sectors: Record<string, string>;
  modes: Record<string, string>;
  programs: { value: string; slug?: string; label: string }[];
  preselected?: string;
};

/** ?program=<slug> in the URL preselects the program */
export function CorporateForm(props: Props) {
  return (
    <WithQuery fallback={<CorporateFormInner {...props} />}>
      {(q) => <CorporateFormInner {...props} preselected={props.preselected ?? props.programs.find((p) => p.slug === q.get("program"))?.value} />}
    </WithQuery>
  );
}

function CorporateFormInner({
  locale,
  t,
  sectors,
  modes,
  programs,
  preselected,
}: {
  locale: string;
  t: FormT;
  sectors: Record<string, string>;
  modes: Record<string, string>;
  programs: { value: string; label: string }[];
  preselected?: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(submitCorporate, { ok: false });
  const v = state.values ?? {};
  const e = (k: string) => errText(t, state.errors?.[k]);
  if (state.ok) return <SuccessPanel text={t.success.corporate} />;

  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <FormAlert state={state} t={t} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="organization" label={t.organization} t={t} required autoComplete="organization" defaultValue={v.organization} error={e("organization")} />
        <Select
          name="sector"
          label={t.sector}
          t={t}
          required
          defaultValue={v.sector ?? ""}
          placeholder={t.select}
          options={Object.entries(sectors).map(([value, label]) => ({ value, label }))}
          error={e("sector")}
        />
        <Field name="traineesCount" type="number" min={1} inputMode="numeric" label={t.traineesCount} t={t} defaultValue={v.traineesCount} error={e("traineesCount")} />
        <Select
          name="mode"
          label={t.mode}
          t={t}
          required
          defaultValue={v.mode ?? "IN_PERSON"}
          options={Object.entries(modes).map(([value, label]) => ({ value, label }))}
          error={e("mode")}
        />
      </div>

      <fieldset>
        <legend className="field-label">
          {t.programsRequested} <span className="text-red-600">*</span>
        </legend>
        <div className="grid gap-2 rounded-xl border border-line p-4 sm:grid-cols-2" aria-invalid={!!e("programs")}>
          {programs.map((p) => (
            <label key={p.value} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink transition hover:bg-mist">
              <input type="checkbox" name="programs" value={p.value} className="h-4 w-4 accent-brand" defaultChecked={v.programs ? v.programs.includes(p.value) : p.value === preselected} />
              {p.label}
            </label>
          ))}
        </div>
        {e("programs") && <p className="field-error">{e("programs")}</p>}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="duration" label={t.durationProposed} t={t} defaultValue={v.duration} />
        <Field name="contactName" label={t.name} t={t} required autoComplete="name" defaultValue={v.contactName} error={e("contactName")} />
        <Field name="jobTitle" label={t.jobTitle} t={t} autoComplete="organization-title" defaultValue={v.jobTitle} />
        <Field name="email" type="email" label={t.email} t={t} required dir="ltr" autoComplete="email" defaultValue={v.email} error={e("email")} />
        <Field name="phone" type="tel" label={t.phone} t={t} required dir="ltr" autoComplete="tel" defaultValue={v.phone} error={e("phone")} />
        {/* The static (GitHub Pages) site has no file storage: files are sent by email after the request. */}
        {!IS_STATIC && (
          <Field
            name="attachment"
            type="file"
            label={t.attachment}
            t={t}
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            error={e("attachment")}
            className="[&_input]:py-2.5 [&_input]:file:me-3 [&_input]:file:rounded-lg [&_input]:file:border-0 [&_input]:file:bg-sky [&_input]:file:px-3 [&_input]:file:py-1.5 [&_input]:file:font-semibold [&_input]:file:text-navy"
          />
        )}
      </div>
      <TextArea name="notes" label={t.notes} t={t} rows={3} defaultValue={v.notes} />
      <Consent t={t} locale={locale} error={e("consent")} />
      <div>
        <Submit pendingText={t.submitting}>{t.submit}</Submit>
      </div>
    </form>
  );
}
