// Every API the dashboard needs, in the order to connect them.
// `shared: true` means the key already lives in the SEO dashboard and is read from there.
// `group: 'firefly-fallback'` = the tools to use only if the Adobe Firefly Services quote is over budget.

export type Integration = {
  name: string;
  purpose: string;
  envKeys: string[];
  group: 'core' | 'ai' | 'design' | 'firefly' | 'firefly-fallback' | 'posting' | 'data' | 'storage';
  shared?: boolean;
  cost: string;
  signup: string;
  docs: string;
};

export const integrations: Integration[] = [
  // Core
  { name: 'PostgreSQL (Coolify)', group: 'core', purpose: 'All dashboard data', envKeys: ['DATABASE_URL'], cost: '$0', signup: 'https://coolify.io/docs/databases/postgresql', docs: 'https://coolify.io/docs/databases/postgresql' },
  { name: 'Google login', group: 'core', shared: true, purpose: 'Same company login as the SEO dashboard', envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'NEXTAUTH_SECRET', 'ALLOWED_EMAIL_DOMAIN'], cost: '$0', signup: 'https://console.cloud.google.com/apis/credentials', docs: 'https://next-auth.js.org/providers/google' },
  { name: 'Slack alerts', group: 'core', shared: true, purpose: 'Approval pop-ups and alerts', envKeys: ['SLACK_WEBHOOK_URL'], cost: '$0', signup: 'https://api.slack.com/apps', docs: 'https://api.slack.com/messaging/webhooks' },
  // AI
  { name: 'Anthropic Claude', group: 'ai', shared: true, purpose: 'Team lead AI: research, writing, fact check, replies, design review', envKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_SECONDARY'], cost: '+$40-100/mo usage', signup: 'https://console.anthropic.com', docs: 'https://docs.anthropic.com' },
  { name: 'xAI Grok', group: 'ai', purpose: '24/7 trends and news from X and the web', envKeys: ['XAI_API_KEY'], cost: '$30-80/mo usage', signup: 'https://console.x.ai', docs: 'https://docs.x.ai' },
  { name: 'OpenAI (text checks)', group: 'ai', shared: true, purpose: 'Second fact check of captions and replies', envKeys: ['OPENAI_API_KEY'], cost: '$10-20/mo usage', signup: 'https://platform.openai.com/api-keys', docs: 'https://platform.openai.com/docs' },
  // Design (main plan)
  { name: 'Adobe Firefly Services', group: 'firefly', purpose: 'Firefly, Photoshop, InDesign, Lightroom, Content Tagging, Audio/Video APIs', envKeys: ['ADOBE_CLIENT_ID', 'ADOBE_CLIENT_SECRET'], cost: 'Quote from Adobe (est. $1,000+/mo)', signup: 'https://developer.adobe.com/console', docs: 'https://developer.adobe.com/firefly-services/docs/' },
  // Fallback if Firefly is over budget
  { name: 'Placid', group: 'firefly-fallback', purpose: 'Replaces Photoshop + InDesign APIs: brand templates, carousels', envKeys: ['PLACID_API_TOKEN'], cost: '$19-39/mo', signup: 'https://placid.app', docs: 'https://placid.app/docs' },
  { name: 'OpenAI images', group: 'firefly-fallback', purpose: 'Replaces Firefly API: concept images, edit by prompt', envKeys: ['OPENAI_API_KEY (same key)'], cost: '+$10-30/mo usage', signup: 'https://platform.openai.com/api-keys', docs: 'https://platform.openai.com/docs/guides/image-generation' },
  { name: 'Unsplash', group: 'firefly-fallback', purpose: 'Replaces Firefly generation for stock photos', envKeys: ['UNSPLASH_ACCESS_KEY'], cost: 'Free', signup: 'https://unsplash.com/developers', docs: 'https://unsplash.com/documentation' },
  { name: 'Descript or CapCut', group: 'firefly-fallback', purpose: 'Replaces Audio/Video APIs: manual video touch-ups', envKeys: ['(no key, manual tool)'], cost: '$8-24/mo', signup: 'https://www.descript.com/pricing', docs: 'https://help.descript.com' },
  // Design (always)
  { name: 'Creatomate', group: 'design', purpose: 'Quick Reels, Shorts, subtitles, motion templates', envKeys: ['CREATOMATE_API_KEY'], cost: '$41-129/mo', signup: 'https://creatomate.com', docs: 'https://creatomate.com/docs/api/introduction' },
  { name: 'Plainly', group: 'design', purpose: 'After Effects quality videos by API', envKeys: ['PLAINLY_API_KEY'], cost: 'From ~$69/mo', signup: 'https://www.plainlyvideos.com', docs: 'https://help.plainlyvideos.com' },
  { name: 'Epidemic Sound', group: 'design', purpose: 'Licensed music and sound effects', envKeys: ['(account; music downloaded into brand kit)'], cost: '$49-75/mo or free YouTube Audio Library', signup: 'https://www.epidemicsound.com', docs: 'https://www.epidemicsound.com/pricing/' },
  // Native posting
  { name: 'Meta: Facebook Pages (Graph API)', group: 'posting', purpose: 'Facebook posts, reels, stories, comments, Messenger', envKeys: ['META_APP_ID', 'META_APP_SECRET', 'META_PAGE_TOKEN'], cost: 'Free (app review)', signup: 'https://developers.facebook.com/apps', docs: 'https://developers.facebook.com/docs/graph-api' },
  { name: 'Meta: Instagram API', group: 'posting', purpose: 'Feed, carousels, reels, stories, comments, DMs', envKeys: ['INSTAGRAM_ACCOUNT_ID (uses Meta app)'], cost: 'Free (app review)', signup: 'https://developers.facebook.com/apps', docs: 'https://developers.facebook.com/docs/instagram-platform' },
  { name: 'Meta: Threads API', group: 'posting', purpose: 'Threads posts and replies', envKeys: ['THREADS_APP_ID', 'THREADS_TOKEN'], cost: 'Free (app review)', signup: 'https://developers.facebook.com/apps', docs: 'https://developers.facebook.com/docs/threads' },
  { name: 'LinkedIn Posts API', group: 'posting', purpose: 'Company page posts', envKeys: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_ORG_ID'], cost: 'Free (approval)', signup: 'https://www.linkedin.com/developers/apps', docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/' },
  { name: 'YouTube Data API v3', group: 'posting', purpose: 'Videos, Shorts, comments', envKeys: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'], cost: 'Free (quota)', signup: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', docs: 'https://developers.google.com/youtube/v3' },
  { name: 'Pinterest API v5', group: 'posting', purpose: 'Pins and boards', envKeys: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'], cost: 'Free (approval)', signup: 'https://developers.pinterest.com/apps', docs: 'https://developers.pinterest.com/docs/api/v5/' },
  { name: 'X API v2', group: 'posting', purpose: 'Posts, threads, replies', envKeys: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'], cost: 'Pay-per-use ($5-20/mo)', signup: 'https://developer.x.com', docs: 'https://docs.x.com' },
  // Data (shared)
  { name: 'Fireflies.ai', group: 'data', shared: true, purpose: 'Client questions; fact source for replies', envKeys: ['FIREFLIES_API_KEY'], cost: '$0 extra', signup: 'https://app.fireflies.ai/integrations', docs: 'https://docs.fireflies.ai' },
  { name: 'Zoho CRM', group: 'data', shared: true, purpose: 'Leads from social (UTM)', envKeys: ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_API_BASE_URL', 'ZOHO_ACCOUNTS_URL'], cost: '$0 extra', signup: 'https://api-console.zoho.com', docs: 'https://www.zoho.com/crm/developer/docs/api/v8/' },
  { name: 'SerpHouse', group: 'data', shared: true, purpose: 'People also ask, Google Trends', envKeys: ['SERPHOUSE_API_KEY'], cost: '$0 extra', signup: 'https://www.serphouse.com', docs: 'https://docs.serphouse.com' },
  { name: 'Search Console + GA4', group: 'data', shared: true, purpose: 'Search topics, traffic from social', envKeys: ['GOOGLE_SERVICE_ACCOUNT_KEY_JSON', 'GSC_SITE_URL', 'GA4_PROPERTY_ID'], cost: 'Free', signup: 'https://search.google.com/search-console', docs: 'https://developers.google.com/analytics/devguides/reporting/data/v1' },
  { name: 'WordPress', group: 'data', shared: true, purpose: 'Blogs to repurpose', envKeys: ['WORDPRESS_SITE_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APPLICATION_PASSWORD'], cost: 'Free', signup: 'https://usaindiacfo.com/wp-admin/profile.php', docs: 'https://developer.wordpress.org/rest-api/' },
  // Storage
  { name: 'MinIO (Asset Library)', group: 'storage', purpose: 'Stores creatives, videos and raw uploads on Coolify', envKeys: ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'], cost: '$0-15/mo disk', signup: 'https://coolify.io/docs/services/minio', docs: 'https://min.io/docs/minio/linux/index.html' },
];

export const GROUP_LABELS: Record<Integration['group'], string> = {
  core: '1. Core (connect first)',
  ai: '2. AI',
  firefly: '3. Design: Adobe Firefly Services (main plan)',
  'firefly-fallback': '3b. Fallback if Firefly is over budget (replaces Firefly)',
  design: '4. Video and music',
  posting: '5. Native posting APIs',
  data: '6. Data (already in SEO dashboard)',
  storage: '7. Storage',
};

/** True when every key for the integration is stored in the encrypted secrets table. */
export function isConnected(i: Integration, stored: Set<string>): boolean {
  return i.envKeys.every((k) => /^[A-Z0-9_]+$/.test(k) && stored.has(k));
}
