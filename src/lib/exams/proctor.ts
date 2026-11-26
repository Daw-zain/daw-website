"use client";

/**
 * Browser-side proctoring helpers (phase 8). Events are sent to exam_attempt_event, which records them and
 * decides on the server whether they count as warnings and what happens when the limit is exceeded.
 *
 * Some legitimate actions make the window lose focus (e.g. the whiteboard's text prompt, a native file
 * dialog). Call suppressProctor(ms) right before them so they are not reported as "left the page".
 */
let suppressedUntil = 0;
export function suppressProctor(ms: number) {
  suppressedUntil = Math.max(suppressedUntil, Date.now() + ms);
}
export function resumeProctor() {
  suppressedUntil = 0;
}
export const proctorSuppressed = () => Date.now() < suppressedUntil;

export type ProctorKind = "HIDDEN" | "BLUR" | "FULLSCREEN_EXIT" | "COPY" | "PASTE" | "CONTEXT_MENU" | "PRINT" | "SHORTCUT";
export type ProctorResult = { warnings: number; maxWarnings: number; action: "none" | "warn" | "submitted" | "review" | "closed"; counted: boolean };
