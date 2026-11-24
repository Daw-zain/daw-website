export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

export const ROLES = ["ADMIN", "EDITOR", "LEARNER"] as const;
export type Role = (typeof ROLES)[number];

export const PROGRAM_STATUS = ["OPEN", "COMING_SOON", "ON_REQUEST", "CLOSED"] as const;
export const PROGRAM_CATEGORIES = ["certification", "management", "agile", "technology", "tools"] as const;
export const SESSION_MODES = ["IN_PERSON", "ONLINE", "HYBRID"] as const;
export const SESSION_STATUS = ["OPEN", "FULL", "CLOSED"] as const;
export const RESOURCE_TYPES = ["ARTICLE", "TIP", "VIDEO", "TEMPLATE", "QUIZ"] as const;
export const RESOURCE_CATEGORIES = ["pmp", "pmbok", "risk", "agile", "ai", "general"] as const;
export const CONTACT_METHODS = ["EMAIL", "PHONE", "WHATSAPP", "ONLINE_MEETING"] as const;
export const SECTORS = ["government", "banking", "oil_gas", "it", "private", "education", "other"] as const;
export const FAQ_SCOPES = ["general", "programs", "corporate", "consulting"] as const;

export const REGISTRATION_STATUS = ["NEW", "CONTACTED", "CONFIRMED", "WAITLIST", "CANCELLED"] as const;
export const CONSULTATION_STATUS = ["NEW", "CONTACTED", "SCHEDULED", "DONE", "CLOSED"] as const;
export const CORPORATE_STATUS = ["NEW", "CONTACTED", "PROPOSAL_SENT", "WON", "LOST"] as const;
export const CONTACT_STATUS = ["NEW", "REPLIED", "CLOSED"] as const;

export const PMI_REGISTRY_URL = "https://www.pmi.org/certifications/certification-resources/registry";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/svg+xml"];
