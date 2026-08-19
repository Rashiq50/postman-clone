import { useNavigate, useParams } from 'react-router'
import { useGetWorkspacesQuery } from './workspacesApi'

/**
 * A plain `<select>` that navigates. The workspace id lives in the URL, so
 * switching *is* a navigation — there is no state to set.
 */
export function WorkspaceSwitcher() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { data } = useGetWorkspacesQuery()

  const workspaces = data?.data ?? []
  if (workspaces.length === 0) return null

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Workspace</span>
      <select
        value={workspaceId ?? ''}
        onChange={(e) => void navigate(`/w/${e.target.value}`)}
        className="max-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
      >
        {/* Only while the route has no workspace — otherwise a controlled
            select with no matching option warns and renders blank. */}
        {!workspaceId && <option value="">Select a workspace…</option>}
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  )
}
