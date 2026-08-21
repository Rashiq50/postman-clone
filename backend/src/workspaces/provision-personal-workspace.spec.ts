import { WorkspaceRole } from '@raven/contracts';
import type { EntityManager } from 'typeorm';
import { WorkspaceMemberEntity } from './entities/workspace-member.entity';
import { WorkspaceEntity } from './entities/workspace.entity';
import {
  PERSONAL_WORKSPACE_NAME,
  provisionPersonalWorkspace,
} from './provision-personal-workspace';

/**
 * A manager that records what it was asked to build and save. The assertions
 * that matter are about *which* manager did the writing — see the last test.
 */
function fakeManager() {
  const created: { entity: unknown; payload: Record<string, unknown> }[] = [];
  const saved: Record<string, unknown>[] = [];

  const manager = {
    create: jest.fn((entity: unknown, payload: Record<string, unknown>) => {
      created.push({ entity, payload });
      return payload;
    }),
    save: jest.fn((payload: Record<string, unknown>) => {
      saved.push(payload);
      return Promise.resolve({ id: 'workspace-1', ...payload });
    }),
  };

  return {
    manager: manager as unknown as EntityManager,
    manager_: manager,
    created,
    saved,
  };
}

describe('provisionPersonalWorkspace', () => {
  it('writes one personal workspace owned by the user', async () => {
    const { manager, created } = fakeManager();

    await provisionPersonalWorkspace(manager, 'user-1');

    const workspace = created.find((c) => c.entity === WorkspaceEntity);
    expect(workspace?.payload).toEqual({
      owner: { id: 'user-1' },
      name: PERSONAL_WORKSPACE_NAME,
      isPersonal: true,
      organizationId: null,
    });
  });

  it('writes exactly one OWNER membership alongside it', async () => {
    const { manager, created } = fakeManager();

    await provisionPersonalWorkspace(manager, 'user-1');

    const members = created.filter((c) => c.entity === WorkspaceMemberEntity);
    expect(members).toHaveLength(1);
    expect(members[0].payload).toEqual({
      workspace: { id: 'workspace-1' },
      user: { id: 'user-1' },
      role: WorkspaceRole.OWNER,
    });
  });

  it('returns the workspace it created', async () => {
    const { manager } = fakeManager();

    await expect(
      provisionPersonalWorkspace(manager, 'user-1'),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'workspace-1', isPersonal: true }),
    );
  });

  it('performs BOTH writes through the manager it was passed', async () => {
    // The point of the whole test file. If this function ever reaches for an
    // injected repository or `getManager()` instead, it opens its own
    // connection, escapes the caller's transaction, and a failed registration
    // leaves an orphan workspace behind. Counting the calls on the *passed*
    // manager is what catches that; nothing else here would.
    const { manager, manager_ } = fakeManager();

    await provisionPersonalWorkspace(manager, 'user-1');

    expect(manager_.create).toHaveBeenCalledTimes(2);
    expect(manager_.save).toHaveBeenCalledTimes(2);
  });

  it('propagates a failure rather than swallowing it, so the transaction rolls back', async () => {
    const { manager, manager_ } = fakeManager();
    manager_.save.mockRejectedValueOnce(new Error('unique violation'));

    await expect(provisionPersonalWorkspace(manager, 'user-1')).rejects.toThrow(
      'unique violation',
    );
  });
});
