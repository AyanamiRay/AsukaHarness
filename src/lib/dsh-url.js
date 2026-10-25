/**
 * Parsing helpers for the `dsh web` startup banner.
 *
 * `dsh web` prints a single line such as
 *
 *     dsh web: http://127.0.0.1:3080/?token=8f2c…
 *
 * possibly wrapped in ANSI colour codes. The URL carries a one-shot launch
 * token, so the shell must capture it from stdout and load it immediately.
 */

const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(input) {
  return String(input).replace(ANSI_RE, '');
}

/**
 * Extract the first `dsh web:` URL from a chunk of output.
 * @param {string} text
 * @returns {string|null} absolute http(s) URL, or null
 */
export function parseDshUrl(text) {
  const clean = stripAnsi(text);
  const match = /dsh web:\s+(\S+)/.exec(clean);
  if (!match) return null;
  const raw = match[1];
  // A chunk boundary can cut the URL mid-port; `new URL('http://127.0.0.1:')`
  // would happily normalize to a wrong origin, so refuse half-written values.
  if (raw.endsWith(':') || raw.endsWith(':/')) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The web server prints the tokenised root URL; everything after the first
 * request is authenticated by a signed cookie. Re-running `dsh web` mints a new
 * token, which is why the shell never caches the URL across launches.
 */
export function isLoopbackUrl(href) {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1' || /^127\./.test(host);
  } catch {
    return false;
  }
}
