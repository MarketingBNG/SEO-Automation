// K2/K3: the CA/CPA reviewers who sign off tax, legal and compliance blogs, from Settings.
import * as settings from './settings';

export const CREDENTIAL = /\b(CA|CPA|EA|CS|CMA|ACA|FCA|Advocate|Attorney|Esq\.?|LLB|JD)\b/;

export async function expertReviewers(): Promise<string[]> {
  const raw = `${(await settings.get('expert_reviewers')) || ''}\n${(await settings.get('byline_reviewer')) || ''}`;
  return [...new Set(raw.split(/\n|;/).map((s) => s.trim()).filter(Boolean))];
}

export async function requireExpert(): Promise<boolean> {
  return (await settings.get('require_expert_review')) !== '0';
}
