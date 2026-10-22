// Turns raw technical errors into short, plain messages people can act on. The raw error still goes to the log.

const has = (m: string, ...words: (string | RegExp)[]) => words.some((w) => (typeof w === 'string' ? m.includes(w) : w.test(m)));

export function friendly(e: any): string {
  const raw = String(e?.message ?? e?.error_description ?? e ?? '');
  const m = raw.toLowerCase();
  if (raw) console.log('[error]', raw);
  if (has(m, 'kclerrordomain', 'current location', 'location unavailable', 'getcurrentpositionasync', 'location services'))
    return "We can't find your location right now. Make sure Location is on for Channel Nav, or pick a place instead.";
  if (has(m, 'permission is off', 'not granted', 'denied') && has(m, 'location'))
    return 'Location is turned off for Channel Nav. You can turn it on in Settings › Channel Nav › Location.';
  if (has(m, 'network request failed', 'failed to fetch', 'aborted', 'timeout', 'timed out', 'offline', 'internet connection', /http 5\d\d/))
    return 'No connection right now. Try again when you have signal.';
  if (has(m, 'token has expired', 'otp', 'invalid code', 'token is invalid'))
    return "That code didn't work. Use the newest email, or ask for a new code.";
  if (has(m, 'jwt', 'not authenticated', 'auth session missing', 'refresh token'))
    return 'Please sign in again (Me › Sign in).';
  if (has(m, 'for security purposes', 'rate limit', 'too many'))
    return 'Too many tries. Wait a minute and try again.';
  if (has(m, 'row-level security', 'permission denied', 'not allowed', 'forbidden', 'http 403'))
    return "You don't have permission to do that.";
  if (has(m, 'duplicate')) return "That's already saved.";
  if (has(m, 'http 404')) return "We couldn't find that. It may have been removed.";
  // A short, plain sentence from our own code can be shown as is; anything technical gets a calm generic line.
  const technical = /[{}<>→]|error \d|code=|undefined|null|exception|function|\.tsx?|domain/i.test(raw);
  if (raw && raw.length <= 90 && !technical) return raw;
  return 'Something went wrong. Please try again.';
}
