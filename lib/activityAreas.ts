// Groups activity log actions into areas for the filter, and plain names for each action.
export const AREAS: Record<string, string> = {
  strategy: 'Strategy',
  schedule: 'Blog schedule',
  draft: 'Blogs and drafts',
  keywords: 'Keywords',
  fact: 'Fact checks',
  audit: 'Blog audit',
  backlink: 'Backlinks and outreach',
  technical: 'Technical crawl',
  technical_fix: 'Technical fixes',
  speed: 'Page speed',
  manual: 'Manual tasks',
  assistant: 'Assistant',
  client_insight: 'Meetings',
  training: 'Training',
  skill: 'Training',
  ai: 'AI credits',
  team: 'Team and roles',
  auth: 'Sign-ins',
  settings: 'Settings and connections',
  wordpress: 'Settings and connections',
  gbp: 'Settings and connections',
  zoho: 'Settings and connections',
  surfer: 'Settings and connections',
  serphouse: 'Settings and connections',
  research: 'Research',
  notify: 'Alerts',
  alert: 'Alerts',
  check: 'Alerts',
  lessons: 'Training',
  seranking: 'Settings and connections',
  wordpress_plugin: 'Website',
};
export const areaOf = (action: string) => AREAS[action.split('.')[0]] || 'Other';
// "draft.generation_failed" -> "Generation failed"
export const actionLabel = (action: string) => {
  const rest = action.split('.').slice(1).join(' ').replace(/_/g, ' ');
  return rest ? rest[0].toUpperCase() + rest.slice(1) : action;
};
