// Blog generations running in this server process, by keyword id, so the Stop button can abort one
// even after the browser that started it has gone away. Kept on globalThis so every route sees it.
const g = globalThis as unknown as { __blogRuns?: Map<number, AbortController> };
export const blogRuns = (g.__blogRuns ||= new Map<number, AbortController>());
