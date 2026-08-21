import { useState } from 'react'
import { useParams } from 'react-router'
import { Select } from '../../components/ui/Select'
import { useGetWorkspacesQuery } from '../workspaces/workspacesApi'
import { EnvironmentsDialog } from './EnvironmentsDialog'
import {
  useGetEnvironmentsQuery,
  useSetActiveEnvironmentMutation,
} from './environmentsApi'

/**
 * ⚠️ **`Select` reserves the empty string**, so "No environment" needs a real
 * sentinel rather than `''` — passing `''` renders a blank trigger with no
 * placeholder and the row cannot be selected at all. It is mapped back to
 * `null` at the mutation boundary, which is the only place it exists.
 */
const NONE = '__none__'

/**
 * The active-environment picker, beside `WorkspaceSwitcher` in the header.
 *
 * Renders nothing outside a workspace route: the preference is per
 * (member, workspace), so with no workspace id there is nothing to pick for.
 */
export function EnvironmentPicker() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [managing, setManaging] = useState(false)

  const { data: workspaces } = useGetWorkspacesQuery()
  const { data: environments } = useGetEnvironmentsQuery(workspaceId ?? '', {
    skip: !workspaceId,
  })
  const [setActiveEnvironment] = useSetActiveEnvironmentMutation()

  if (!workspaceId) return null

  const workspace = workspaces?.data.find(
    (candidate) => candidate.id === workspaceId,
  )
  const items = environments?.data ?? []

  return (
    <>
      <div className="flex items-center gap-1">
        <Select
          label="Environment"
          // Never `undefined` here: "no environment" is a real, selectable
          // choice rather than an empty state.
          value={workspace?.activeEnvironmentId ?? NONE}
          onValueChange={(value) => {
            void setActiveEnvironment({
              workspaceId,
              environmentId: value === NONE ? null : value,
            })
          }}
          triggerClassName="max-w-[11rem]"
          entries={[
            { value: NONE, label: 'No environment' },
            ...items.map((environment) => ({
              value: environment.id,
              label: environment.name,
            })),
          ]}
        />
        <button
          type="button"
          onClick={() => setManaging(true)}
          aria-label="Manage environments"
          title="Manage environments"
          className="rounded-md px-2 py-1.5 text-sm text-fg-muted transition hover:bg-surface-muted"
        >
          ⚙
        </button>
      </div>

      {managing && (
        <EnvironmentsDialog
          workspaceId={workspaceId}
          onClose={() => setManaging(false)}
        />
      )}
    </>
  )
}
