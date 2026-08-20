import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App.tsx'
import { store } from './app/store.ts'
import { bootstrapAuth } from './features/auth/bootstrapAuth.ts'
import { initTheme } from './features/theme/theme.ts'
import './index.css'

// Module scope for the same reason as `bootstrapAuth`, plus one of its own: an
// effect runs after the first paint, so the theme would land a frame late and
// flash. The inline script in index.html has already set the attributes from
// storage; this validates what it read against the registry and starts
// listening for OS colour-scheme changes.
initTheme()

// Module scope, not a useEffect: an effect runs twice under StrictMode, and
// with refresh-token rotation the second call would present a token the first
// already burned. It also starts the request a frame or two before React mounts.
void bootstrapAuth(store.dispatch)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
