import * as RadixSelect from '@radix-ui/react-select'
import type { ReactNode } from 'react'

/**
 * The app's one dropdown, over Radix's `Select`.
 *
 * ⚠️ Same rule as [Dialog](./Dialog.tsx): a **behaviour** dependency, not a
 * design system. Radix contributes the listbox keyboard model (arrows, Home,
 * End, typeahead), the popper with collision flipping, the portal that escapes
 * an `overflow` ancestor, focus return to the trigger, and the ARIA wiring.
 * Every colour is a token, so `yarn contrast` still covers this surface.
 *
 * ⚠️ **Why not keep the native `<select>`.** The closed control is styleable
 * and was fine; the *open list* is not. `<option>` is painted by the platform,
 * which is why the move dialog's list box came out white on the dark themes
 * (see `MoveToDialog`) — `color-scheme` gets the popup close on macOS and is
 * the only lever there is. Beyond looks it also cannot show a hint line under
 * an option, which the theme picker wants. Everything visible is ours now.
 *
 * The trade recorded so it can be re-judged: the native control was
 * keyboard- and screen-reader-correct for free and cost nothing. This is
 * ~15 kB gzipped for all six pickers, and the correctness now depends on Radix
 * rather than on the browser.
 */

export interface SelectItem {
  value: string
  label: string
  /** Secondary line under the label. The theme picker's `hint`. */
  hint?: string
  /** Extra classes for this item's label — the method colours use it. */
  className?: string
}

export interface SelectGroup {
  label: string
  items: SelectItem[]
}

type Entry = SelectItem | SelectGroup

const isGroup = (entry: Entry): entry is SelectGroup => 'items' in entry

export function Select({
  value,
  onValueChange,
  label,
  placeholder,
  entries,
  triggerClassName = '',
  renderValue,
}: {
  /** Radix reserves `''`; pass `undefined` for "nothing selected". */
  value: string | undefined
  onValueChange: (value: string) => void
  /** Accessible name. There is no visible label slot — every call site here
   *  either has its own `<span>` or is self-evident. */
  label: string
  placeholder?: string
  entries: Entry[]
  triggerClassName?: string
  /** Overrides what the trigger shows for the current value. */
  renderValue?: (value: string) => ReactNode
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        aria-label={label}
        className={`flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg-muted outline-none hover:bg-surface-muted focus:border-accent data-[placeholder]:text-fg-faint ${triggerClassName}`}
      >
        <span className="min-w-0 truncate">
          {renderValue && value ? (
            renderValue(value)
          ) : (
            <RadixSelect.Value placeholder={placeholder} />
          )}
        </span>
        {/* The same text glyph the sidebar uses, for the same reason. */}
        <RadixSelect.Icon className="text-xs text-fg-faint">▾</RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          // `popper` rather than the default `item-aligned`: item-aligned tries
          // to place the selected row over the trigger, which on a long list
          // (every workspace, every folder) pins the panel to a viewport edge
          // and scrolls the rest out of reach.
          position="popper"
          sideOffset={4}
          // ⚠️ The height is capped by Radix's own available-height variable, not by a
          // fixed `max-h`: a fixed one clipped the last item's hint line even with
          // room to spare, and an uncapped one runs off the viewport on a long list.
          className="z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface shadow-lg glass"
        >
          <RadixSelect.ScrollUpButton className="flex justify-center py-1 text-xs text-fg-faint">
            ▴
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="p-1">
            {entries.map((entry) =>
              isGroup(entry) ? (
                <RadixSelect.Group key={entry.label}>
                  <RadixSelect.Label className="px-2 py-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase">
                    {entry.label}
                  </RadixSelect.Label>
                  {entry.items.map((item) => (
                    <Item key={item.value} item={item} />
                  ))}
                </RadixSelect.Group>
              ) : (
                <Item key={entry.value} item={entry} />
              ),
            )}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex justify-center py-1 text-xs text-fg-faint">
            ▾
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

function Item({ item }: { item: SelectItem }) {
  return (
    <RadixSelect.Item
      value={item.value}
      // `data-highlighted` is keyboard *and* pointer focus; `data-state=checked`
      // is the current value. They are different things and both need to read
      // as such — highlighting only the checked row makes arrowing invisible.
      className="cursor-default rounded px-2 py-1.5 text-sm text-fg-muted outline-none select-none data-[highlighted]:bg-surface-muted data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent-soft-fg"
    >
      <RadixSelect.ItemText>
        <span className={item.className}>{item.label}</span>
      </RadixSelect.ItemText>
      {item.hint && <p className="mt-0.5 text-xs text-fg-faint">{item.hint}</p>}
    </RadixSelect.Item>
  )
}
