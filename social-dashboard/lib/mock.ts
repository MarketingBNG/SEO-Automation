// Sample data so every screen can be reviewed before any API is connected.
// Each list is replaced by real data once its integration is live.

export type Status = 'pending' | 'approved' | 'rejected' | 'scheduled' | 'published' | 'draft';

export const PLATFORMS = [
  'Instagram',
  'Facebook',
  'Threads',
  'LinkedIn Company',
  'LinkedIn Personal',
  'X',
  'Pinterest',
  'YouTube',
  'YouTube Shorts',
  'WhatsApp Status',
] as const;

export const PEOPLE = ['Company page', 'Amit Agarwal', 'Akshay Nahar', 'Harsh Jain', 'Naman Gangwal', 'Sales team', 'Learn with UIC'];

export const stats = [
  { label: 'Waiting for approval', value: '14', note: '3 urgent news items' },
  { label: 'Scheduled this week', value: '38', note: 'across 9 platforms' },
  { label: 'Leads from social (30 days)', value: '27', note: 'from Zoho CRM, UTM tagged' },
  { label: 'Reach (30 days)', value: '182k', note: '+21% vs last month' },
];

export const trends = [
  { topic: 'IRS extends Form 5472 relief for foreign-owned LLCs', source: 'Grok (X) + irs.gov', score: 94, age: '2h' },
  { topic: 'NRI selling property in India: TDS questions trending', source: 'Grok (X) + Reddit', score: 88, age: '5h' },
  { topic: 'Delaware franchise tax reminder posts gaining reach', source: 'SerpHouse + X', score: 81, age: '9h' },
  { topic: '"FBAR vs FATCA" carousel format performing well', source: 'Grok (Instagram trends)', score: 77, age: '1d' },
  { topic: 'Indian founders asking about US payroll for India team', source: 'Fireflies meetings (6 calls)', score: 73, age: '2d' },
];

export const strategy = {
  month: 'November 2026',
  status: 'pending' as Status,
  goals: ['40 qualified leads from social', '+15% followers on LinkedIn and Instagram', 'Launch "Learn with UIC" (1 video per week)'],
  themes: [
    { name: 'US tax deadlines for Indian founders', share: '30%' },
    { name: 'NRI tax and property', share: '25%' },
    { name: 'Cross-border CFO tips', share: '20%' },
    { name: 'Client stories and case studies', share: '15%' },
    { name: 'Team, events and culture', share: '10%' },
  ],
  mix: [
    { platform: 'LinkedIn Company', perWeek: 4 },
    { platform: 'Partners (each)', perWeek: 4 },
    { platform: 'Instagram', perWeek: 5 },
    { platform: 'YouTube Shorts', perWeek: 3 },
    { platform: 'X', perWeek: 7 },
    { platform: 'WhatsApp Status', perWeek: 5 },
  ],
};

export const calendar = [
  { id: 1, date: 'Mon 3 Nov', platform: 'LinkedIn Company', person: 'Company page', format: 'Carousel', topic: 'Form 5472: 5 mistakes that cost $25,000', status: 'pending' as Status },
  { id: 2, date: 'Mon 3 Nov', platform: 'LinkedIn Personal', person: 'Amit Agarwal', format: 'Text post', topic: 'What I tell every founder before they open a US LLC', status: 'approved' as Status },
  { id: 3, date: 'Tue 4 Nov', platform: 'Instagram', person: 'Learn with UIC', format: 'Reel', topic: 'FBAR vs FATCA in 45 seconds', status: 'pending' as Status },
  { id: 4, date: 'Tue 4 Nov', platform: 'WhatsApp Status', person: 'Sales team', format: 'Image', topic: 'Deadline alert: Delaware franchise tax', status: 'approved' as Status },
  { id: 5, date: 'Wed 5 Nov', platform: 'YouTube Shorts', person: 'Learn with UIC', format: 'Short', topic: 'Can an NRI open a US bank account?', status: 'rejected' as Status },
  { id: 6, date: 'Wed 5 Nov', platform: 'X', person: 'Company page', format: 'Thread', topic: 'TDS on NRI property sale, step by step', status: 'pending' as Status },
  { id: 7, date: 'Thu 6 Nov', platform: 'Pinterest', person: 'Company page', format: 'Pin', topic: 'US-India tax calendar 2027 infographic', status: 'scheduled' as Status },
  { id: 8, date: 'Fri 7 Nov', platform: 'LinkedIn Personal', person: 'Akshay Nahar', format: 'Text post', topic: 'Why your India team payroll needs a US view', status: 'pending' as Status },
];

