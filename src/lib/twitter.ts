/**
 * Extract the numeric Tweet ID from any of these URL shapes:
 *   https://x.com/user/status/123
 *   https://twitter.com/user/status/123?s=20
 *   https://mobile.twitter.com/user/status/123
 *   http://x.com/user/status/123/photo/1
 *
 * Tweet IDs are globally unique 64-bit snowflakes, so dedup-by-ID is
 * resistant to URL variations (x.com vs twitter.com, trailing slashes,
 * tracking params, photo subpath, etc).
 */
export function extractTweetId(input: string): string | null {
  if (!input) return null;
  // Strip protocol + hostname tolerantly
  const m = input
    .trim()
    .match(/(?:^|\/)status(?:es)?\/(\d{8,32})(?:[/?#]|$)/i);
  return m ? m[1] : null;
}

/** Canonical tweet URL we store for duplicate-detection comparison. */
export function canonicalTweetUrl(input: string): string | null {
  const id = extractTweetId(input);
  if (!id) return null;
  // Username doesn't affect identity; use a normalized form.
  const userMatch = input.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status/i);
  const user = userMatch?.[1] ?? "i";
  return `https://x.com/${user}/status/${id}`;
}
