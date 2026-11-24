import Image from "next/image";
import { cn } from "@/lib/utils";

/** Brand mark: three ascending milestones (plan → execute → deliver) inside a rounded square. */
export function LogoMark({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="48" height="48" rx="12" fill={light ? "#FFFFFF" : "#102A43"} />
      <rect x="11" y="27" width="7" height="10" rx="2" fill={light ? "#1769AA" : "#3B8BD0"} />
      <rect x="20.5" y="20" width="7" height="17" rx="2" fill={light ? "#102A43" : "#D9EAF7"} />
      <rect x="30" y="12" width="7" height="25" rx="2" fill="#C5A15A" />
      <path d="M12.5 22.5 L23 15.5 L33.5 8.5" stroke="#C5A15A" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".9" />
    </svg>
  );
}

/** Round portrait used as the site logo (file: public/images/logo-portrait.jpg — replace it to change the logo). */
export function LogoPortrait({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("logo-portrait group/logo relative block shrink-0 rounded-full p-[2.5px]", className)}>
      {/* rotating gradient ring */}
      <span className="logo-ring absolute inset-0 rounded-full" aria-hidden="true" />
      {/* soft pulsing halo */}
      <span className="logo-halo absolute -inset-1 rounded-full" aria-hidden="true" />
      <span className={cn("relative block h-full w-full overflow-hidden rounded-full border-2", light ? "border-navy-900" : "border-white")}>
        <Image src="/images/logo-portrait.jpg" alt="" width={96} height={96} priority className="h-full w-full object-cover transition-transform duration-500 group-hover/logo:scale-110" />
      </span>
    </span>
  );
}

export function Logo({ locale, light = false, className }: { locale: "ar" | "en"; light?: boolean; className?: string }) {
  return (
    <span className={cn("group/brand inline-flex min-w-0 items-center gap-2.5 sm:gap-3", className)}>
      <LogoPortrait className="h-11 w-11 max-[380px]:h-9 max-[380px]:w-9 transition-transform duration-300 group-hover/brand:-rotate-6 group-hover/brand:scale-105" light={light} />
      <span className="flex min-w-0 flex-col leading-none">
        <span
          className={cn(
            "whitespace-nowrap text-[17px] font-bold tracking-tight max-[380px]:text-[15px]",
            light ? "text-white" : "text-navy",
          )}
          dir="ltr"
        >
          Daw <span className={light ? "text-gold" : "text-brand"}>Zainelabideen</span>
        </span>
        <span className={cn("mt-1 truncate text-[11px] font-medium max-[440px]:hidden sm:max-lg:hidden", light ? "text-white/65" : "text-slate")}>
          {locale === "ar" ? "ضو زين العابدين · إدارة المشروعات" : "Project Management Training & Consulting"}
        </span>
      </span>
    </span>
  );
}
