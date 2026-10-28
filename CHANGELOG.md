# Changelog

What changed in the dashboard, newest first. Claude Code adds a line with every change pushed to
`main`. Format: `- (part) what changed and what it means for the work`, where the part is the one it
affects most: writer, fact-check, ops, seo, publisher, social.

## 2026-10-28
- (ops) Security audit: Settings can no longer change role access, Testing/Live mode or credit switches (a tester could make itself admin that way); cron routes (daily, weekly, sweep, skill and strategy auto-checks) need the cron secret; meeting transcripts, client insights, account connections, paid live lookups and connection tests are limited to the right roles; private assistant files stay private; 'Check a blog' and site checks no longer fetch private network addresses; audit rewrite and lesson HTML are sanitised.
- (ops) Testing mode and Pause now hold everywhere: calendar blogs, fact checks, topics, training, outreach, covers, reports and the skill refresh wait instead of failing, and pick up from their saved steps when work can run again; tests always run in Live mode and never hang on the queue.
- (ops) No credit spent twice: calendar blog writing and fact checks reuse saved steps after a pause or restart; a failed rewrite of a rejected blog is paused once instead of being paid for again every 15 minutes; Surfer reuses its Content Editor; batch results are not re-sent or re-counted; the autopilot, cron and Publish now can no longer run the same blog at the same time.
- (publisher) Refresh blogs published from Drafts & Review update the page they refresh (address, author and cover kept) instead of creating a new post; 'Save as a separate draft' in Check a blog no longer takes the live post offline; one blog cannot be published twice by two paths at once; publishing without a website connection stops before saving anything and is logged.
- (publisher) Drafts & Review publish also runs IndexNow, sitemap resubmit, Bing, rank tracking and internal links like the calendar does; an analyst cannot publish a calendar blog before its slot; the paid originality check runs only after the free checks pass.
- (writer) The publish gate and the writer's checks now use the same rules (title length, internal links, question answers), so a draft that passes writing is not held at publishing for a rule it was never told.
- (fact-check) An edit by a person, the Assistant or the issue fixer no longer turns a failed fact check into a pass; 'Check and fix' cannot overwrite a save made while it ran.
- (seo) Approving a new strategy stops the old calendar from drafting and publishing, and its remaining blogs stay visible; a strategy cannot be approved twice; rank-drop alerts compare the same search engine; Screaming Frog counts only HTML pages; blog analytics no longer repeats posts or shows a false -100% position change.
- (ops) Data kept tidy: old paid-API cache rows, saved AI steps, progress rows and Surfer editor ids are cleaned up on a schedule; activity log areas, stop actions, sign-in refusals, deletes and publish failures are now logged with the right person.
- (ops) Deletes do what they say: deleting a draft no longer requeues strategy, LinkedIn or live blogs, frees its topic, and stops endless 'Blog held' alerts.
- (ops) Pages: Website Content 'New page' can no longer replace the home page; the Blog rules card loads saved values before saving; draft saves warn instead of overwriting newer edits; pages show an error instead of loading forever; each page fails on its own instead of blanking the dashboard; buttons are shown only to roles that can use them.
- (social) Outreach opening lines are the line itself (no preamble), and one refused lead no longer stops outreach for good.
- (ops) Associate Training: the 09:00 lesson is made later the same day when AI work was paused; a test cannot be scored twice.

## 2026-10-27
- (social) The AI photo for the older photo banner uses gpt-image-2.5-sunburst (gpt-image-1 was shut down on 23 Oct 2026); COVER_IMAGE_MODEL still overrides it.
- (social) Blog banners use the house banner design from the Social Media dashboard, with the author's name; the art direction picks the bold main title and the cut-out picture. The older photo banner is made here only when that link fails.
- (social) Every blog not yet on the website gets its banner by itself (two per scheduler run, retried after six hours), made in the Social Media dashboard; it finds a photo there when this dashboard has none.
- (ops) Associate Training test: each question keeps its own tick (a question with a missing or repeated id no longer takes another question's tick, which stopped the test from being finished), the chosen option is highlighted, and the page shows how many questions are answered.
- (social) Blog banners are made in the Social Media dashboard (website look plus a straight square grid); if that link is not set up or fails, the banner is made here as before, now with the same grid.
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
