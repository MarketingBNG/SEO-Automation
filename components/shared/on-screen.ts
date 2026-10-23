// True when this dashboard page is the one being looked at (the browser tab is visible and the page
// is not one of the hidden, already-visited pages). Background refreshes skip while it is not, and
// pick up again within one refresh once the page is shown.
export function onScreen(tabId: string) {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState === 'hidden') return false;
  const el = document.getElementById(tabId);
  return !el || !el.classList.contains('hidden');
}
