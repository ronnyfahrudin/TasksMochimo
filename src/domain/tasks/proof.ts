import { ValidationError } from "@/domain/shared/errors";

/**
 * A tweet's identity.
 *
 * Tweet IDs are globally unique 64-bit snowflakes, so identity survives every
 * URL variation users paste — x.com vs twitter.com, mobile hosts, tracking
 * params, a /photo/1 suffix. Dedup compares IDs, never raw strings, which is
 * what stops the same tweet being claimed twice in two spellings.
 */
export class TweetId {
  private constructor(readonly value: string) {}

  static fromUrl(input: string): TweetId | null {
    if (!input) return null;
    const m = input.trim().match(/(?:^|\/)status(?:es)?\/(\d{8,32})(?:[/?#]|$)/i);
    return m ? new TweetId(m[1]) : null;
  }

  /** The single spelling we store, so two submissions of one tweet collide. */
  canonicalUrl(handle: string): string {
    return `https://x.com/${handle}/status/${this.value}`;
  }

  toString(): string {
    return this.value;
  }
}

/** Extract the handle a tweet URL claims; identity doesn't depend on it. */
function handleFrom(input: string): string {
  return input.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status/i)?.[1] ?? "i";
}

/**
 * What a user submits as evidence they did a task: a link, some text, or
 * (for check-ins) nothing at all. Normalization happens on construction, so
 * everything downstream compares like with like.
 */
export class Proof {
  private constructor(
    readonly url: string | null,
    readonly text: string | null,
    readonly tweetId: TweetId | null,
  ) {}

  static create(input: { url?: string | null; text?: string | null }): Proof {
    const rawUrl = input.url?.trim() || null;
    const text = input.text?.trim() || null;

    if (rawUrl && rawUrl.length > 2048) {
      throw new ValidationError("proof.url.too_long", "Proof URL is too long");
    }
    if (text && text.length > 4000) {
      throw new ValidationError("proof.text.too_long", "Proof text is too long");
    }

    const tweetId = rawUrl ? TweetId.fromUrl(rawUrl) : null;
    const url = tweetId ? tweetId.canonicalUrl(handleFrom(rawUrl!)) : rawUrl;
    return new Proof(url, text, tweetId);
  }

  static rehydrate(url: string | null, text: string | null): Proof {
    return new Proof(url, text, url ? TweetId.fromUrl(url) : null);
  }

  get isEmpty(): boolean {
    return !this.url && !this.text;
  }
}
