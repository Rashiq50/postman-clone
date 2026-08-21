import type { RequestScripts } from '@postman-clone/contracts'

/**
 * The pre-request and post-response script slots: two plain `<textarea>`s.
 *
 * No editor library and no syntax highlighting, matching `BodyTab` and the
 * response pane — the execution slice reconsidered that dependency question
 * and answered it the same way.
 *
 * ⚠️ **Nothing runs these, and sending exists now.** The banner below is not
 * decoration and it is *more* necessary than it was, not less: a code editor
 * that silently does nothing is a worse bug than a missing feature, and now
 * that Send works a user can write a script, save it, press Send, watch a real
 * response come back, and reasonably conclude the script ran. **Keep the banner
 * until scripts actually execute** — the instruction here used to say to delete
 * it when execution landed, which was wrong: a sandbox is the security surface,
 * and `node:vm` is not a security boundary. That is its own slice.
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
      <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">
        Scripts are saved but never executed. Sending a request ignores both
        slots.
      </p>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg-muted">Pre-request</span>
        <span className="block text-xs text-fg-faint">
          Runs before the request is sent.
        </span>
        <textarea
          value={scripts.preRequest}
          aria-label="Pre-request script"
          spellCheck={false}
          rows={10}
          onChange={(e) => onChange({ ...scripts, preRequest: e.target.value })}
          className="w-full rounded-md border border-line-strong p-3 font-mono text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-fg-muted">Post-response</span>
        <span className="block text-xs text-fg-faint">
          Runs after the response arrives.
        </span>
        <textarea
          value={scripts.postRequest}
          aria-label="Post-response script"
          spellCheck={false}
          rows={10}
          onChange={(e) => onChange({ ...scripts, postRequest: e.target.value })}
          className="w-full rounded-md border border-line-strong p-3 font-mono text-sm outline-none focus:border-accent"
        />
      </label>
    </div>
  )
}
