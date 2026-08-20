import { useNavigate, useParams } from 'react-router'
import { Select } from '../../components/ui/Select'
import { useGetWorkspacesQuery } from './workspacesApi'

/**
 * A dropdown that navigates. The workspace id lives in the URL, so switching
 * *is* a navigation — there is no state to set.
 */
export function WorkspaceSwitcher() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { data } = useGetWorkspacesQuery()

  const workspaces = data?.data ?? []
  if (workspaces.length === 0) return null

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
