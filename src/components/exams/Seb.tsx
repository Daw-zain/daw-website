"use client";

/** Safe Exam Browser screens: how to open an exam in it, the status / settings page, and the quit link. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { rpc, useExamSession } from "@/lib/exams/client";
import { insideSeb, SEB_DOWNLOAD, SEB_FILE, SEB_QUIT, sebLaunchLink } from "@/lib/exams/seb";
import { cn } from "@/lib/utils";
import { ExamShell, Notice, Spinner, type ExamLabels } from "./ExamShell";

/** shown instead of the exam when SEB is required and this window is not accepted */
export function SebGate({ locale, labels }: { locale: string; labels: ExamLabels }) {
  const t = labels.seb;
  const [open, setOpen] = useState("");
  const [inside, setInside] = useState(false);
  useEffect(() => {
    setOpen(sebLaunchLink());
    setInside(insideSeb());
  }, []);
  return (
    <div className="card space-y-4 border-gold/50 p-6">
      <h2 className="text-xl font-bold text-navy">{t.gateTitle}</h2>
      {inside ? <Notice tone="error">{t.notAccepted}</Notice> : <p className="leading-7 text-ink">{t.gateText}</p>}
      <ol className="list-inside list-decimal space-y-2 text-sm leading-7 text-ink">
        <li>
          {t.stepInstall}{" "}
          <a href={SEB_DOWNLOAD} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">
            safeexambrowser.org
          </a>
        </li>
        <li>{t.stepOpen}</li>
        <li>{t.stepSignIn}</li>
      </ol>
      <div className="flex flex-wrap gap-3">
        <a href={open || SEB_FILE()} className="btn btn-primary">{t.openInSeb}</a>
        <a href={SEB_FILE()} download="daleel.seb" className="btn btn-outline">{t.downloadFile}</a>
      </div>
      <p className="text-sm text-slate">{t.devices}</p>
      <Link href={`/${locale}/exams/seb`} className="inline-block text-sm font-semibold text-brand hover:underline">{t.checkDevice}</Link>
    </div>
  );
}

/** inside SEB, after an exam: closes the program */
export function SebQuit({ labels }: { labels: ExamLabels }) {
  const [inside, setInside] = useState(false);
  useEffect(() => setInside(insideSeb()), []);
  if (!inside) return null;
  return <a href={SEB_QUIT()} className="btn btn-outline">{labels.seb.quit}</a>;
}

type Status = { enabled: boolean; accepted: boolean; canManage: boolean; configKeys: string[] | null; siteUrl: string | null };

/** /[locale]/exams/seb — check this device; the super admin also turns the requirement on or off */
export function SebPage({ locale, labels, homeLabel }: { locale: string; labels: ExamLabels; homeLabel: string }) {
  const { state, reload } = useExamSession(locale);
  const t = labels.seb;
  const [st, setSt] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [inside, setInside] = useState(false);
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    rpc<Status>("exam_seb_status").then(setSt).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (state.status !== "ready") return;
    setInside(insideSeb());
    load();
  }, [state.status, load]);

  const save = async (data: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      setSt(await rpc<Status>("exam_seb_save", { p_data: data }));
      setExtra("");
      setMsg({ tone: "success", text: t.saved });
    } catch (e) {
      const m = (e as Error).message;
      setMsg({ tone: "error", text: /invalid_seb: key/.test(m) ? t.badKey : /no_key/.test(m) ? t.noKey : labels.errorGeneric });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ExamShell
      locale={locale}
      labels={labels}
      state={state}
      reload={reload}
      title={t.pageTitle}
      crumbs={[{ href: `/${locale}`, label: homeLabel }, { href: `/${locale}/exams`, label: labels.title }, { label: t.pageTitle }]}
    >
      {() =>
        failed ? <Notice tone="error">{labels.errorGeneric}</Notice> : !st ? <Spinner /> : (
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="card space-y-3 p-6">
              <h2 className="text-lg font-bold text-navy">{t.thisDevice}</h2>
              <p className={cn("rounded-xl px-4 py-3 font-semibold", st.accepted ? "bg-emerald-50 text-emerald-700" : "bg-gold/10 text-gold-600")}>
                {st.accepted ? t.accepted : inside ? t.notAccepted : t.notInside}
              </p>
              <p className="text-sm text-slate">{st.enabled ? t.isOn : t.isOff}</p>
            </div>
            {!st.accepted && <SebGate locale={locale} labels={labels} />}
            {st.accepted && <SebQuit labels={labels} />}
            {st.canManage && (
              <div className="card space-y-4 p-6">
                <h2 className="text-lg font-bold text-navy">{t.adminTitle}</h2>
                <p className="text-sm leading-7 text-slate">{t.adminHint}</p>
                <label className="flex items-center gap-3 font-semibold text-navy">
                  <input
                    type="checkbox"
                    checked={st.enabled}
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.checked && !window.confirm(t.confirmOn)) return;
                      save({ enabled: e.target.checked });
                    }}
                    className="h-5 w-5 accent-[var(--color-brand)]"
                  />
                  {t.enableAll}
                </label>
                <div className="text-sm">
                  <p className="field-label">{t.keys}</p>
                  <ul className="space-y-1">
                    {(st.configKeys ?? []).map((k) => (
                      <li key={k} className="flex flex-wrap items-center gap-2">
                        <code dir="ltr" className="break-all rounded bg-mist px-2 py-1 text-xs">{k}</code>
                        {(st.configKeys?.length ?? 0) > 1 && (
                          <button type="button" disabled={busy} onClick={() => save({ configKeys: st.configKeys!.filter((x) => x !== k) })} className="text-xs text-gold-600 hover:underline">{t.removeKey}</button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input value={extra} onChange={(e) => setExtra(e.target.value)} dir="ltr" placeholder="Config Key (64)" className="field flex-1 font-mono text-xs" />
                    <button type="button" disabled={busy || !extra.trim()} onClick={() => save({ configKeys: [...(st.configKeys ?? []), extra] })} className="btn btn-outline btn-sm">{t.addKey}</button>
                  </div>
                  <p className="mt-2 text-xs text-slate">{t.keyHint}</p>
                </div>
                {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
                <p className="text-xs leading-6 text-slate">{t.limits}</p>
              </div>
            )}
          </div>
        )
      }
    </ExamShell>
  );
}

/** in the exam builder: whether this exam asks for SEB (saved at once, also while published) */
export function SebExamToggle({ examId, initial, locale, labels }: { examId: string; initial: boolean; locale: string; labels: ExamLabels }) {
  const t = labels.seb;
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const change = async (v: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await rpc("exam_seb_set_exam", { p_exam: examId, p_required: v });
      setOn(v);
      setMsg(t.saved);
    } catch (e) {
      setMsg(/forbidden/.test((e as Error).message) ? t.noPermission : labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card space-y-2 p-6">
      <label className="flex items-center gap-3 font-semibold text-navy">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} className="h-5 w-5 accent-[var(--color-brand)]" />
        {t.examRequire}
      </label>
      <p className="text-sm text-slate">
        {t.examHint}{" "}
        <Link href={`/${locale}/exams/seb`} className="font-semibold text-brand hover:underline">{t.pageTitle}</Link>
      </p>
      {msg && <p className="text-sm text-slate" role="status">{msg}</p>}
    </div>
  );
}
