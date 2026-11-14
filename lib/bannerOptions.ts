// The cut-out pictures the Social Media dashboard can put on a blog banner (its lib/blogBanner.tsx
// CUTOUTS), for the banner picker in Drafts & Review and Post my blog. Pure, so the browser can use it.
export const BANNER_CUTOUTS: { value: string; label: string }[] = [
  { value: 'us-landmarks', label: 'US landmarks (Statue of Liberty, US Capitol)' },
  { value: 'india-landmarks', label: 'India landmarks (India Gate, Indian flag)' },
  { value: 'tax-documents', label: 'Tax documents (forms, calculator, pen)' },
  { value: 'money', label: 'Money (dollar and rupee notes, coins)' },
  { value: 'travel', label: 'Travel (US and Indian passports, boarding pass)' },
  { value: 'legal', label: 'Legal (scales of justice, gavel)' },
  { value: 'business', label: 'Business (modern office tower)' },
];
export const isBannerCutout = (v: unknown) => BANNER_CUTOUTS.some((c) => c.value === v);

// A banner made for preview is kept under this prefix until a person picks it ("Use this banner").
export const CANDIDATE_PREFIX = 'covers/candidate-';
