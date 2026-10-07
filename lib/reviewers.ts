// The CA/CPA review step was removed at the team's request: blogs follow the normal 48-hour review
// (approve or reject; auto-publish when nobody rejects). Kept as functions so callers stay simple.
export const CREDENTIAL = /\b(CA|CPA|EA|CS|CMA)\b/;
export async function expertReviewers(): Promise<string[]> {
  return [];
}
export async function requireExpert(): Promise<boolean> {
  return false;
}
