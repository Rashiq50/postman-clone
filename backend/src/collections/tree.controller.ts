import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { API_VERSION, type WorkspaceTree } from '@postman-clone/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { TreeService } from './tree.service';

/**
 * Declared in `CollectionsModule` even though its path starts `workspaces/`.
 * Nest does not care which module declares a path, and keeping it here is what
 * leaves `WorkspacesModule` free of a `CollectionsModule` edge.
 *
 * Nested under the workspace because a workspace id is not derivable from
 * anything else — the same reason `/workspaces/:id/environments` is nested
 * while every create stays flat.
 */
@Controller({ path: 'workspaces', version: API_VERSION })
export class TreeController {
  constructor(private readonly treeService: TreeService) {}

  /**
   * ⚠️ Returns a **single resource**, with no `{ data, meta }` envelope — the
   * same shape as `GET /auth/me`. The pagination rule is about list endpoints,
   * so that a bare array can grow a cursor without breaking clients; half a
   * tree is not a tree, and no page boundary makes sense across a nesting
   * level. `GET /workspaces` is a real list and does return `Paginated`.
   */
  @Get(':workspaceId/tree')
  findTree(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<WorkspaceTree> {
    return this.treeService.findByWorkspace(user.userId, workspaceId);
  }
}
