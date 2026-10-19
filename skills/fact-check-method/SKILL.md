---
name: fact-check-method
description: The deep fact-check method (what the most thorough checker run did on draft #2). Use it for every blog fact check so a cheaper model or a lower effort level follows the same steps.
---

# Fact-check method (deep research workflow)

Follow every step in order. Do not skip a step to save time. A claim counts as checked only when
it has an official source link next to it.

## Step 1. List every claim (aim for completeness, not speed)
- Read the whole draft and pull out every checkable statement: figures, rates, thresholds, dates,
  deadlines, form numbers, section numbers, penalties, who must file, exceptions.
- Split a sentence that holds two facts into two claims.
- Also note claims that are implied (for example "no penalty applies" implies a rule).
- Expect 40 to 50 claims in a normal 2,000 word tax blog. Fewer than 25 means you missed some.

## Step 2. Rank the claims by risk
- High: money amounts, penalties, deadlines, thresholds, legal duties, anything a reader acts on.
- Medium: process steps, form names, which agency handles what.
- Low: general background.
- Check high first, but check all of them.

## Step 3. Find the primary source for each claim (never answer from memory)
Use this source order and go as deep as needed:
1. The law itself: US Code (uscode.house.gov), CFR (ecfr.gov), Indian Acts (indiacode.nic.in,
   incometaxindia.gov.in).
2. The official form instructions and IRM (irs.gov), FinCEN pages and notices (fincen.gov), RBI /
   CBDT circulars.
3. Official agency guidance pages (irs.gov, fincen.gov, incometax.gov.in, epfindia.gov.in).
- Big 4, law firm or blog sites are never the final source. Use them only to find the official one.
- At least one search per high and medium claim. If the first search fails, try again with the form
  number, the section number or the official page title.

## Step 4. Check that the source is current
- Confirm the year: thresholds and rates change every year (inflation adjusted amounts, budgets).
- Check that the page or procedure still exists (for example a removed IRS page or a retired
  procedure). A dead or removed page is itself a finding.
- Prefer the latest notice or revenue procedure over an older summary.

## Step 5. Check both sides (US and India)
- For a cross-border topic, check the India side rule too (for example EPF tax rules, FEMA, DTAA),
  not only the US side.

## Step 6. Check what is missing
- Ask: what exception, limit or condition would a careful expert add here? A true sentence that
  leaves out a key condition is a finding.

## Step 7. Mark "unverifiable" only as a last resort
- Only after 3 different searches found no official source. Say which searches you tried.
- If more than 10% of claims end up unverifiable, go back to Step 3: you have not searched enough.

## Step 8. Write each correction fully
For every problem give:
- the exact wrong sentence,
- the corrected sentence, ready to paste, in the house voice (no em dashes, no filler),
- why it is wrong, in one line,
- the official source link (statute, regulation, instructions or agency page).
A correction without a source link is not allowed.

## Step 9. Self check before you finish
- Every claim has a status (correct / wrong / missing context / unverifiable) and a source link.
- Re-read the corrected sentences against the sources once more.
- Report counts: claims found, claims wrong, claims unverifiable, searches made.

## How the deep checker thinks (taken from its 80-step run on draft #2)

These are the habits that found the hard problems. Copy them.

1. **Inventory first, search second.** Read the whole article and list every claim before the
   first search. Then plan which official document answers which group of claims.
2. **Start with what changes over time.** The first question is "is this figure still the figure
   this year?" (inflation adjusted penalties, thresholds, rates). It searched "2026 inflation
   adjustment FBAR penalty" before anything else, and found an OMB memo that cancelled the 2026
   adjustment.
3. **One question, three sources.** For a key figure it confirmed it in the news or search result,
   then in the law (eCFR), then in the official notice (Federal Register). It never trusted one page.
4. **Read the whole official document, not a snippet.** It opened the full FBAR instructions,
   Form 8938 instructions, Form 8621 instructions, the treaty and the IGA, and searched inside them.
   One document answers 5 to 10 claims, so this is fewer searches, not more.
5. **Read the law itself to find the tiers.** The article said "$500,000 and 10 years". The statute
   shows that is only the aggravated tier (31 USC 5322(b)); the base tier is $250,000 and 5 years.
   Whenever a penalty or limit is quoted, ask "is there a lower or higher tier or a condition?"
6. **A failed page is a clue, not a dead end.** The IRS Delinquent FBAR page returned 404. It did
   not stop: it searched whether the page moved or the program ended, opened the IRS options page
   (now listing three routes, not four), and found the procedure was removed in July 2026.
   Rule: 404, redirect, or a missing option means "check if the rule changed".
7. **Look for what the source says that the article left out.** Reading the Form 8938 instructions,
   it noticed the "living abroad" threshold also needs a foreign tax home and a presence test. The
   article did not say so: that is a finding.
8. **Test every absolute word.** "Never", "does not", "every", "nearly every", "automatic",
   "always" are where errors hide. "The DTAA does not reduce US tax on PFICs" was tested against
   IRC 1291(g), which allows a foreign tax credit, so the claim was overstated.
9. **When blocked, take another official route.** Indian government sites returned 403. It tried
   other official pages and the official site's text in search results, and still confirmed the EPF
   ₹2.5 lakh / ₹5 lakh rule. Blocked is not the same as unverifiable.
10. **Check the page date and prefer the newer, more specific source.** It read "updated
    September 19, 2026" on IRS pages and noticed an older IRS page still had pre-IGA wording
    ("FFIs report directly to the IRS"); the India IGA (Model 1, via CBDT) is the more specific rule.
11. **Check both countries.** Every cross-border claim got a US check and an India check.
12. **Check its own output.** It confirmed each quoted claim appears word for word in the article
    and that every check has a source before handing back.

### Signals that mean "this is a hard point, dig deeper"
- A figure that is adjusted every year, or a date in the current or last year.
- A penalty, fine or prison term (look for tiers).
- A named program or procedure (check it still exists).
- An absolute word (never, always, every, automatic, does not).
- A cross-border rule (check the other country).
- A page that fails to load, redirects, or lists fewer options than the article.

## Quality bar (from the draft #2 test, deepest run)
- About 48 claims found, at most 3 unverifiable, 0 answers without a source.
- About 30 citations to the law, regulations, instructions or IRM.
- Corrections are full sentences with the reason and the source (about 250 characters on average).
