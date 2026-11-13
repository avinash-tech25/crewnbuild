import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

export const accountDeletionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // The public /delete-account page (no sign-in): the support e-mail and the roles.
    accountDeletionConfig: build.query({ query: () => ({ url: '/account-deletion-requests/config' }) }),
    // Profile Settings > Delete Account (signed in): the form, filled in from the account.
    deletionForm: build.query({ query: () => ({ url: '/account/deletion-form' }) }),
    deleteOwnAccount: build.mutation({ query: (body) => ({ url: '/account/delete', method: 'POST', data: body }) }),
  }),
})

export const fetchAccountDeletionConfig = () => runQuery(accountDeletionApi.endpoints.accountDeletionConfig)
export const fetchDeletionForm = () => runQuery(accountDeletionApi.endpoints.deletionForm)
// Deletes the signed-in account immediately and ends every session. Irreversible.
export const deleteOwnAccount = (payload) => runMutation(accountDeletionApi.endpoints.deleteOwnAccount, payload)
