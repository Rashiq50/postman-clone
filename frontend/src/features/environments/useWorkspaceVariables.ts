import {
  buildVariables,
  type Environment,
  type ResolvedVariable,
} from '@raven/contracts'
import { useMemo } from 'react'
import { useGetWorkspacesQuery } from '../workspaces/workspacesApi'
import { useGetEnvironmentsQuery } from './environmentsApi'

export interface WorkspaceVariables {
  /** The effective lookup table, exactly as the send path would build it. */
  variables: Map<string, ResolvedVariable>
  /** The active environment, or `undefined` when none is selected. */
  activeEnvironment: Environment | undefined
  /** Defined names, sorted, for the autocomplete list. */
  names: string[]
}

const EMPTY: Map<string, ResolvedVariable> = new Map()

/**
 * What `{{var}}` resolves to *right now*, for the editor's chips, autocomplete
 * and popover.
 *
 * ⚠️ **The merge is `buildVariables` from contracts, not a local reduce.** It is
 * the same function the send path calls, which is the only thing that keeps a
 * chip's verdict and the server's warning in agreement — including the trap
 * that a **disabled row is dropped before the merge**, so it can never shadow
 * an enabled row in a lower-precedence scope.
 *
 * The scope array has one entry today. It stays an array so that collection-
 * and request-level variables cost an entry here rather than a rewrite, exactly
 * as on the server.
 *
 * ⚠️ Which environment is active lives on the **workspace member row**, surfaced
 * as `Workspace.activeEnvironmentId` — it is not a property of the environment,
 * so both queries are needed. Both are already subscribed by the header's
 * `EnvironmentPicker`, so for a mounted workbench this is a cache read and not
 * a fetch.
 */
export function useWorkspaceVariables(
  workspaceId: string | undefined,
): WorkspaceVariables {
  const { data: workspaces } = useGetWorkspacesQuery()
  const { data: environments } = useGetEnvironmentsQuery(workspaceId ?? '', {
    skip: !workspaceId,
  })

  const activeEnvironmentId =
    workspaces?.data.find((candidate) => candidate.id === workspaceId)
      ?.activeEnvironmentId ?? null

  const activeEnvironment = environments?.data.find(
    (candidate) => candidate.id === activeEnvironmentId,
  )

  // Keyed on the environment object's identity: RTK Query hands back the same
  // object until the cache actually changes, so this recomputes on a real edit
  // and not on every render of every input using the hook.
  const variables = useMemo(
    () =>
      activeEnvironment
        ? buildVariables([
            { name: 'environment', variables: activeEnvironment.variables },
          ])
        : EMPTY,
    [activeEnvironment],
  )

  const names = useMemo(() => [...variables.keys()].sort(), [variables])

  return { variables, activeEnvironment, names }
}
