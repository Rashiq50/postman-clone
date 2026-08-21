import type { Environment, EnvironmentVariable } from '@postman-clone/contracts'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import {
  Dialog,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from '../../components/ui/Dialog'
import { PromptDialog } from '../../components/ui/PromptDialog'
import { VariableEditor } from './VariableEditor'
import {
  useCreateEnvironmentMutation,
  useDeleteEnvironmentMutation,
  useGetEnvironmentsQuery,
  useUpdateEnvironmentMutation,
} from './environmentsApi'

/**
 * The environment manager: a list on the left, the selected environment's
 * variables on the right.
 *
 * Variables are edited into local state and saved explicitly, mirroring the
 * request editor rather than the sidebar: there is no autosave anywhere in this
 * app, and a grid that saved on every keystroke would be a request per
 * character.
 *
 * ⚠️ No `window.prompt` / `window.confirm` anywhere — New and Rename go through
 * `PromptDialog`, Delete through `ConfirmDialog`. Both natives block the main
 * thread and can be permanently suppressed by the user, after which they
 * silently return `null`/`false` and the button quietly stops working.
 */
export function EnvironmentsDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const { data, isLoading } = useGetEnvironmentsQuery(workspaceId)
  const [createEnvironment, { isLoading: isCreating }] =
    useCreateEnvironmentMutation()
  const [updateEnvironment, { isLoading: isSaving }] =
    useUpdateEnvironmentMutation()
  const [deleteEnvironment] = useDeleteEnvironmentMutation()

  const environments = data?.data ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EnvironmentVariable[] | null>(null)
  const [prompt, setPrompt] = useState<{
    title: string
    initialValue: string
    confirmLabel: string
    onSubmit: (value: string) => void
  } | null>(null)
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  const selected: Environment | undefined =
    environments.find((environment) => environment.id === selectedId) ??
    environments[0]

  /**
   * ⚠️ Keyed on `selected?.id`, never on `selected`. RTK Query hands back a new
   * object identity on every refetch, so depending on the object itself would
   * wipe whatever the user was typing — the same trap `useRequestDraft`
   * documents, and it presents the same way: an intermittently dropped
   * keystroke.
   */
  useEffect(() => {
    setDraft(selected ? selected.variables : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const isDirty =
    draft !== null &&
    selected !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(selected.variables)

  const save = async () => {
    if (!selected || draft === null) return
    await updateEnvironment({
      id: selected.id,
      workspaceId,
      changes: { variables: draft },
    })
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => !next && onClose()}
        title="Environments"
        description="Variables here are substituted into {{placeholders}} when a request is sent."
        footer={
          <>
            <DialogSecondaryAction>Close</DialogSecondaryAction>
            <DialogPrimaryAction
              onClick={() => void save()}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? 'Saving…' : 'Save variables'}
            </DialogPrimaryAction>
          </>
        }
      >
        <div className="flex min-h-[18rem] gap-4">
          <div className="w-48 shrink-0 border-r border-line pr-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-subtle">
                Environments
              </span>
              <button
                type="button"
                disabled={isCreating}
                onClick={() =>
                  setPrompt({
                    title: 'New environment',
                    initialValue: 'New environment',
                    confirmLabel: 'Create',
                    onSubmit: (name) => {
                      void createEnvironment({ workspaceId, name })
                        .unwrap()
                        .then((created) => setSelectedId(created.id))
                        .catch(() => undefined)
                    },
                  })
                }
                className="rounded px-1.5 py-0.5 text-xs text-fg-muted transition hover:bg-surface-muted disabled:opacity-50"
              >
                + New
              </button>
            </div>

            {isLoading && <p className="text-xs text-fg-faint">Loading…</p>}
            {!isLoading && environments.length === 0 && (
              <p className="text-xs text-fg-faint">
                No environments yet. Create one to use {'{{variables}}'}.
              </p>
            )}

            <ul className="space-y-0.5">
              {environments.map((environment) => (
                <li key={environment.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(environment.id)}
                    className={`w-full truncate rounded px-2 py-1 text-left text-sm transition ${
                      environment.id === selected?.id
                        ? 'bg-accent-soft text-accent-soft-fg'
                        : 'text-fg-muted hover:bg-surface-muted'
                    }`}
                  >
                    {environment.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0 flex-1">
            {selected && draft !== null ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {selected.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setPrompt({
                        title: 'Rename environment',
                        initialValue: selected.name,
                        confirmLabel: 'Rename',
                        onSubmit: (name) => {
                          void updateEnvironment({
                            id: selected.id,
                            workspaceId,
                            changes: { name },
                          })
                        },
                      })
                    }
                    className="rounded px-1.5 py-0.5 text-xs text-fg-muted transition hover:bg-surface-muted"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirm({
                        title: 'Delete environment',
                        message: `Delete "${selected.name}"? Anyone using it will fall back to no environment.`,
                        onConfirm: () => {
                          setSelectedId(null)
                          void deleteEnvironment({
                            id: selected.id,
                            workspaceId,
                          })
                        },
                      })
                    }
                    className="rounded px-1.5 py-0.5 text-xs text-danger transition hover:bg-danger-soft"
                  >
                    Delete
                  </button>
                </div>

                <VariableEditor variables={draft} onChange={setDraft} />

                <p className="mt-3 text-xs text-fg-faint">
                  ⚠️ Values are stored and sent in plaintext. Marking one secret
                  masks it in this grid and in saved history — it is not
                  encryption.
                </p>
              </>
            ) : (
              <p className="text-sm text-fg-faint">
                Select an environment, or create one.
              </p>
            )}
          </div>
        </div>
      </Dialog>

      {prompt && (
        <PromptDialog
          title={prompt.title}
          initialValue={prompt.initialValue}
          confirmLabel={prompt.confirmLabel}
          onSubmit={prompt.onSubmit}
          onClose={() => setPrompt(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Delete"
          danger
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
