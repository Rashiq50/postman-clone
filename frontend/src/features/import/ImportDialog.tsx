import type { ImportWarning, ImportWarningKind } from '@raven/contracts'
import { useRef, useState } from 'react'
import {
  Dialog,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from '../../components/ui/Dialog'
import { errorMessage } from '../../lib/api-error'
import {
  ImportFileError,
  parseImportFile,
  type ImportKind,
  type ParsedImportFile,
} from './postmanFile'
import {
  useImportCollectionMutation,
  useImportEnvironmentMutation,
} from './importApi'

/**
 * The app's **first and only file input**, and one dialog for both kinds of
 * Postman export.
 *
 * ⚠️ **It auto-detects rather than asking.** A "Collection or Environment?"
 * radio pair would be a question the file already answers, and the one thing a
 * user can do with it is get it wrong — at which point they get a schema error
 * about a file that was perfectly fine. `detectImportKind` picks the endpoint;
 * the server's DTO has the final say.
 *
 * ⚠️ **No drag-and-drop.** A drop zone is a second input surface with its own
 * `dragover`/`dragleave` state, its own keyboard story (it has none), and its
 * own way to fail silently when the drop lands one pixel outside. A button that
 * opens the OS picker works with a keyboard, works on a phone, and is the
 * affordance every person already knows. Adding drop later is additive.
 *
 * ⚠️ **The `<input type="file">` is hidden behind a styled button rather than
 * styled itself.** A file input cannot be themed — its button is painted by the
 * platform, the same reason `MoveToDialog` cannot use a native `<select>`. So
 * the input carries no visible pixels and a real button clicks it.
 */

/** Grouped so a 40-request collection does not print 40 identical lines. */
function groupWarnings(warnings: ImportWarning[]) {
  const groups = new Map<ImportWarningKind, ImportWarning[]>()
  for (const warning of warnings) {
    const existing = groups.get(warning.kind)
    if (existing) existing.push(warning)
    else groups.set(warning.kind, [warning])
  }
  return [...groups.entries()]
}

/** At most this many paths per kind, so one bad export cannot fill the pane. */
const PATHS_SHOWN = 5

function WarningList({ warnings }: { warnings: ImportWarning[] }) {
  if (warnings.length === 0) {
    return (
      <p className="text-sm text-fg-faint">
        Everything in the file mapped cleanly.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">
        {warnings.length} note{warnings.length === 1 ? '' : 's'} about what
        changed on the way in. Everything else imported normally.
      </p>
      <ul className="space-y-3">
        {groupWarnings(warnings).map(([kind, group]) => (
          <li key={kind} className="space-y-1">
            {/*
              ⚠️ `message` is rendered verbatim, exactly as `ResponsePane` does
              with a send warning. The client branches on `kind`; the wording is
              the server's, so it can be improved without a frontend release.
            */}
            <p className="text-sm">{group[0].message}</p>
            <ul className="space-y-0.5">
              {group.slice(0, PATHS_SHOWN).map((warning, index) => (
                <li
                  key={`${warning.path}-${index}`}
                  className="truncate font-mono text-xs text-fg-faint"
                  title={warning.path}
                >
                  {warning.path}
                </li>
              ))}
              {group.length > PATHS_SHOWN && (
                <li className="text-xs text-fg-faint">
                  …and {group.length - PATHS_SHOWN} more
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface Summary {
  headline: string
  warnings: ImportWarning[]
}

export function ImportDialog({
  workspaceId,
  onClose,
  only,
}: {
  workspaceId: string
  onClose: () => void
  /**
   * Restricts what the dialog will accept. Set to `'environment'` by the
   * environment manager, where importing a whole collection into the
   * variables screen would be a surprise rather than a convenience.
   */
  only?: ImportKind
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<ParsedImportFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  const [importCollection, collectionState] = useImportCollectionMutation()
  const [importEnvironment, environmentState] = useImportEnvironmentMutation()

  const isImporting = collectionState.isLoading || environmentState.isLoading
  const requestError = collectionState.error ?? environmentState.error

  const noun = only === 'environment' ? 'environment' : 'collection or environment'

  const choose = async (file: File | undefined) => {
    if (!file) return
    setFileError(null)
    setPicked(null)

    try {
      const parsed = await parseImportFile(file)
      if (only && parsed.kind !== only) {
        setFileError(
          `"${parsed.fileName}" is a Postman ${parsed.kind} export. This screen imports ${only}s.`,
        )
        return
      }
      setPicked(parsed)
    } catch (error) {
      setFileError(
        error instanceof ImportFileError
          ? error.message
          : 'That file could not be read.',
      )
    }
  }

  const run = () => {
    if (!picked) return

    if (picked.kind === 'collection') {
      void importCollection({ workspaceId, data: picked.data })
        .unwrap()
        .then((result) =>
          setSummary({
            headline: `Imported "${result.collection.name}" — ${result.requestCount} request${
              result.requestCount === 1 ? '' : 's'
            } in ${result.folderCount} folder${result.folderCount === 1 ? '' : 's'}.`,
            warnings: result.warnings,
          }),
        )
        // The error is already in `collectionState.error` and rendered below;
        // an unhandled rejection here would be a second report of one failure.
        .catch(() => undefined)
      return
    }

    void importEnvironment({ workspaceId, data: picked.data })
      .unwrap()
      .then((result) =>
        setSummary({
          headline: `Imported "${result.environment.name}" — ${result.environment.variables.length} variable${
            result.environment.variables.length === 1 ? '' : 's'
          }.`,
          warnings: result.warnings,
        }),
      )
      .catch(() => undefined)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title={summary ? 'Import complete' : 'Import from Postman'}
      description={
        summary
          ? undefined
          : `Choose a Postman ${noun} export (JSON). Nothing already in this workspace is changed.`
      }
      footer={
        summary ? (
          <DialogPrimaryAction onClick={onClose}>Close</DialogPrimaryAction>
        ) : (
          <>
            <DialogSecondaryAction>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction
              onClick={run}
              disabled={!picked || isImporting}
            >
              {isImporting ? 'Importing…' : 'Import'}
            </DialogPrimaryAction>
          </>
        )
      }
    >
      {summary ? (
        <div className="space-y-4">
          <p className="text-sm font-medium">{summary.headline}</p>
          <WarningList warnings={summary.warnings} />
        </div>
      ) : (
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              void choose(event.target.files?.[0])
              // ⚠️ Cleared so picking the *same* file twice fires `change`
              // again — after a failed import the obvious next action is to
              // retry with the file already chosen, and without this the
              // picker closes and nothing happens.
              event.target.value = ''
            }}
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-muted"
            >
              Choose file…
            </button>
            <span className="truncate text-sm text-fg-faint">
              {picked ? `${picked.fileName} — Postman ${picked.kind}` : 'No file chosen'}
            </span>
          </div>

          {fileError && <p className="text-sm text-danger">{fileError}</p>}

          {requestError && (
            <p className="text-sm text-danger">
              {errorMessage(requestError, 'The import failed.')}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}
