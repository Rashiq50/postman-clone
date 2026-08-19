import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App.tsx'
import { store } from './app/store.ts'
import { bootstrapAuth } from './features/auth/bootstrapAuth.ts'
import './index.css'

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
