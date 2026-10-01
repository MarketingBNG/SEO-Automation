// Plain-English messages for Anthropic API failures, so the dashboard says what to do instead of
// showing raw JSON. Anything unrecognised keeps its original message.
function friendlyApiError(err) {
  const raw = String(err?.message || err || '');
  const status = err?.status;
  if (/credit balance is too low/i.test(raw)) {
    return 'The Anthropic API account is out of credit. Add credit at console.anthropic.com (Settings > Billing), then try again.';
  }
  if (status === 401 || /invalid x-api-key|authentication_error/i.test(raw)) {
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the .env file.';
  }
  if (status === 429 || /rate_limit_error/i.test(raw)) {
    return 'The Anthropic API rate limit was reached. Wait a minute and try again.';
  }
  if (status === 529 || /overloaded_error/i.test(raw)) {
    return 'The Anthropic API is overloaded right now. Try again in a few minutes.';
  }
  return raw;
}

// Rethrows an API error with the friendly message, keeping abort errors untouched so callers can
// still tell "stopped by the user" apart from a failure.
function rethrowFriendly(err, signal) {
  if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'APIUserAbortError') throw err;
  const message = friendlyApiError(err);
  if (message === err?.message) throw err;
  throw Object.assign(new Error(message), { status: err?.status, cause: err });
}

export { friendlyApiError, rethrowFriendly };
