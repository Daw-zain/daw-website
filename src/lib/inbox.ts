import { CONSULTATION_STATUS, CONTACT_STATUS, CORPORATE_STATUS, REGISTRATION_STATUS } from "./constants";

export const INBOX = {
  registrations: { model: "registration", statuses: REGISTRATION_STATUS },
  consultations: { model: "consultationRequest", statuses: CONSULTATION_STATUS },
  corporate: { model: "corporateRequest", statuses: CORPORATE_STATUS },
  messages: { model: "contactMessage", statuses: CONTACT_STATUS },
} as const;

export type InboxKey = keyof typeof INBOX;
