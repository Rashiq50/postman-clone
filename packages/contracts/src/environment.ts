/**
 * Environments and their variables — the source of `{{var}}` substitution when
 * a request is sent.
 *
 * Which environment is *active* is a property of the **member**, not of the
 * workspace: `workspace_members.activeEnvironmentId`, surfaced on the wire as
 * `Workspace.activeEnvironmentId`. It follows a person between machines,
 * deliberately unlike the theme preference, because an environment selects
 * *which server you are about to hit*.
 *
 * Resolution rules, which the send path holds to and which every future scope
 * (collection- or request-level variables) must also hold to:
 *
 * - **Enabled rows only**, and disabled rows are dropped *before* the merge.
 *   Dropping them after would let a disabled row in a higher-precedence scope
 *   shadow an enabled one below it — the bug that presents as "my variable
 *   stopped working when I unticked the other one".
 * - **Later source wins**, and within one source the **last** duplicate key
 *   wins, matching the visual order of the editor rows.
 * - **No rescanning.** A substituted value containing `{{x}}` is emitted
 *   literally and never re-expanded. That closes recursion, expansion bombs
 *   and variable-injection-through-a-variable in one stroke. The cost is that
 *   a literal `{{token}}` is unrepresentable; there is no escape syntax, on
 *   purpose.
 * - An **empty-string value is a value**, not an absence.
 * - An **unresolved** `{{name}}` is left in place literally and warns. It is
 *   never substituted with the empty string — `{{baseUrl}}/users` becoming
 *   `/users` is a request against a different host that may well succeed.
 */

export const ENVIRONMENT_NAME_MAX_LENGTH = 200;

/**
 * ⚠️ `secret` is a display hint only — the value is stored and returned in
 * plaintext exactly like every other one. See the note in `request.ts`.
 */
export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  variables: EnvironmentVariable[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnvironmentInput {
  workspaceId: string;
  name: string;
  variables?: EnvironmentVariable[];
}

export interface UpdateEnvironmentInput {
  name?: string;
  variables?: EnvironmentVariable[];
}
