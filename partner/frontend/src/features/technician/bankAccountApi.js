import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The technician's payout bank account. The server never returns the full account number
// (only the masked one), so nothing here has one to keep after a save; the answer is not
// kept in the API cache either.
const bankEndpoints = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techBankAccount: build.query({ query: () => ({ url: '/technicians/me/bank-account' }), keepUnusedDataFor: 0 }),
    techSaveBankAccount: build.mutation({ query: (details) => ({ url: '/technicians/me/bank-account', method: 'PUT', data: details }) }),
  }),
})

export const bankAccountApi = {
  /** The saved account (masked), or null when none has been added. */
  load: () => runQuery(bankEndpoints.endpoints.techBankAccount),
  save: (details) => runMutation(bankEndpoints.endpoints.techSaveBankAccount, details),
}
