# Changelog

What changed in the dashboard, newest first. Claude Code adds a line with every change pushed to
`main`. The Ops agent reads this file every day (lib/opsAgent.ts): each line becomes a "change"
memory for the agent named in brackets (ops when none), so every agent knows what changed.
Format: `- (agent) what changed and what it means for the work`. Agents: writer, fact-check, ops,
creative, learning, seo, publisher, social.

## 2026-10-26
- (ops) Agents Phase 1: every agent keeps a memory (mistakes, lessons, team rules, incidents, changes); the Ops agent runs a daily health check with no AI and remembers each incident until it is fixed.
- (writer) Before writing, the writer reads its memory: reviewers' rejections, the weekly lessons, the team's rules and the facts found wrong before. A past mistake must never be repeated.
- (fact-check) Claims found wrong (and fixed through two clean checks) are remembered; a similar claim later gets extra care.
- (creative) Learn from YouTube: Gemini watches videos and the notes become creative skills plus a Creative Director master skill.
- (creative) Brand Palette: three directions explored, critiqued and refined; contrast and shades worked out in code. The designer's brand kit is petrol navy #0A3550, steel blue #5B7A8F, soft teal #8FB8B6, crimson #C8283A for small accents only, Anton and Hanken Grotesk.
- (social) Shared brain: the Social Media dashboard uses this dashboard's YouTube learning, skills and palettes through the signed /api/partner.
- (publisher) Blogs publish to the new custom website (usaindiacfo.com, blogs under /insights/) through its signed connector, not WordPress. A taken address gets -2 instead of overwriting a live post; drafts stay off until the developer confirms they are hidden.

## 2026-10-25
- (ops) A scheduled blog that fails is stopped (paused) instead of being retried every 15 minutes; Home lists it with Resume, Publish now and Already done.
- (ops) Testing mode: AI work can run on the Claude Code subscription (no API credits); automatic work waits until Live mode.
- (ops) Check a blog: audits and rewrites have a Stop button.

## 2026-10-24
- (ops) Only people the admin adds on the Team page (and the owner) can sign in.
