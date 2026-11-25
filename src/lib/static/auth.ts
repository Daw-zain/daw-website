/**
 * Static-site stand-in for src/lib/auth.ts (aliased in the GitHub Pages build).
 * Pages are pre-rendered with no visitor; the learner's session lives in the browser (Supabase Auth).
 */
export type CurrentUser = { id: string; name: string; email: string; role: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return null;
}
