// @ts-nocheck -- PORT NOTE: ported 1:1 from untyped JS; type checking disabled for this file only (logic unchanged).
import * as settings from './settings';
import { chooseKeywords, coverage } from './keywordPlanner';

// Anti-slop phrases banned by the USAIndiaCFO content voice (uic-content-writer skill).
const BANNED_PHRASES = [
  'delve',
  'unlock',
  'seamless',
  'robust',
  'game-changer',
  'game changer',
  'navigate the landscape',
  'unprecedented',
  "in today's fast-paced world",
  "in today's digital age",
  'here’s what nobody tells you',
  "here's what nobody tells you",
  'let that sink in',
  'the future is bright',
  'feel free to reach out',
  'drive meaningful impact',
  'move the needle',
  'leverage synergies',
  'actionable insights',
  'ever-evolving',
  'ever evolving',
  'navigate the complexities',
  'navigating the complexities',
  'navigating the landscape',
];

// Primary / official sources the research says every legal or numeric claim should link to.
const OFFICIAL_HOSTS = [
  /\.gov$/,
  /\.gov\.in$/,
  /\.nic\.in$/,
  /(^|\.)rbi\.org\.in$/,
  /(^|\.)sebi\.gov\.in$/,
  /(^|\.)fincen\.treas\.gov$/,
  /(^|\.)oecd\.org$/,
];

const GENERIC_ANCHORS = /^(click here|read more|here|this link|learn more|this|link|more)$/i;
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'from', 'your', 'how', 'what', 'is', 'are', 'vs', 'best']);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', minus: '-',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…', middot: '·',
  bull: '•', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°', times: '×',
  sect: '§', para: '¶', euro: '€', pound: '£', cent: '¢', rarr: '→', larr: '←', shy: '',
};

