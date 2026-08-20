import type { RequestScripts } from '@postman-clone/contracts'

/**
 * The pre-request and post-response script slots: two plain `<textarea>`s.
 *
 * No editor library and no syntax highlighting, matching `BodyTab` — that is a
 * dependency, bundle-size and theming decision that belongs with the execution
 * slice, which is also the first point at which highlighting earns anything.
 *
 * ⚠️ **Nothing runs these.** The banner below is not decoration: a code editor
 * that silently does nothing is a worse bug than a missing feature, because the
 * user writes a script, saves it, sends the request and concludes the app is
 * broken. Delete the banner in the same change that lands execution, not before.
 *
 * Both slots are always sent together — `RequestScripts` has no optional
 * fields, so a patch spreads the current pair rather than sending one key.
 */
export function ScriptsTab({
  scripts,
  onChange,
}: {
  scripts: RequestScripts
  onChange: (scripts: RequestScripts) => void
}) {
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Scripts are saved but not executed yet — sending requests is not built.
      </p>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-700">Pre-request</span>
        <span className="block text-xs text-slate-400">
          Runs before the request is sent.
        </span>
        <textarea
          value={scripts.preRequest}
          aria-label="Pre-request script"
          spellCheck={false}
          rows={10}
          onChange={(e) => onChange({ ...scripts, preRequest: e.target.value })}
          className="w-full rounded-md border border-slate-300 p-3 font-mono text-sm outline-none focus:border-indigo-500"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-700">Post-response</span>
        <span className="block text-xs text-slate-400">
          Runs after the response arrives.
        </span>
        <textarea
          value={scripts.postRequest}
          aria-label="Post-response script"
          spellCheck={false}
          rows={10}
          onChange={(e) => onChange({ ...scripts, postRequest: e.target.value })}
          className="w-full rounded-md border border-slate-300 p-3 font-mono text-sm outline-none focus:border-indigo-500"
        />
      </label>
    </div>
  )
}
