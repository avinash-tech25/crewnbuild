import { useEffect, useRef, useState } from 'react'
import { readPhoneVerificationConfig } from '../../features/auth/phoneCodeApi.js'
import { watchPhoneConfig } from '../../features/auth/phoneConfigWatch.js'

// The API's sign-up and sign-in config. `config` stays null until the API has
// answered; `unreachable` says it has failed to so far (see phoneConfigWatch).
export function usePhoneConfig() {
  const [state, setState] = useState({ config: null, unreachable: false })
  const watch = useRef(null)

  useEffect(() => {
    watch.current = watchPhoneConfig(readPhoneVerificationConfig, setState)
    return () => watch.current.stop()
  }, [])

  return { ...state, retry: () => watch.current?.retry() }
}
