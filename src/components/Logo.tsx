import Image from "next/image";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/** Al Daleel Raqamee "AR" mark (colour on light backgrounds, white on dark). */
export function LogoMark({ className, light = false }: { className?: string; light?: boolean }) {
  return <Image src={light ? BRAND.logoWhite : BRAND.logo} alt="" width={480} height={337} priority className={cn("h-10 w-auto shrink-0", className)} />;
}

export function Logo({ locale, light = false, className }: { locale: "ar" | "en"; light?: boolean; className?: string }) {
  const ar = locale === "ar";
  return (
    <span className={cn("group/brand inline-flex min-w-0 items-center gap-3", className)}>
      <LogoMark light={light} className="h-10 transition-transform duration-300 group-hover/brand:scale-105 max-[380px]:h-8" />
      <span className={cn("h-8 w-px shrink-0 max-[380px]:hidden", light ? "bg-white/20" : "bg-line")} aria-hidden="true" />
      <span className="flex min-w-0 flex-col leading-none">
        <span className={cn("whitespace-nowrap font-[family-name:var(--font-display)] text-[16px] font-bold max-[380px]:text-[14px]", light ? "text-white" : "text-navy")}>
          {ar ? BRAND.nameAr : BRAND.nameEn}
        </span>
        <span className={cn("mt-1 truncate text-[12px] font-semibold", light ? "text-gold" : "text-gold-600")}>{ar ? BRAND.unitAr : BRAND.unitEn}</span>
      </span>
    </span>
  );
}
