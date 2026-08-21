import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface PanelPosition {
  top: number
  left: number
}

/**
 * Positions a floating panel `fixed` beside a rectangle, flipping it above when
 * there is no room below and clamping it inside the viewport.
 *
 * ⚠️ **`fixed`, never `absolute`.** This is the same lesson `NodeMenu` records
 * for the sidebar, and it applies here for two reasons at once: the request
 * editor's panes are independent scroll containers, and the call sites this
 * component is heading for next — `KeyValueEditor`'s cells — sit inside an
 * `overflow-x-auto` table. An absolutely-positioned panel in either is clipped
 * and simply does not appear, which reads as a dead feature rather than as a
 * CSS mistake. Escaping the clip then costs closing on scroll, which is what
 * the listeners below do.
 *
 * `NodeMenu` keeps its own copy of this geometry rather than adopting the hook:
 * it is the memoization-sensitive hot path in the tree and is not worth
 * disturbing for a shared helper it would use once.
 */
export function usePanelAnchor(
  /** The anchor rectangle in viewport coordinates, or `null` when closed. */
  rect: DOMRect | null,
  onDismiss: () => void,
  options: { gap?: number; margin?: number } = {},
) {
  const { gap = 4, margin = 8 } = options
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PanelPosition | null>(null)

  // Measured after mount rather than estimated: a guess wrong by one row is
  // what puts the last item back off-screen, which is the bug this prevents.
  useLayoutEffect(() => {
    if (!rect) {
      setPosition(null)
      return
    }
    const panel = panelRef.current
    if (!panel) return

    const { offsetHeight: height, offsetWidth: width } = panel

    let top = rect.bottom + gap
    if (top + height > window.innerHeight - margin && rect.top > height + gap) {
      top = rect.top - height - gap
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin))

    const left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - width - margin),
    )

    setPosition((current) =>
      current && current.top === top && current.left === left
        ? current
        : { top, left },
    )
  }, [rect, gap, margin])

  useEffect(() => {
    if (!rect) return
    // Capture phase, so scrolling an inner pane closes it too — without `true`
    // the panel hangs in place while its anchor scrolls away.
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [rect, onDismiss])

  /**
   * Style for the panel. ⚠️ It is rendered at `visibility: hidden` for exactly
   * one frame, before the layout effect has measured it — mounting it at its
   * unclamped position instead makes it visibly jump, and mounting it not at
   * all means `offsetHeight` is 0 and it can never be measured.
   */
  const style: React.CSSProperties = {
    position: 'fixed',
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    visibility: position ? 'visible' : 'hidden',
  }

  const reposition = useCallback(() => setPosition(null), [])

  return { panelRef, style, reposition }
}
