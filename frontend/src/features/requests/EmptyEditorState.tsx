/** What `/w/:workspaceId` shows before a request is opened. */
export function EmptyEditorState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-slate-600">No request open</p>
        <p className="mt-1 text-sm text-slate-400">
          Pick a request from the sidebar, or create a collection to get
          started.
        </p>
      </div>
    </div>
  )
}
