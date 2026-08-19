import { NotFoundException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral } from 'typeorm';
import { ApiException } from '../common/errors/api.exception';
import {
  READ_ROLES,
  scopeParams,
  scopedWhere,
  type ScopedResource,
} from './workspace-scope';

/**
 * Turns a scoped statement that touched nothing into the right status code.
 *
 * **Failure path only.** The hot path stays a single statement; this second
 * query is paid exclusively when the answer is already an error, which is why
 * checking first — and paying it always — would be the worse trade.
 *
 * The policy, and the reasoning behind each half:
 *
 * - **Not a member → 404.** Verbatim `TasksService.findOne` policy: a 403 here
 *   would confirm the id is real, which is all an attacker needs to enumerate
 *   what exists across the whole system.
 * - **A member whose role is too low → 403.** This leaks nothing, because they
 *   can already read the row. A 404 here would tell a VIEWER that their own
 *   request does not exist.
 */
export async function explainDenial(
  manager: EntityManager,
  entity: { new (): ObjectLiteral } | string,
  scope: ScopedResource,
  userId: string,
  id: string,
): Promise<never> {
  const visible = await manager
    .createQueryBuilder()
    .from(entity, 't')
    .where(`t."id" = :id AND ${scopedWhere(scope, 't')}`, {
      id,
      ...scopeParams(userId, READ_ROLES),
    })
    .getExists();

  if (visible) {
    throw ApiException.forbidden('Your role does not permit this action');
  }
  throw new NotFoundException(
    `${scope.resourceName} with id "${id}" not found`,
  );
}

/**
 * The same policy, for a **create** — keyed on the parent instead of the row.
 *
 * `explainDenial` cannot be reused as-is: a `POST` has no row id, because the
 * row does not exist yet, so the answer must be anchored on the **parent the
 * caller named** — the only id in play. Visible under READ but not WRITE →
 * 403; not visible at all → 404 naming the parent.
 *
 * It is spelled out separately from the update path because the scoped-`UPDATE`
 * pattern that covers update, move and delete does *not* cover create: there is
 * no row to scope and `affected === 0` never arises. Copying the update
 * pattern's shape onto create is precisely how an unauthorized cross-tenant
 * write ships — a `POST` carries its parent id in the **body**, which is the
 * one place a route-param check cannot see.
 */
export function explainParentDenial(
  manager: EntityManager,
  parentEntity: { new (): ObjectLiteral } | string,
  parentScope: ScopedResource,
  userId: string,
  parentId: string,
): Promise<never> {
  return explainDenial(manager, parentEntity, parentScope, userId, parentId);
}
