import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorMessage, clearRequesterSession, readRequesterSession } from '../../shared/api/apiClient.js'
import { fetchRequester, resumeRequesterSession, startRequesterSessionFromProfessional } from './bookingApi.js'

/**
 * The House Owner / Site Engineer booking session for this tab.
 *
 *   checking   asking the server for this tab's session, or waiting for the hand-off
 *   ready      verified by the Partner backend; `requester` is set
 *   no-opener  this page was not opened from the Professional app (or that window is gone)
 *   error      the hand-off was refused; `message` says why
 *
 * Nothing about the session is kept in the browser: a session already held in memory is
 * re-read from the server, after a reload the server is asked, and otherwise the
 * Professional window that opened this one is asked for a hand-off.
 */
export default function useRequesterSession() {
  const [state, setState] = useState({ status: 'checking', requester: null, message: '' })
  const attempt = useRef(0)

  const connect = useCallback(async () => {
    const thisAttempt = ++attempt.current
    const settle = (next) => {
      if (attempt.current === thisAttempt) setState(next)
    }
    settle({ status: 'checking', requester: null, message: '' })

    try {
      // Re-read from the server: the account may have changed its PIN code in the
      // Professional app, or been suspended, since the session began.
      if (readRequesterSession()) {
        settle({ status: 'ready', requester: await fetchRequester(), message: '' })
        return
      }
      const resumed = await resumeRequesterSession()
      if (resumed) {
        settle({ status: 'ready', requester: resumed.requester, message: '' })
        return
      }
    } catch (error) {
      clearRequesterSession()
      if (error?.response?.status === 403) {
        settle({ status: 'error', requester: null, message: apiErrorMessage(error, 'Booking is not available for this account.') })
        return
      }
    }

    try {
      const session = await startRequesterSessionFromProfessional()
      settle({ status: 'ready', requester: session.requester, message: '' })
    } catch (error) {
      if (error?.code === 'NO_OPENER') {
        settle({ status: 'no-opener', requester: null, message: '' })
      } else if (error?.code === 'TIMEOUT') {
        settle({
          status: 'error',
          requester: null,
          message: 'CREWNBUILD did not respond. Keep your CREWNBUILD dashboard open, then click Book Technician there again.',
        })
      } else {
        settle({ status: 'error', requester: null, message: apiErrorMessage(error, 'Your CREWNBUILD session could not be verified.') })
      }
    }
  }, [])

  useEffect(() => {
    connect()
  }, [connect])

  /** For a 401 in the middle of booking: the session lapsed, so ask the Professional app again. */
  const reconnect = useCallback(() => {
    clearRequesterSession()
    return connect()
  }, [connect])

  return { ...state, reconnect }
}
