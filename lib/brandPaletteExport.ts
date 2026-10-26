// Kept apart from lib/brandPalette.ts (which reads the database) so the page can use it in the browser.

// CSS variables and JSON tokens for a direction (the scale of each colour included).
export function exportTokens(d: any) {
  const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const css = [':root {', ...d.colors.flatMap((c: any) => [`  --brand-${slug(c.role)}: ${c.hex}; /* ${c.name} */`, ...c.scale.map((s: any) => `  --brand-${slug(c.role)}-${s.step}: ${s.hex};`)]), `  --brand-font-heading: '${d.typography?.heading}', sans-serif;`, `  --brand-font-body: '${d.typography?.body}', sans-serif;`, '}'].join('\n');
  const json = { name: d.name, colors: Object.fromEntries(d.colors.map((c: any) => [c.role, { name: c.name, hex: c.hex, scale: Object.fromEntries(c.scale.map((s: any) => [s.step, s.hex])) }])), typography: d.typography };
  return { css, json };
}
