@AGENTS.md

# Working rules for this repo

- Code changes: show the diff, and push to `main` (which deploys) only after the user confirms.
- Ongoing work must not stop during development. A push to `main` restarts the server: before pushing,
  check that no blog, fact check or strategy run is mid-way (`running` in `/api/ai-credits`, and `paused`),
  and say so if one is. If one is running, ask the user to press Pause (AI credits page) first, wait
  about 2 minutes so the AI calls in flight finish and are saved, push, then ask them to press Resume:
  the run continues from the saved steps (lib/aiReplay.ts), so no credit is spent twice. Without the
  pause, a deploy cuts off the call in flight, which is paid again when the run restarts by itself.

## Editing a dashboard blog draft from Claude Code (no API credits)

When the user asks for changes to a blog in Drafts & Review ("blog 81", "the ITIN blog"), edit it
here with `scripts/draft.ts` instead of the dashboard's AI, so no Anthropic API credits are used.
It needs `DRAFT_EDIT_TOKEN` in this environment (same value as on the server; see lib/draftToken.ts).

1. `npx tsx scripts/draft.ts list <words>` to find the id, then `npx tsx scripts/draft.ts get <id>`.
2. Edit `.drafts/<id>/content.html` (and title / meta_description in `.drafts/<id>/draft.json`) with
   exact, minimal edits. Keep the HTML structure, images and `[VISUAL SUGGESTION: ...]` notes.
3. `npx tsx scripts/draft.ts diff <id>` and show the user the changes.
4. Only after the user confirms: `npx tsx scripts/draft.ts put <id>`.

Write in the house voice from `skills/seo-blog-playbook/SKILL.md` (no em dashes, no AI filler), and
never invent a figure, rate, deadline or section number: check it on an official source first.
The token cannot approve, reject or publish; those stay in the dashboard. A blog already on the
website (wp_post_url) is not changed by `put`.

## Testing mode: answering the dashboard's AI queue (no API credits)

When Testing mode is on (Settings > AI credits), work a person starts in the dashboard waits in a
queue instead of using the Anthropic API (lib/aiQueue.ts). When the user says "run the SEO AI queue":

1. `npx tsx scripts/agent.ts list`, then for each job `npx tsx scripts/agent.ts get <id>`.
2. Read `.agent/<id>/system.md` and `request.md`, do the work (web search on official sources when the
   job allows it), and write the reply to `.agent/<id>/answer.md` in exactly the format the request asks for.
3. `npx tsx scripts/agent.ts put <id>`. The run carries on and may queue its next step: list again
   until nothing is waiting.

Follow the same house voice and accuracy rules as above. Never invent a figure, rate or date.
