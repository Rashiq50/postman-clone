import { useSyncExternalStore } from 'react'
import { getThemeState, setPreference, subscribeToTheme } from './theme'
import type { ThemeState } from './theme'

export interface UseTheme extends ThemeState {
  setPreference: (preference: ThemeState['preference']) => void
}

/**
 * `useSyncExternalStore` rather than `useState` + an effect: the store is
 * already live before React mounts, and several components may read it. This
 * is the hook React provides for exactly that shape, and it keeps the theme
 * correct across a concurrent render rather than one commit behind.
 */
export function useTheme(): UseTheme {
  const state = useSyncExternalStore(subscribeToTheme, getThemeState)
  return { ...state, setPreference }
}
