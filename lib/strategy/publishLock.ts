// Blogs being published right now in this server, so two paths (the scheduler, the cron route,
// Publish now on the calendar and Publish in Drafts & Review) never send the same blog at once.
// Kept on globalThis: the scheduler and each route load their own copy of this module.
const g = globalThis as unknown as { __schedulePublishing?: Set<number>; __draftPublishing?: Set<number> };
// Calendar rows (blog_schedule ids).
export const publishingRows = (g.__schedulePublishing ||= new Set<number>());
// Drafts (drafts ids), for a draft published from Drafts & Review.
export const publishingDrafts = (g.__draftPublishing ||= new Set<number>());

// Claims a calendar row (when the draft has one) and the draft. Returns a release function, or null
// when another path is publishing it right now.
export function claimPublish(rowId: number | null, draftId: number | null): (() => void) | null {
  if ((rowId != null && publishingRows.has(rowId)) || (draftId != null && publishingDrafts.has(draftId))) return null;
  if (rowId != null) publishingRows.add(rowId);
  if (draftId != null) publishingDrafts.add(draftId);
  return () => {
    if (rowId != null) publishingRows.delete(rowId);
    if (draftId != null) publishingDrafts.delete(draftId);
  };
}
