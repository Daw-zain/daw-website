import "server-only";
import { cache } from "react";
import { db } from "./db";

/** All editable site settings with their defaults. Empty string = not provided yet. */
export const SETTING_KEYS = {
  contactEmail: "",
  phone: "",
  whatsapp: "",
  linkedin: "",
  facebook: "",
  youtube: "",
  addressAr: "",
  addressEn: "",
  mapUrl: "",
  heroImage: "",
  aboutImage: "",
  cvUrl: "",
  atpBadge: "",
  partnerLogo: "",
  adminNotifyEmail: "",
  heroTitleAr: "",
  heroTitleEn: "",
  heroTextAr: "",
  heroTextEn: "",
  privacyAr: "",
  privacyEn: "",
  whatsappMessageAr: "السلام عليكم، أرغب في الاستفسار عن",
  whatsappMessageEn: "Hello, I would like to ask about",
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;
export type Settings = Record<SettingKey, string>;

export const getSettings = cache(async (): Promise<Settings> => {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_KEYS } as Settings;
  for (const r of rows) {
    if (r.key in out) out[r.key as SettingKey] = r.value;
  }
  return out;
});
