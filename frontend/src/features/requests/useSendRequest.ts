import type { SendDraft, SendResult } from '@raven/contracts'
import { useCallback, useRef, useState } from 'react'
import { useSendRequestMutation } from './executionsApi'

/**
 * A thin wrapper over the send mutation that holds the last `SendResult`.
 *
 * The result is kept here rather than read off the mutation's own state because
 * the response pane must keep showing the previous response while the next send
 * is in flight — a pane that blanks on every Send is a flicker on the most
 * frequent action in the app.
 *
 * ⚠️ **Cancelling aborts the *client* subscription, not the upstream call.**
 * The server has already opened (or is about to open) a socket to the target
 * and will run the request to completion, record it in history, and discard the
 * answer. There is deliberately no server-side cancellation beyond the total
 * timeout — see the non-goals in SEND_PLAN.md. So "Cancel" honestly means "stop
 * waiting", and the history row that appears afterwards is not a bug.
 */
export function useSendRequest(requestId: string | undefined) {
  const [send, { isLoading }] = useSendRequestMutation()
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef<{ abort: () => void } | null>(null)

  const run = useCallback(
    async (draft?: SendDraft) => {
      if (!requestId) return
      setError(null)
      // `environmentId` is deliberately never passed: omitting it means "my
      // active environment", which is the server's own answer and the one
      // thing the client should not second-guess.
      const promise = send({ requestId, draft })
      inFlight.current = promise
      try {
        setResult(await promise.unwrap())
      } catch {
        // A failure *here* is one of ours — a 404, a 429, a validation error.
        // Everything about the upstream arrives as a successful `SendResult`
        // with `outcome: 'failure'`, which is the whole point of the contract.
        setError('The request could not be sent. Check your connection or role.')
      } finally {
        inFlight.current = null
      }
    },
    [requestId, send],
  )

  const cancel = useCallback(() => {
    inFlight.current?.abort()
    inFlight.current = null
  }, [])

  /** Clears the pane when the user navigates to a different request. */
  const reset = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return { run, cancel, reset, result, error, isSending: isLoading }
}
