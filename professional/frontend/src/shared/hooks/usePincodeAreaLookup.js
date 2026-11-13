import { useEffect, useState } from 'react'
import { lookupPincodeArea } from '../../features/onboarding/locationApi.js'

export const INDIA_PINCODE_LENGTH = 6

const idleState = { status: 'idle', areaDetails: null, branches: [], message: '', messageKey: '' }

// Every refusal this hook reports is now named by a KEY rather than by an
// English sentence. `message` stays on the state for the one case that is not
// interface copy — the resolved area, which is a place name the API returned —
// so PincodeAreaHint can tell "there is something to say" from "there is
// nothing"; it decides what to say from `status` and `messageKey`.
const MESSAGE_KEYS = {
  invalid: 'location.invalid',
  incomplete: 'location.incomplete',
  loading: 'location.fetching',
  notFound: 'location.notFound',
}

// What the lookup API's refusal means, by status code. Each has its own message
// in PincodeAreaHint so an invalid, an unknown and an unmapped pincode never
// read as the same thing.
function failureStatus(error) {
  const code = error?.response?.status
  if (code === 400) return 'invalid'
  if (code === 404) return 'unknown'
  if (code === 422) return 'unmapped'
  return 'unavailable'
}

export function usePincodeAreaLookup(pincode, onAreaResolved, country = 'India') {
  const [lookupState, setLookupState] = useState(idleState)

  useEffect(() => {
    const enteredPincode = String(pincode || '').replace(/\s/g, '')
    const cleanedPincode = enteredPincode.replace(/\D/g, '')

    // The pincode -> area lookup uses the India postal API. Any other country
    // has no lookup, so keep the field a plain manual input instead of calling
    // a wrong-country API and showing an error.
    const isIndia = String(country || 'India').trim().toLowerCase() === 'india'
    if (!isIndia) {
      setLookupState({ status: 'info', areaDetails: null, branches: [], message: '', messageKey: '' })
      return undefined
    }

    if (!enteredPincode) {
      setLookupState(idleState)
      return undefined
    }

    // An Indian pincode is exactly six digits: letters, symbols or a seventh
    // digit are refused straight away, and nothing is looked up until all six
    // are there.
    if (/\D/.test(enteredPincode) || enteredPincode.length > INDIA_PINCODE_LENGTH) {
      setLookupState({ status: 'invalid', areaDetails: null, branches: [], message: '', messageKey: MESSAGE_KEYS.invalid })
      return undefined
    }
    if (enteredPincode.length < INDIA_PINCODE_LENGTH) {
      setLookupState({ status: 'incomplete', areaDetails: null, branches: [], message: '', messageKey: MESSAGE_KEYS.incomplete })
      return undefined
    }

    // The previous pincode's branches go at once, not after the debounce, so a
    // branch of the old pincode can never be clicked while the new one loads.
    setLookupState({ status: 'loading', areaDetails: null, branches: [], message: '', messageKey: MESSAGE_KEYS.loading })
    let lookupCancelled = false
    const lookupTimer = window.setTimeout(() => {
      lookupPincodeArea(cleanedPincode)
        .then((areaDetails) => {
          if (lookupCancelled) return
          setLookupState({
            status: 'success',
            areaDetails,
            branches: Array.isArray(areaDetails.post_offices) ? areaDetails.post_offices : [],
            // A place name the API returned, not interface copy. PincodeAreaHint
            // passes it through `td` so it reads in the selected language.
            message: areaDetails.display,
            messageKey: '',
          })
          onAreaResolved?.(areaDetails)
        })
        .catch((error) => {
          if (lookupCancelled) return
          // The server's `detail` is raw English prose. PincodeAreaHint already
          // has a written sentence for each of the four failure codes, in every
          // language, so the code is what travels and the English never does.
          setLookupState({
            status: failureStatus(error),
            areaDetails: null,
            branches: [],
            message: '',
            messageKey: MESSAGE_KEYS.notFound,
          })
        })
    }, 450)

    return () => {
      lookupCancelled = true
      window.clearTimeout(lookupTimer)
    }
  }, [pincode, onAreaResolved, country])

  return lookupState
}
