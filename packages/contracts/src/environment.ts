/**
 * Environments and their variables.
 *
 * The table, contracts and CRUD exist now so the domain model is complete, but
 * **no environment UI ships in this slice**: without `{{var}}` interpolation
 * (which belongs to the execution slice) an environment editor is a form with
 * no observable effect.
 *
 * Also deferred: which environment is *active*. It has no consumer until
 * interpolation exists; it becomes a `workspace_members.activeEnvironmentId`
 * column when Send lands.
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