// Decodes numeric (&#8217; &#x2019;) and common named (&rsquo; &amp;) HTML entities. WordPress
// stores rendered titles and content this way, so text checks and the UI need the real characters.
function decodeEntities(str) {
  return String(str || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    const named = NAMED_ENTITIES[code.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Plain text for the phrase, opener, dash and closer checks: tags removed, entities decoded and
// curly quotes straightened, so "In today&#8217;s" and "In today’s" are caught like "In today's".
function plainText(html) {
  return decodeEntities(stripHtml(html))
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(html) {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(' ').filter(Boolean).length;
}

function links(html) {
  return [...String(html || '').matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => {
    let host = '';
    try {
      host = new URL(m[1]).hostname.toLowerCase();
    } catch {
      host = '';
    }
    return { href: m[1], host, anchor: stripHtml(m[2]) };
  });
}

function distinctiveTerms(keyword) {
  return String(keyword || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

const QUESTION_WORDS = new Set(['can', 'does', 'do', 'why', 'when', 'where', 'which', 'who', 'much', 'many', 'long', 'should', 'need', 'there', 'get']);

// The FAQ heading, allowing inline markup before its text (<strong>, or the empty <span id> a
// table-of-contents plugin adds to every heading).
const FAQ_HEADING = /<h[23][^>]*>(?:\s|<[^>]+>)*(FAQ|Frequently Asked Questions)/i;

// The FAQ section's HTML after its heading, up to the next <h2>.
function faqSection(content) {
  const html = String(content || '');
  const start = html.search(FAQ_HEADING);
  if (start === -1) return null;
  const afterHeading = html.slice(start).replace(/^<h[23][^>]*>[\s\S]*?<\/h[23]>/i, '');
  return afterHeading.split(/<h2[\s>]/i)[0];
}

// The <h3> questions under the FAQ heading (up to the next <h2>).
function faqQuestions(content) {
  const section = faqSection(content);
  if (section === null) return [];
  return [...section.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => plainText(m[1]));
}

// Common spelled-out forms, mapped to the acronym, so a reworded question still matches.
const TERM_ALIASES = [
  [/\bincome[- ]tax returns?\b/g, 'itr'],
  [/\breports? of foreign bank and financial accounts?\b/g, 'fbar'],
  [/\bforeign bank (and financial )?accounts? reports?\b/g, 'fbar'],
  [/\bfincen form 114\b/g, 'fbar'],
  [/\bnon[- ]?resident indians?\b/g, 'nri'],
  [/\bdouble tax(ation)? avoidance agreements?\b/g, 'dtaa'],
  [/\blimited liability compan(y|ies)\b/g, 'llc'],
  [/\bindividual taxpayer identification numbers?\b/g, 'itin'],
  [/\bemployer identification numbers?\b/g, 'ein'],
  [/\btax deducted at source\b/g, 'tds'],
];

// Rough stem so plurals and -ing forms match ("penalties" = "penalty", "filing" = "file").
function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

// The meaningful words of a question or heading, stemmed, with spelled-out terms mapped to acronyms.
function questionTerms(text) {
  let lower = plainText(text).toLowerCase();
  for (const [re, alias] of TERM_ALIASES) lower = lower.replace(re, alias);
  return distinctiveTerms(lower).filter((t) => !QUESTION_WORDS.has(t)).map(stem);
}

// A Google "People also ask" question counts as used when most of its meaningful words appear, as
// whole words, in one of the given headings (the writer may reword it, fix grammar or add "the US").
function usesQuestion(headings, question) {
  const terms = [...new Set(questionTerms(question))];
  if (!terms.length) return false;
  return headings.some((h) => {
    const words = new Set(questionTerms(h));
    return terms.filter((t) => words.has(t)).length / terms.length >= 0.6;
  });
}

// Words too broad to tie a question to the topic: sharing only these does not make a PAA question
// relevant (e.g. "filing deadline" alone does not tie an ITR question to an FBAR post).
const GENERIC_TERMS = new Set(
  [
    'tax', 'taxes', 'taxation', 'india', 'indian', 'usa', 'united', 'states', 'america', 'american',
    'rule', 'rules', 'guide', 'filing', 'file', 'deadline', 'due', 'date', 'dates', 'last', 'rate',
    'rates', 'return', 'returns', 'income', 'business', 'company', 'account', 'online', 'process',
    'meaning', 'benefit', 'requirement', 'required', 'penalty', 'form', 'status', 'new', 'latest',
    'complete', 'explained', 'step', 'cost', 'fee', 'service', 'year', 'extension', 'pay', 'apply',
    'eligibility', 'eligible', 'limit', 'amount', 'check', 'list', 'example', 'people', 'person',
  ].map(stem)
);

// The PAA questions that share at least one distinctive term with the topic (the keyword, or the
// title for a rewrite), so off-topic questions the writer was told to skip are never required.
function relevantPaa(questions, topic) {
  const topicTerms = new Set(questionTerms(topic).filter((t) => !GENERIC_TERMS.has(t) && !/^(19|20)\d\d$/.test(t)));
  if (!topicTerms.size) return [];
  return questions.filter((q) => questionTerms(q).some((t) => topicTerms.has(t)));
}

// Marks which People Also Ask questions a draft's FAQ answers, for the reviewer screen.
function markUsedQuestions(content, paaQuestions) {
  const faq = faqQuestions(content);
  return (paaQuestions || []).map((q) => ({ ...q, used: usesQuestion(faq, q.question) }));
}

// Validates a generated draft against checks a program can verify reliably (thresholds from the
// verified SEO research). Returns { passed, issues, warnings, wordCount }. Issues block the draft
// and trigger the automatic repair loop, so only failures an AI writer can always fix are issues;
// everything else is a warning shown to the human reviewer.
async function validateDraft({ title, meta, content, facts, keyword, paaQuestions, keywordPlan }) {
  const issues: any[] = [];
  const warnings: any[] = [];
  const maxWords = parseInt(await settings.get('max_words'), 10) || 1600;

  if (!title || title.length < 5) {
    issues.push('Title is missing or too short.');
  } else if (title.length > 65) {
    issues.push(`Title is ${title.length} characters. Keep it to 50-60 (never over 65) so Google shows it in full.`);
  } else if (title.length < 40) {
    warnings.push(`Title is only ${title.length} characters; 50-60 usually works best.`);
  }

  if (meta !== undefined) {
    if (!meta || meta.length < 70) {
      issues.push('Meta description is missing or too short. Write 120-156 characters that restate the answer plus one concrete detail.');
    } else if (meta.length > 160) {
      issues.push(`Meta description is ${meta.length} characters. Keep it to 120-156.`);
    } else if (meta.length < 120) {
      warnings.push(`Meta description is ${meta.length} characters; 120-156 is the target.`);
    }
  }

  const wc = wordCount(content);
  if (wc === 0) {
    issues.push('Content is empty.');
  } else if (wc > maxWords) {
    warnings.push(`Content is ${wc} words, over the ${maxWords}-word house guideline. Fine if the topic truly needs it; otherwise cut padding.`);
  }

  // Lower-cased plain text (entities decoded, curly quotes straightened) for the phrase checks.
  const bodyText = plainText(content);
  const lowerText = bodyText.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lowerText.includes(phrase.toLowerCase())) {
      issues.push(`Contains a banned AI-filler phrase: "${phrase}". Rewrite that section.`);
    }
  }

  // Decoded, so &#8212; and &mdash; count too. "--" is checked on the text only (not the HTML,
  // where it appears in comments), since WordPress turns it into a dash on the page.
  const hasDash = (s) => /—/.test(decodeEntities(s)) || /--/.test(plainText(s));
  if (hasDash(content) || hasDash(title) || hasDash(meta)) {
    issues.push('Contains em dashes (or "--", which WordPress turns into a dash). Replace each one with a comma, colon, full stop or parentheses.');
  }

  if (/\[verify/i.test(content || '')) {
    issues.push('Content still contains an unresolved [VERIFY] marker. Leave an unverified claim out, or keep it and list it in ===FACTS=== with "NONE - could not verify" as the source.');
  }

  if (/<h1[\s>]/i.test(content || '')) {
    issues.push('The body contains an <h1>. WordPress uses the post title as the H1; start body headings at <h2>.');
  }

  if (!FAQ_HEADING.test(content || '')) {
    issues.push('Missing an FAQ section: add a "Frequently Asked Questions" H2 near the end with 2-4 real reader questions as H3s (at least 3 from Google "People also ask" in the brief when 3 fit), each answered directly in about 40-60 words.');
  } else {
    const faq = faqQuestions(content);
    if (faq.length < 2) {
      issues.push(`The FAQ has ${faq.length} question(s). Give it 2-4 questions, each as its own <h3>.`);
    }
    // Only PAA questions that fit the topic are expected (the brief says to skip off-topic ones),
    // and one answered as a body heading counts too (the playbook says to turn strong ones into H2s).
    const paa = (paaQuestions || []).map((q) => (typeof q === 'string' ? q : q.question)).filter(Boolean);
    const relevant = relevantPaa(paa, keyword || title);
    const bodyHeadings = [...String(content || '').matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => plainText(m[1]));
    const inFaq = relevant.filter((q) => usesQuestion(faq, q));
    const anywhere = relevant.filter((q) => usesQuestion(faq, q) || usesQuestion(bodyHeadings, q));
    if (relevant.length >= 2 && anywhere.length === 0) {
      issues.push(
        `The FAQ does not use any of Google's "People also ask" questions that fit this topic. Use them as FAQ <h3>s (you may reword a question, but keep its meaning and key terms): ${relevant.slice(0, 6).map((q) => `"${q}"`).join('; ')}.`
      );
    } else if (relevant.length >= 1 && inFaq.length < Math.min(2, relevant.length)) {
      warnings.push(`The FAQ uses ${inFaq.length} of the ${relevant.length} on-topic Google "People also ask" question(s); check whether another one fits.`);
    }
  }

  const h2Count = ((content || '').match(/<h2[\s>]/gi) || []).length;
  if (wc > 600 && h2Count < 3) {
    warnings.push(`Only ${h2Count} H2 section heading(s); a post this long reads better with one H2 per main subtopic.`);
  }

  // Answer-first: the opening paragraph should be the direct answer, not a long preamble.
  const firstPara = stripHtml(((content || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
  const firstParaWords = firstPara ? firstPara.split(' ').length : 0;
  if (firstParaWords > 60) {
    warnings.push(`The opening paragraph is ${firstParaWords} words. Lead with a 40-55 word direct answer, then add context.`);
  }

  const allLinks = links(content);
  const internal = allLinks.filter((l) => l.host === 'usaindiacfo.com' || l.host.endsWith('.usaindiacfo.com'));
  const official = allLinks.filter((l) => OFFICIAL_HOSTS.some((re) => re.test(l.host)));
  if (internal.length === 0) {
    issues.push('No internal links. Link to 3-8 genuinely related USAIndiaCFO posts or service pages with descriptive anchor text.');
  }
  if ((facts || []).length >= 3 && official.length < 2) {
    issues.push(
      `Only ${official.length} link(s) to official primary sources. Link the key rates, thresholds, deadlines and rules inline to their official source (irs.gov, fincen.gov, incometax.gov.in, rbi.org.in, mca.gov.in, cbic-gst.gov.in, the treaty text) using the URLs from your Facts Register.`
    );
  }
  const generic = allLinks.filter((l) => GENERIC_ANCHORS.test(l.anchor));
  if (generic.length) {
    issues.push(`Generic link text (${generic.map((l) => `"${l.anchor}"`).join(', ')}). Use anchor text that describes the destination.`);
  }
  const longAnchors = allLinks.filter((l) => l.anchor.split(' ').length > 12);
  if (longAnchors.length) warnings.push(`${longAnchors.length} link(s) have very long anchor text (over 12 words).`);

  if (keyword) {
    const terms = distinctiveTerms(keyword);
    const titleLower = String(title || '').toLowerCase();
    const inTitle = terms.filter((t) => titleLower.includes(t)).length;
    if (terms.length && inTitle < Math.ceil(terms.length / 2)) {
      issues.push(`The title does not clearly contain the target keyword "${keyword}". Put it (or a close variant) early in the title.`);
    }
    const opening = lowerText.split(' ').slice(0, 120).join(' ');
    if (terms.length && terms.filter((t) => opening.includes(t)).length < terms.length) {
      warnings.push(`The target keyword "${keyword}" does not appear naturally in the first ~100 words.`);
    }
    // Blocks only clear stuffing (over 4% of all words and 6+ uses); 2.5-4% is a reviewer note
    // below, since form names like "Form 5472" legitimately repeat in an article about them.
    const phrase = keyword.toLowerCase();
    const occurrences = lowerText.split(phrase).length - 1;
    if (wc > 0 && occurrences >= 6 && (occurrences * phrase.split(/\s+/).length) / wc > 0.04) {
      issues.push(`The exact phrase "${keyword}" appears ${occurrences} times, which reads as keyword stuffing. Use it in the key places and synonyms elsewhere.`);
    }
  }

  // The keyword plan decided before writing: did the article carry it out?
  if (keywordPlan) {
    const chosen = chooseKeywords(keywordPlan, keyword);
    const cov = coverage(chosen, { title, meta, content });
    const missing = cov.secondary.filter((k) => k.status === 'missing');
    const hint = (k) => `"${k.keyword}"${k.volume ? ` (${k.volume}/month)` : ''}`;
    const needed = chosen.secondary.length >= 3 ? 2 : 1;
    if (chosen.secondary.length >= 2 && cov.coveredSecondary < needed) {
      issues.push(`The keyword plan is not followed: only ${cov.coveredSecondary} of ${chosen.secondary.length} planned secondary keywords appear. Work these into H2/H3 headings and the text under them, in natural wording: ${missing.map(hint).join(', ')}.`);
    } else if (missing.length) {
      warnings.push(`Planned secondary keyword(s) not in the article: ${missing.map(hint).join(', ')}.`);
    }
  }

  if (!facts || facts.length === 0) {
    issues.push('No facts were found in ===FACTS===. List every hard claim there, one per line: F1 | claim | source name | source URL | jurisdiction | effective date.');
  } else {
    // A claim the writer could not verify is listed with no source, as it was told to. That is a
    // reviewer task, not something to repair: sending it back would push the writer to invent a
    // source. The facts are saved as "needs verify" and publishing waits until each is checked.
    const missingSource = facts.filter((f) => !f.source_url && !f.source_name);
    if (missingSource.length > 0) {
      const ids = missingSource.map((f) => f.fact_id).filter(Boolean).slice(0, 8).join(', ');
      warnings.push(`${missingSource.length} claim(s) in the Facts Register have no source${ids ? ` (${ids})` : ''}. Check each against a primary source, or remove the claim, before publishing.`);
    }
  }

  const extra = craftChecks({ title, meta, content, keyword, plainText: lowerText, wc, allLinks, internal, official });
  issues.push(...extra.issues);
  warnings.push(...extra.warnings);

  return { passed: issues.length === 0, issues, warnings, wordCount: wc };
}

const HYPE_TITLE = /(!{2,}|\b(shocking|secret|you won't believe|insane|guaranteed|ultimate hack|never before)\b)/i;
const ACRONYMS = new Set(['FBAR', 'FATCA', 'FEMA', 'GAAP', 'ITIN', 'DTAA', 'HNIS', 'USAINDIACFO', 'NRIS', 'LLCS', 'PFIC', 'GILTI', 'CBDT', 'SEBI', 'FDI', 'ODI', 'TDS', 'GST', 'ROC']);
const CANNED_OPENER = /^(In today's|In the (ever|fast)[- ]|When it comes to|Are you (looking|wondering)|Have you ever|Navigating|Welcome to|In an increasingly|Imagine)\b/i;
const EMPTY_CLOSER = /\b(In conclusion|To sum up|In summary,|Ultimately, the choice is yours|The possibilities are endless)/i;
const FACT_TOKEN = /(\d|\$|₹|\bINR\b|\bUSD\b|\bForm\b|\bSection\b|FBAR|FATCA|DTAA|\bIRS\b|CBDT|\bRBI\b)/;

function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

// Rough Flesch-Kincaid grade (vowel-group syllable estimate): good enough to flag dense prose.
function fkGrade(text) {
  const words = String(text).split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const sents = Math.max(1, sentences(text).length);
  if (words.length < 50) return null;
  const syllables = words.reduce((n, w) => n + Math.max(1, (w.toLowerCase().replace(/e\b/, '').match(/[aeiouy]+/g) || []).length), 0);
  return 0.39 * (words.length / sents) + 11.8 * (syllables / words.length) - 15.59;
}

// Checks from the verified SEO/GEO/AEO research (validationRules). Blocking only where the writer
// can always fix it and a program can check it reliably; everything else is a reviewer note.
function craftChecks({ title, meta, content, keyword, plainText, wc, allLinks, internal, official }) {
  const issues: any[] = [];
  const warnings: any[] = [];
  const html = String(content || '');
  const text = stripHtml(html);

  // Title
  const t = String(title || '');
  const capsWords = (t.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !ACRONYMS.has(w));
  if (HYPE_TITLE.test(t) || capsWords.length >= 2) issues.push('The title reads as hype or clickbait (exclamation marks, "secret", "guaranteed", shouting capitals). Make it plain and specific.');
  if (keyword && t) {
    const first = distinctiveTerms(keyword)[0];
    const at = first ? t.toLowerCase().indexOf(first) : 0;
    if (first && at > 40) warnings.push('The keyword starts late in the title; put it in the first 40 characters so it survives truncation.');
    const exact = t.toLowerCase().split(keyword.toLowerCase()).length - 1;
    if (exact > 1) warnings.push('The exact keyword appears more than once in the title.');
  }
  const titleYear = (t.match(/\b20\d{2}\b/) || [])[0];
  if (titleYear && (text.split(titleYear).length - 1) < 2) warnings.push(`The title says ${titleYear} but the body barely mentions it; make sure the content really is current for ${titleYear}.`);

  // Meta description
  if (meta && keyword && (String(meta).toLowerCase().split(keyword.toLowerCase()).length - 1) > 2) {
    warnings.push('The meta description repeats the keyword more than twice.');
  }

  // Opening
  const firstP = stripHtml((html.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
  if (CANNED_OPENER.test(firstP)) issues.push('The article opens with a canned hook ("In today\'s...", "Are you wondering...", "Imagine..."). Open with the direct answer.');
  if (firstP && !FACT_TOKEN.test(firstP)) warnings.push('The opening answer has no concrete fact (a number, form, section, deadline or agency). Make it specific.');
  const beforeH2 = stripHtml(html.split(/<h2[\s>]/i)[0]);
  const introWords = beforeH2 ? beforeH2.split(' ').length : 0;
  if (introWords > 150) warnings.push(`There are ${introWords} words before the first H2; keep the introduction under about 150.`);
  const first150 = text.split(' ').slice(0, 150).join(' ');
  if (!/\b(US|U\.S\.|United States|IRS|federal|India|Indian|CBDT|RBI)\b/.test(first150) || !/\b20\d{2}(-\d{2})?\b|tax year|financial year|\bFY\b/i.test(first150)) {
    warnings.push('The first 150 words should say which country the rules are for and which tax year or period.');
  }

  // Closing, disclaimer, legacy legends
  if (EMPTY_CLOSER.test(text)) warnings.push('Contains an empty closer ("In conclusion", "To sum up"). End with the next step instead.');
  const tail = text.slice(Math.floor(text.length * 0.6));
  if (wc > 300 && !/(general information|not (individuali[sz]ed )?(tax|legal|financial|investment) advice)/i.test(tail)) {
    issues.push('Add a short line near the end saying this is general information, not individualized tax or legal advice.');
  }
  if (/Circular 230|not intended or written to be used.{0,80}avoid(ing)? penalties/i.test(text)) {
    issues.push('Remove the Circular 230 legend: it has not been needed since 2014 and signals outdated practice.');
  }

  // FAQ answers
  const faqStart = html.search(/<h2[^>]*>\s*(FAQ|Frequently Asked Questions)/i);
  if (faqStart !== -1) {
    const faqHtml = html.slice(faqStart).split(/<h2[\s>]/i).slice(0, 2).join('<h2 ');
    const blocks = faqHtml.split(/<h3[^>]*>/i).slice(1);
    const long = blocks.filter((b) => {
      const answer = stripHtml(b.replace(/^[\s\S]*?<\/h3>/i, ''));
      const n = answer ? answer.split(' ').length : 0;
      return n > 90 || n < 25;
    }).length;
    if (long) warnings.push(`${long} FAQ answer(s) are outside 25-90 words; answer each question directly in about 40-60 words.`);
    if (faqStart < html.length * 0.5) warnings.push('The FAQ section sits in the first half of the article; it belongs near the end.');
  }

  // Links
  if (internal.length > 0 && internal.length < 3 && wc > 800) warnings.push(`Only ${internal.length} internal link(s); 3-8 relevant ones is the editorial default for a post this long.`);
  const counts: any = {};
  for (const l of allLinks) counts[l.href.replace(/[#?].*$/, '').replace(/\/+$/, '')] = (counts[l.href.replace(/[#?].*$/, '').replace(/\/+$/, '')] || 0) + 1;
  const repeated = Object.entries(counts).filter(([, n]) => n > 2);
  if (repeated.length) warnings.push(`${repeated.length} URL(s) are linked more than twice; once or twice is enough.`);
  const mentionsBoth = /\b(US|United States|IRS)\b/.test(text) && /\b(India|CBDT|RBI)\b/.test(text);
  if (mentionsBoth && official.length >= 1) {
    const usOfficial = official.some((l) => /\.gov$/.test(l.host));
    const inOfficial = official.some((l) => /\.(gov|nic)\.in$|rbi\.org\.in$/.test(l.host));
    if (!usOfficial || !inOfficial) warnings.push('The article covers both countries; cite at least one official US source and one official India source.');
  }

  // Keyword density
  if (keyword && wc > 0) {
    const phrase = keyword.toLowerCase();
    const occurrences = plainText.split(phrase).length - 1;
    const density = (occurrences * phrase.split(/\s+/).length) / wc;
    if (density > 0.025) warnings.push(`The exact keyword makes up ${(density * 100).toFixed(1)}% of the words; keep it under about 2.5% and use natural variations.`);
  }

  // Structure
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  if (tables.some((tb) => !/<th[\s>]/i.test(tb))) warnings.push('A table has no header cells (<th>).');
  const headings = [t, ...(html.match(/<h2[^>]*>[\s\S]*?<\/h2>/gi) || []).map(stripHtml)].join(' ');
  if (/\b(vs\.?|versus|compare|comparison|difference)\b/i.test(headings) && tables.length === 0) warnings.push('A comparison article should include a comparison table.');
  if (/\b(how to|steps|process|procedure|checklist)\b/i.test(headings) && !/<ol[\s>]/i.test(html)) warnings.push('A how-to article should include a numbered list of the steps.');
  const vague = (html.match(/<h2[^>]*>\s*(Overview|Introduction|Conclusion|Final thoughts|Details|Summary)\s*<\/h2>/gi) || []).length;
  if (vague) warnings.push(`${vague} H2(s) are generic ("Overview", "Conclusion"); make each heading say what the section answers.`);
  if (/<h3[\s>]/i.test(html.split(/<h2[\s>]/i)[0])) warnings.push('An H3 appears before the first H2; keep the heading order H2 then H3.');
  const sectionWords = html.split(/<h[23][^>]*>/i).map((sec) => stripHtml(sec.replace(/<table[\s\S]*?<\/table>/gi, '')).split(' ').filter(Boolean).length);
  if (sectionWords.some((n) => n > 450)) warnings.push('A section runs over 450 words; split it under a new subheading.');

  // Non-commodity value and trust
  if (wc > 700 && !/<h[23][^>]*>[^<]*(example|scenario|illustration|calculation|how it works)/i.test(html)) {
    warnings.push('No worked example section. A short worked example with real numbers is what the top results usually lack.');
  }
  if (/\[(AUTHOR NAME|REVIEWER NAME)/i.test(html)) warnings.push('The byline still has an [AUTHOR NAME] / [REVIEWER NAME] placeholder. Set the author and reviewer in Training > Writing guidelines, or fill it in by hand; publishing is blocked until then.');
  if (/\[VISUAL SUGGESTION/i.test(html)) warnings.push('Contains a [VISUAL SUGGESTION] note for the team: add the visual or delete the note before publishing.');
  if (/\[PRACTITIONER NOTE NEEDED\]/i.test(html)) warnings.push('Contains a [PRACTITIONER NOTE NEEDED] placeholder: add a real observation from the team before publishing.');
  else if (!/(in our (practice|experience|work with)|we (have |'ve )?(seen|filed|handled|advised|structured|helped)|our clients|practitioner note)/i.test(text)) {
    warnings.push('No first-hand practitioner signal. Add one real observation from client work (never invented).');
  }
  const firmBrag = sentences(text).filter((s) => /\b(best|No\.? ?1|number one|top[- ]rated|leading|guarantee(d)?|100% (accurate|compliant))\b/i.test(s) && /\b(USAIndiaCFO|our (firm|team|services)|we)\b/i.test(s));
  if (firmBrag.length) warnings.push('Contains unverifiable self-praise about the firm ("best", "leading", "guaranteed").');

  // YMYL fact traps (a human confirms: regex context can misfire)
  if (/(assessment year|\bAY ?20\d\d|Income[- ]?tax Act,? ?1961)/i.test(text) && !/(Income[- ]?tax Act,? ?2025|tax year)/i.test(text)) {
    warnings.push("Uses Assessment Year or 1961 Act wording without the Income-tax Act 2025 / Tax Year transition (in force from 1 April 2026). Fine only for periods before that.");
  }
  const near = (a, b, dist = 300) => {
    const re = new RegExp(a.source, 'gi');
    let m: any;
    while ((m = re.exec(text))) {
      if (!b.test(text.slice(Math.max(0, m.index - dist), m.index + dist))) return true;
    }
    return false;
  };
  if (near(/beneficial ownership|\bBOI\b/, /foreign|exempt|no longer/i)) warnings.push('Check the BOI (Corporate Transparency Act) statement: domestic US companies are now exempt; only foreign reporting companies file.');
  if (/remittance/i.test(text) && near(/\b1 ?%/, /cash|money order|cashier/i)) warnings.push('Check the 1% US remittance tax statement: it applies only to cash, money order or cashier\'s check funded transfers.');
  if (/\bGILTI\b/.test(text) && !/net CFC tested income|NCTI/.test(text)) warnings.push('GILTI was renamed net CFC tested income (NCTI) from 2026; check the wording.');
  if (/Form 5472/.test(text) && near(/e-?fil/i, /cannot|can't|not be e-?filed|fax|mail/i, 200)) warnings.push('Check the Form 5472 filing method statement for foreign-owned single-member LLCs.');
  const undatedPenalty = sentences(text).filter((s) => /penalt/i.test(s) && /\$\s?\d{1,3}(,\d{3})+/.test(s) && !/20\d{2}/.test(s));
  if (undatedPenalty.length) warnings.push('A dollar penalty amount has no year next to it; penalty caps change every year.');

  // Readability
  const grade = fkGrade(text);
  if (grade !== null && grade > 14) warnings.push(`Reading level is about grade ${Math.round(grade)}; aim for 10-12 (shorter sentences, plainer words).`);
  const sents = sentences(text);
  const longShare = sents.length ? sents.filter((s) => s.split(' ').length > 35).length / sents.length : 0;
  if (longShare > 0.1) warnings.push(`${Math.round(longShare * 100)}% of sentences are over 35 words; break them up.`);
  const longParas = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []).filter((p) => stripHtml(p).split(' ').length > 90).length;
  if (longParas) warnings.push(`${longParas} paragraph(s) are over 90 words.`);

  return { issues, warnings };
}

export { validateDraft, wordCount, stripHtml, faqQuestions, markUsedQuestions, BANNED_PHRASES };
