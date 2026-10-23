# USAIndiaCFO Social Media Marketing Dashboard

Approval-led social media automation. Claude leads an AI team (Grok for trends, OpenAI for second checks,
Adobe Firefly Services or the fallback tools for design, Creatomate and Plainly for video); a person approves
the strategy, the calendar and every final post. Posting uses native platform APIs only.

Same stack as the SEO dashboard (Next.js 16, React 19, Tailwind 4, shadcn/ui) so the two can merge later.
It opens from the "Social Media Marketing" link in the SEO dashboard and reads the same keys.

## Screens
Overview · Research & Trends · Monthly Strategy (Gate 1) · Content Calendar (Gate 2) · Content Review (Gate 3)
· Upload Studio · 24/7 News · Replies · Asset Library · Learning & Skills · Integrations

All screens show sample data (`lib/mock.ts`) until each API is connected.

## Connecting APIs
The full list, in order, with key names, cost and links, is in `lib/integrations.ts` and on the
Integrations page. Key names are in `.env.example`; set them in Coolify.

## Run
    npm install
    npm run dev
