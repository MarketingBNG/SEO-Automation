// One content-writing skill run at a time across both routes: the manual "Update skill" button
// (app/api/skill/generate) and the automatic 15-day refresh (app/api/skill/auto-check), whose batch
// can wait for hours. A second run while one is going would be paid for again. Kept on globalThis so
// both routes see the same flag even when they are bundled separately.
export type SkillRunKind = 'manual' | 'auto';

const state: { running: SkillRunKind | null } = ((globalThis as any).__skillRun ||= { running: null });

// Takes the run for `kind`. Returns null when taken, or the kind already running.
export function claimSkillRun(kind: SkillRunKind): SkillRunKind | null {
  if (state.running) return state.running;
  state.running = kind;
  return null;
}

export function releaseSkillRun(kind: SkillRunKind) {
  if (state.running === kind) state.running = null;
}
