/**
 * Masking secret variable values in anything we **store**.
 *
 * ⚠️ **A mitigation, not encryption.** Secrets remain plaintext in
 * `environments.variables` and in `requests.auth`, and the live `SendResult`
 * returned to the caller is deliberately *not* redacted — the person who
 * pressed Send is entitled to see what they sent. What this exists for is
 * `request_executions`, which is a long-lived, capped-but-durable third copy;
 * a `?token=<secret>` surviving there is a leak with a much longer tail than
 * one response pane.
 *
 * ⚠️ It covers the history row's `url` **and every `RedirectHop.from`/`to`**.
 * The hops land in the `redirects` jsonb, so redacting the final URL alone
 * would leave `?token={{apiKey}}` sitting in plain sight one column over.
 */

export const REDACTION = '••••••';

/**
 * Replaces every occurrence of every secret value with `REDACTION`.
 *
 * Longest-first, so a secret that is a substring of another does not chop the
 * longer one into a partially-masked fragment. Empty values are skipped: they
 * match everywhere and would turn the whole string into masks.
 */
export function redactSecrets(
  input: string,
  secretValues: Iterable<string>,
): string {
  const values = [...secretValues]
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);

  let output = input;
  for (const value of values) {
    output = output.split(value).join(REDACTION);
  }
  return output;
}
