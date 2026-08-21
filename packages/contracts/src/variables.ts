/**
 * The `{{var}}` syntax itself, plus the scope merge — shared, so that the
 * editor and the send path cannot disagree about what a variable *is*.
 *
 * This file exists for the same reason `password.ts` does. The rules in
 * `environment.ts`'s header are the specification; this is the one
 * implementation of them. The backend's `execution/interpolate.ts` does the
 * substituting and the warning, the frontend's `VariableInput` does the
 * highlighting and the autocomplete, and both take the regex and the merge from
 * here. A second regex on the client is how you get a chip that says a variable
 * is undefined for a name the server resolves perfectly well.
 */

import type { EnvironmentVariable } from './environment';

/**
 * ⚠️ `[^{}]*` — a run containing **no brace at all**, so nesting is not a
 * thing and `{{a{{b}}c}}` matches only the inner `{{b}}`. `{{}}` matches with
 * an empty name, and `{{ baseUrl }}` matches with a name that needs trimming.
 *
 * ⚠️ It carries the `g` flag, which means it carries `lastIndex` — a `RegExp`
 * object is mutable state. Never share this instance across a `.test()` and a
 * `.exec()` loop, and never export it as-is to be reused by a caller: use
 * `placeholderPattern()` for anything that iterates.
 */
const PLACEHOLDER_SOURCE = '\{\{([^{}]*)\}\}';

/** A fresh global `RegExp` — see the `lastIndex` warning above. */
export function placeholderPattern(): RegExp {
  return new RegExp(PLACEHOLDER_SOURCE, 'g');
}

/**
 * The lookup key for a placeholder's raw inner text.
 *
 * ⚠️ Trimming here and nowhere else is what makes `{{ baseUrl }}` and
 * `{{baseUrl}}` the same variable on both sides. A highlighter that skipped it
 * would paint a "not defined" chip on a name the send path resolves.
 */
export function variableName(rawName: string): string {
  return rawName.trim();
}

/**
 * One source of variables. The signature takes an **ordered list** even though
 * only one scope exists today, so that collection- and request-level variables
 * later cost a merge rather than a rewrite.
 */
export interface VariableScope {
  name: 'environment' | 'collection' | 'global';
  variables: EnvironmentVariable[];
}

export interface ResolvedVariable {
  value: string;
  secret: boolean;
}

/**
 * Flattens scopes into one lookup table.
 *
 * ⚠️ **Disabled rows are dropped before merging, not after.** A disabled row in
 * a higher-precedence scope must not shadow an enabled row below it — that is
 * the bug that presents as "my variable stopped working when I unticked the
 * other one".
 *
 * Later scopes win. Within one scope the **last** duplicate key wins, matching
 * the visual order of the editor rows. An empty-string value is a legitimate
 * value, not an absence.
 */
export function buildVariables(
  scopes: VariableScope[],
): Map<string, ResolvedVariable> {
  const merged = new Map<string, ResolvedVariable>();
  for (const scope of scopes) {
    for (const variable of scope.variables) {
      if (!variable.enabled) continue;
      merged.set(variable.key, {
        value: variable.value,
        secret: variable.secret === true,
      });
    }
  }
  return merged;
}

/**
 * A span of the input. `text` is verbatim, so `tokens.map(t => t.text).join('')`
 * reconstructs the input exactly — the property the editor's repaint depends on
 * for the caret to land where the user left it.
 */
export type VariableToken =
  | { kind: 'text'; text: string; start: number; end: number }
  | {
      kind: 'var';
      /** The whole placeholder including both pairs of braces. */
      text: string;
      /** The trimmed lookup key. */
      name: string;
      start: number;
      end: number;
    };

/**
 * Splits a string into literal runs and placeholders.
 *
 * The same pass the substituter makes, minus the substituting. Adjacent text is
 * never split, empty text tokens are never emitted, and offsets are absolute
 * into `input`.
 */
export function tokenize(input: string): VariableToken[] {
  const tokens: VariableToken[] = [];
  if (!input) return tokens;

  const pattern = placeholderPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    if (match.index > cursor) {
      tokens.push({
        kind: 'text',
        text: input.slice(cursor, match.index),
        start: cursor,
        end: match.index,
      });
    }
    tokens.push({
      kind: 'var',
      text: match[0],
      name: variableName(match[1] ?? ""),
      start: match.index,
      end: match.index + match[0].length,
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < input.length) {
    tokens.push({
      kind: 'text',
      text: input.slice(cursor),
      start: cursor,
      end: input.length,
    });
  }

  return tokens;
}

/**
 * The placeholder the caret is sitting inside, if any — an **open** one,
 * `{{` with no closing braces yet between it and the caret.
 *
 * This is what drives the autocomplete: `https://{{ba|` answers
 * `{ start: 8, query: 'ba' }`, and `https://{{base}}|` answers `null` because
 * the token is finished. The `[^{}]*` class matches the tokeniser's, so a stray
 * brace closes the suggestion list exactly where it would break the match.
 */
export function openPlaceholderAt(
  input: string,
  caret: number,
): { start: number; query: string } | null {
  const before = input.slice(0, caret);
  const match = /\{\{([^{}]*)$/.exec(before);
  if (!match) return null;
  return { start: match.index, query: match[1] ?? "" };
}
