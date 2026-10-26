// The dashboard's agents: each has one job, the AI it runs on, and its own memory (lib/agentMemory.ts).
// Phase 1 (live): Writer, Fact-Check and Ops. The others are listed with what they will do, so the team
// can see the plan; they start in later phases.

export type AgentInfo = {
  key: string;
  name: string;
  job: string;
  ai: string;
  remembers: string;
  phase: 1 | 2 | 3;
};

const model = (env: string | undefined, fallback: string) => env || fallback;

export function agentList(): (AgentInfo & { active: boolean })[] {
  const list: AgentInfo[] = [
    {
      key: 'writer',
      name: 'Writer',
      job: 'Researches and writes every blog in the house voice, within the word limit, with sources.',
      ai: `Claude (${model(process.env.ANTHROPIC_MODEL, 'claude-opus-5-5')})`,
      remembers: "Reviewers' rejections, the weekly lessons, the facts it got wrong, and the team's rules.",
      phase: 1,
    },
    {
      key: 'fact-check',
      name: 'Fact-Check',
      job: 'Checks every figure, rate, date, form and section against official sources, and corrects the article.',
      ai: `Claude (${model(process.env.FACT_CHECK_MODEL, 'claude-haiku-5-5')}, then ${model(process.env.SECOND_CHECK_MODEL, 'claude-sonnet-5-5')})`,
      remembers: 'Every claim it found wrong before, with the correction and the source, so it looks harder at them.',
      phase: 1,
    },
    {
      key: 'ops',
      name: 'Ops',
      job: 'Watches the dashboard every day: the scheduler, failed or stuck work, AI credits, the website connector, Gemini and the Claude Code queue. Writes a health report and remembers each incident and its fix.',
      ai: 'No AI (exact checks in code)',
      remembers: 'Incidents (what broke, how often, when it was fixed) and development changes from CHANGELOG.md.',
      phase: 1,
    },
    { key: 'creative', name: 'Creative Director', job: 'Brand palettes, covers and creatives, following the skills learned from YouTube.', ai: 'Claude, with Gemini for watching videos', remembers: 'Palettes chosen and refined, designs rejected and why, brand rules.', phase: 2 },
    { key: 'learning', name: 'Learning', job: 'Watches YouTube videos and keeps the creative skills up to date.', ai: 'Gemini (watching), Claude (skills)', remembers: 'Which channels and videos taught the most; lessons already learned.', phase: 2 },
    { key: 'seo', name: 'SEO Strategist', job: 'Keywords, rankings and the monthly plan.', ai: 'Claude', remembers: 'What raised rankings and what did not.', phase: 2 },
    { key: 'publisher', name: 'Publisher', job: 'Publishes to the website through the connector and checks the live page.', ai: 'Claude', remembers: 'Publishing failures and their fixes, website rules.', phase: 2 },
    { key: 'social', name: 'Social liaison', job: "Talks with the Social Media dashboard's agents and shares reports.", ai: 'Claude, OpenAI or Grok where each is best', remembers: 'What the social side asked for and reported.', phase: 3 },
  ];
  return list.map((a) => ({ ...a, active: a.phase === 1 }));
}
