import { useNavigate, useParams } from 'react-router'
import { Select } from '../../components/ui/Select'
import { useGetWorkspacesQuery } from './workspacesApi'

/**
 * A dropdown that navigates. The workspace id lives in the URL, so switching
 * *is* a navigation — there is no state to set.
 *
 * ⚠️ **Renders nothing outside a workspace route**, exactly as
 * [EnvironmentPicker](../environments/EnvironmentPicker.tsx) does and for the
 * same reason: the header's workspace controls describe the workspace you are
 * looking at, and on `/profile` you are not looking at one. Without the guard
 * it fell back to its `placeholder` there — a "Select a workspace…" control
 * sitting on the account screen, which reads as a workspace having failed to
 * load rather than as one not being relevant.
 */
export function WorkspaceSwitcher() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { data } = useGetWorkspacesQuery()

  const workspaces = data?.data ?? []
  if (!workspaceId || workspaces.length === 0) return null

  return (
    <Select
      label="Workspace"
      // ⚠️ `undefined`, never `''`: Radix reserves the empty string, and an
      // unmatched value renders a blank trigger with no placeholder.
      value={workspaceId ?? undefined}
      placeholder="Select a workspace…"
      onValueChange={(id) => void navigate(`/w/${id}`)}
      triggerClassName="max-w-[12rem]"
      entries={workspaces.map((workspace) => ({
        value: workspace.id,
        label: workspace.name,
      }))}
    />
  )
}
