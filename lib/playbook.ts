import fs from 'fs';
import path from 'path';

// The SEO/GEO/AEO blog skill lives in skills/seo-blog-playbook/SKILL.md (a normal Claude skill
// file, so it can also be used outside the dashboard). The dashboard injects two marked sections
// of it: the writer playbook into every write/rewrite, and the audit gates into every audit.
export const SKILL_PATH = path.join(process.cwd(), 'skills', 'seo-blog-playbook', 'SKILL.md');

let cache = { mtimeMs: 0, text: '' };

function readSkill() {
  try {
    const { mtimeMs } = fs.statSync(SKILL_PATH);
    if (mtimeMs !== cache.mtimeMs) cache = { mtimeMs, text: fs.readFileSync(SKILL_PATH, 'utf8') };
    return cache.text;
  } catch {
    return '';
  }
}

function section(name) {
  const text = readSkill();
  const start = text.indexOf(`<!-- ${name}:START -->`);
  const end = text.indexOf(`<!-- ${name}:END -->`);
  if (start === -1 || end === -1) return '';
  return text.slice(start + `<!-- ${name}:START -->`.length, end).trim();
}

export const getWriterPlaybook = () => section('WRITER_PLAYBOOK');
export const getAuditGates = () => section('AUDIT_GATES');
export const getSkillText = readSkill;
