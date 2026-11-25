"use client";

import { useEffect, useState } from "react";
import { newsletterToken } from "@/app/actions/public";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { CheckIcon } from "@/components/Icons";
import { WithQuery } from "./WithQuery";
import type { Dictionary } from "@/dictionaries/en";

type Props = { locale: string; t: Dictionary["newsletter"]; errors: Dictionary["forms"]["errors"] };

/** Handles ?action=confirm|unsubscribe&token=… links from newsletter emails, then shows the sign-up form. */
export function NewsletterStatus(props: Props) {
  return (
    <WithQuery fallback={<NewsletterForm locale={props.locale} t={props.t} errors={props.errors} />}>
      {(q) => <Status {...props} action={q.get("action") ?? ""} token={q.get("token") ?? ""} />}
    </WithQuery>
  );
}

function Status({ locale, t, errors, action, token }: Props & { action: string; token: string }) {
  const [result, setResult] = useState<"confirmed" | "unsubscribed" | "invalid" | null>(null);
  useEffect(() => {
    if (!action) return;
    if (!token) return setResult("invalid");
    newsletterToken(action, token).then(setResult, () => setResult("invalid"));
  }, [action, token]);

  const ok = result === "confirmed" || result === "unsubscribed";
  return (
    <>
      {result && (
        <div className={`mb-8 flex items-center gap-3 rounded-2xl p-5 ${ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`} role="status">
          {ok && <CheckIcon className="h-6 w-6 shrink-0" />}
          <p className="font-semibold">{t[result]}</p>
        </div>
      )}
      {result !== "confirmed" && <NewsletterForm locale={locale} t={t} errors={errors} />}
    </>
  );
}
