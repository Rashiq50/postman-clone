import type { ResolvedVariable } from '@raven/contracts'
import { useEffect, useRef } from 'react'
import { usePanelAnchor } from './usePanelAnchor'

/**
 * The `{{`-triggered autocomplete list.
 *
 * ⚠️ **It never takes focus.** The caret has to stay in the contenteditable
 * while the user arrows through the list, so this is a listbox the *input*
 * drives through `aria-activedescendant`: key handling lives in `VariableInput`
 * and this component is presentation plus a click target. Focusing a row here
 * would collapse the selection and put the caret back at offset 0 on accept.
 *
 * Which is also why the rows use `onMouseDown` with `preventDefault` rather
 * than `onClick` — mousedown is what would blur the field, and it fires first.
 */
export function VariableSuggestions({
  id,
  anchor,
  names,
  variables,
  activeIndex,
  onPick,
  onDismiss,
}: {
  id: string
  anchor: DOMRect
  names: string[]
  variables: Map<string, ResolvedVariable>
  activeIndex: number
  onPick: (name: string) => void
  onDismiss: () => void
}) {
  const { panelRef, style } = usePanelAnchor(anchor, onDismiss)
  const listRef = useRef<HTMLDivElement>(null)

  // Keeps the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div
      ref={panelRef}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      className="z-50 max-h-64 w-64 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg glass"
    >
      <div ref={listRef} id={id} role="listbox" aria-label="Variables">
        {names.length === 0 ? (
          <p className="px-3 py-2 text-xs text-fg-faint">
            No matching variables
          </p>
        ) : (
          names.map((name, index) => {
            const resolved = variables.get(name)
            return (
              <div
                key={name}
                id={`${id}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(name)
                }}
                className={`cursor-pointer px-3 py-1.5 ${
                  index === activeIndex ? 'bg-accent-soft' : ''
                }`}
              >
                <span className="block font-mono text-xs text-fg">{name}</span>
                {/* A secret's value is never previewed here: the list is the
                    one surface that appears unbidden, over the shoulder of
                    whoever is watching. The popover reveals on request. */}
                <span className="block truncate font-mono text-[11px] text-fg-faint">
                  {resolved?.secret ? '••••••••' : (resolved?.value ?? '')}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
