"use client";

import { useActionState, useMemo, useState } from "react";
import { submitRegistration, type FormState } from "@/app/actions/public";
import { Consent, Field, FormAlert, FormMeta, Select, Submit, SuccessPanel, TextArea, errText, type FormT } from "./FormKit";
import Link from "next/link";

export type ProgramOption = {
  id: string;
  title: string;
  status: string;
  sessions: { id: string; label: string; disabled: boolean }[];
};

export function RegistrationForm({
  locale,
  t,
  programs,
  defaultProgram,
  defaultSession,
  noSessionLabel,
  lockProgram = false,
  exploreLabel,
}: {
  locale: string;
  t: FormT;
  programs: ProgramOption[];
  defaultProgram?: string;
  defaultSession?: string;
  noSessionLabel: string;
  lockProgram?: boolean;
  exploreLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(submitRegistration, { ok: false });
  const v = state.values ?? {};
  const [programId, setProgramId] = useState(v.programId ?? defaultProgram ?? (programs.length === 1 ? programs[0].id : ""));
  const program = useMemo(() => programs.find((p) => p.id === programId), [programs, programId]);
  const e = (k: string) => errText(t, state.errors?.[k]);

  if (state.ok)
    return (
      <SuccessPanel text={t.success.registration}>
        <Link href={`/${locale}/programs`} className="btn btn-outline mt-6">
          {exploreLabel}
        </Link>
      </SuccessPanel>
    );

  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <FormMeta locale={locale} />
      <FormAlert state={state} t={t} />
      <div className="grid gap-5 sm:grid-cols-2">
        {lockProgram && program ? (
          <input type="hidden" name="programId" value={program.id} />
        ) : (
          <Select
            name="programId"
            label={t.program}
            t={t}
            required
            value={programId}
            onChange={(ev) => setProgramId(ev.target.value)}
            placeholder={t.select}
            options={programs.map((p) => ({ value: p.id, label: p.title }))}
            error={e("programId")}
            className={lockProgram ? "sm:col-span-2" : undefined}
          />
        )}
        <Select
          key={`${programId}-${defaultSession ?? ""}`}
          name="sessionId"
          label={t.session}
          t={t}
          defaultValue={v.sessionId ?? defaultSession ?? ""}
          options={[{ value: "", label: noSessionLabel }, ...(program?.sessions.map((s) => ({ value: s.id, label: s.label, disabled: s.disabled })) ?? [])]}
          error={e("sessionId")}
          className={lockProgram ? "sm:col-span-2" : undefined}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="fullName" label={t.fullName} t={t} required autoComplete="name" defaultValue={v.fullName} error={e("fullName")} />
        <Field name="email" type="email" label={t.email} t={t} required autoComplete="email" dir="ltr" defaultValue={v.email} error={e("email")} />
        <Field name="phone" type="tel" label={t.phone} t={t} required autoComplete="tel" dir="ltr" defaultValue={v.phone} error={e("phone")} />
        <Field name="organization" label={t.organization} t={t} autoComplete="organization" defaultValue={v.organization} />
        <Field name="jobTitle" label={t.jobTitle} t={t} autoComplete="organization-title" defaultValue={v.jobTitle} />
        <Field name="city" label={t.city} t={t} autoComplete="address-level2" defaultValue={v.city} />
      </div>
      <TextArea name="notes" label={t.notes} t={t} rows={3} defaultValue={v.notes} />
      <Consent t={t} locale={locale} error={e("consent")} />
      <div>
        <Submit pendingText={t.submitting}>{t.submitRegistration}</Submit>
      </div>
    </form>
  );
}
