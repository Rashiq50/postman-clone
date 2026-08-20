/** What `/w/:workspaceId` shows before a request is opened. */
export function EmptyEditorState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-fg-muted">No request open</p>
        <p className="mt-1 text-sm text-fg-faint">
          Pick a request from the sidebar, or create a collection to get
          started.
        </p>
      </div>
    </div>
  )
}