export const content = [
  { id: 11, platform: 'Instagram', format: 'Carousel', title: 'Form 5472: 5 mistakes that cost $25,000', caption: 'Own a US LLC from India? These 5 Form 5472 mistakes are the most expensive ones we see...', factCheck: 'Passed (irs.gov, 2 sources)', status: 'pending' as Status },
  { id: 12, platform: 'LinkedIn Personal', format: 'Text post', title: 'Amit: before you open a US LLC', caption: 'Every week a founder asks me which state to pick. Here is the honest answer...', factCheck: 'Passed', status: 'pending' as Status },
  { id: 13, platform: 'YouTube Shorts', format: 'Short', title: 'FBAR vs FATCA in 45 seconds', caption: 'Script ready, 6 scenes, captions on, licensed music', factCheck: 'Needs review: threshold figure', status: 'pending' as Status },
];

export const news = [
  { id: 21, time: '06:40', headline: 'IRS announces new e-filing date for Form 5472 with pro forma 1120', source: 'irs.gov newsroom', format: 'Story + LinkedIn post', urgency: 'High', status: 'pending' as Status },
  { id: 22, time: '02:15', headline: 'CBDT notifies revised TDS rates for NRI property sales', source: 'incometaxindia.gov.in', format: 'Post + Carousel', urgency: 'High', status: 'pending' as Status },
  { id: 23, time: 'Yesterday', headline: 'RBI updates LRS reporting form', source: 'rbi.org.in', format: 'Story', urgency: 'Medium', status: 'approved' as Status },
];

export const replies = [
  { id: 31, platform: 'Instagram', from: '@rohit.founder', message: 'Do I need to file 5472 if my LLC had no income?', draft: 'Yes. A foreign-owned single-member LLC files Form 5472 with a pro forma 1120 even with no income, if it had reportable transactions such as capital contributions. Happy to check your case: DM us.', checks: 'Fact check: irs.gov ✓ · Fireflies: matches advice given in 4 calls ✓', route: 'Auto (safe topic)' },
  { id: 32, platform: 'Facebook', from: 'Priya S.', message: 'What are your fees for US company setup?', draft: 'Thanks for asking, Priya. Our team will message you with the details today.', checks: 'Pricing question', route: 'Sent to a person' },
  { id: 33, platform: 'LinkedIn Personal', from: 'Comment on Harsh Jain post', message: 'Great point. Does this apply to C-corps too?', draft: 'Good question. For a C-corp the reporting is different: Form 5472 is attached to the 1120 itself...', checks: 'Fact check ✓ · Draft only (personal profile)', route: 'Harsh to post by hand' },
];

export const assets = [
  { folder: 'raw-uploads', files: 46, size: '3.1 GB' },
  { folder: 'creatives/images', files: 212, size: '640 MB' },
  { folder: 'creatives/carousels', files: 88, size: '410 MB' },
  { folder: 'videos/reels-shorts', files: 34, size: '5.8 GB' },
  { folder: 'videos/youtube', files: 6, size: '7.2 GB' },
  { folder: 'videos/learn-with-uic', files: 12, size: '9.4 GB' },
  { folder: 'concepts', files: 150, size: '300 MB' },
  { folder: 'brand-kit', files: 24, size: '85 MB' },
  { folder: 'music-sfx', files: 40, size: '600 MB' },
  { folder: 'news-rapid', files: 19, size: '120 MB' },
  { folder: 'archive', files: 97, size: '1.2 GB' },
];

export const lessons = [
  { week: 'Week 42', lesson: 'Carousels with a dollar figure in slide 1 got 2.3x more saves. Use a figure in the hook when a verified one exists.' },
  { week: 'Week 42', lesson: 'Rejected 3 partner posts as "too salesy". Partner posts now end with a question, not a pitch.' },
  { week: 'Week 41', lesson: 'Reels under 30 seconds had 41% higher completion. Default reel length set to 25-30 seconds.' },
  { week: 'Week 41', lesson: 'Gold headline on navy background approved 9 of 10 times. Made it the default carousel style.' },
];

export const skills = [
  'Video editing', 'Sound design', 'Motion and effects', 'Typography', 'Colour and brand', 'Graphic design',
  'Copywriting and hooks', 'Script writing', 'Platform formats', 'Stock media', 'Fact check', 'Trends',
];
