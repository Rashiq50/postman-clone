/**
 * Rewrites Postman's `pm.*` script API to Raven's `rv.*` spelling.
 *
 * ⚠️ **This is a rename in a string that is never executed.** Scripts are
 * stored and displayed; nothing evaluates them (see `ScriptsTab`'s banner and
 * the README). So the job here is to make an imported script *read* like it
 * belongs to this app, not to correctly transform a program.
 *
 * That is the whole reason there is no JavaScript tokenizer here. A tokenizer
 * would be the right tool if the output ran, and it is the wrong trade for a
 * display-only field: it is a dependency or a few hundred lines, it must handle
 * template literals, regex literals and ASI to be worth having, and the failure
 * it prevents is a wrong colour of word inside a comment.
 *
 * ⚠️ **Accepted, documented collateral: `pm.` inside a string literal or a
 * comment is rewritten too.** `// use pm.test here` becomes `// use rv.test
 * here`, and `log("pm.environment")` becomes `log("rv.environment")`. That is
 * the known cost of the paragraph above and it is pinned by a test so nobody
 * "fixes" it by accident.
 */

/**
 * `pm` as a whole token, immediately followed by a property access.
 *
 * The two halves each do one job:
 *
 * - `(^|[^A-Za-z0-9_$.])` — the character before must not be able to continue
 *   an identifier, **and must not be a dot**. Without the dot, `x.pm.y` would
 *   rewrite a property that has nothing to do with the Postman global.
 * - `(?=\s*\.)` — what follows must be a property access, so a variable
 *   innocently named `pm` (`const pm = 1`) is left alone.
 *
 * The leading character is captured and re-emitted (`$1`) rather than matched
 * with a lookbehind: lookbehind is fine in modern Node, but the capture also
 * makes overlapping matches impossible, which is what keeps `pm.a + pm.b`
 * correct in one pass.
 */
const PM_TOKEN = /(^|[^A-Za-z0-9_$.])pm(?=\s*\.)/g;

/**
 * Postman's *legacy* API (`postman.setEnvironmentVariable(…)`) is deliberately
 * left untouched. It is a different global with a different surface, so
 * renaming it would invent an `rv.` method that will never exist — and the
 * regex above already declines to match it, since `postman` does not end at
 * the `pm`.
 */
export function rewritePmToRv(script: string): string {
  return script.replace(PM_TOKEN, '$1rv');
}
