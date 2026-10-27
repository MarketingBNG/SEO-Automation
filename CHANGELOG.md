# Changelog

What changed in the dashboard, newest first. Claude Code adds a line with every change pushed to
`main`. Format: `- (part) what changed and what it means for the work`, where the part is the one it
affects most: writer, fact-check, ops, seo, publisher, social.

## 2026-10-27
- (social) Blog banners are made in the Social Media dashboard (website look plus a straight square grid) and listed on its SEO banners page; if that link is not set up or fails, the banner is made here as before, now with the same grid.
- (social) Blog banners follow the design skills learned in the Social Media dashboard (read through a signed, read-only link, SOCIAL_SKILLS_SECRET): a small AI step on a light model picks better photo searches, a better AI photo prompt and the gold words of the title. Without the link, in Testing mode, or on any error, banners are made exactly as before. Other skill sets (poster, thumbnail, motion, script) can be asked for by name when a feature needs them.

## 2026-10-26
- (social) Learn from YouTube, Brand Palette, the Agents & memory page, the Ops health check and the shared-brain link (/api/partner) moved to the Social Media dashboard, where they now run on their own. Their tables stay in this database, untouched. The writer and fact-check memory stays here (no page): reviewers' rejections, fact-check corrections and the weekly lessons still go into every blog.
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
