/**
 * A workspace is the tenancy boundary: everything a user can see hangs off one.
 *
 * `organizationId` is a reserved seam. Organizations are not built yet — the
 * column exists, is nullable, and is always NULL, so attaching them later is
 * one `ALTER TABLE … ADD CONSTRAINT … NOT VALID` rather than a backfill and a
 * rewrite of every scoping clause.
 */

/**
 * Roles inside a workspace. Four, because there are two independent questions
 * — can they edit content, can they administer the workspace — plus one
 * singleton owner.
 *
 * Deliberately a const object, never a TS `enum`: the frontend compiles with
 * `erasableSyntaxOnly`. Stored as `varchar` + a CHECK constraint rather than a
 * Postgres enum type, because role sets churn and a CHECK is one statement to
 * change; this object stays the single source of truth either way.
 */
export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
} as const;

export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];

export const WORKSPACE_ROLES: readonly WorkspaceRole[] =
  Object.values(WorkspaceRole);

export const WORKSPACE_NAME_MAX_LENGTH = 120;

export interface Workspace {
  id: string;
  /** Always null today. See the note above — this is the organization seam. */
  organizationId: string | null;
  ownerUserId: string;
  name: string;
  isPersonal: boolean;
  /**
   * The *caller's* role in this workspace, not a property of the workspace
   * itself. Carried on the wire so the UI can disable what the caller cannot
   * do without a second request.
   */
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
}

export type UpdateWorkspaceInput = Partial<CreateWorkspaceInput>;
