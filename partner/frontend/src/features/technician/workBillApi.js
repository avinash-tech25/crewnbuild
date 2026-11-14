import { apiClient, bookingClient } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

/**
 * Work bills. The technician may change a DRAFT bill while the job is in progress and
 * submit it (technician session); the requester can only read their booking's bill
 * (booking session; the server has no requester endpoint that writes to a bill). Photos
 * are fetched as blobs with the session's own cookie, kept in memory only.
 */
const id = (value) => encodeURIComponent(value)
const techBill = (jobId) => `/technicians/me/jobs/${id(jobId)}/bill`
const requesterBill = (bookingId) => `/requester/bookings/${id(bookingId)}/bill`

const billEndpoints = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techBill: build.query({ query: (jobId) => ({ url: techBill(jobId) }) }),
    techBillAddItem: build.mutation({ query: ({ jobId, item }) => ({ url: `${techBill(jobId)}/items`, method: 'POST', data: item }) }),
    techBillUpdateItem: build.mutation({
      query: ({ jobId, itemId, item }) => ({ url: `${techBill(jobId)}/items/${id(itemId)}`, method: 'PUT', data: item }),
    }),
    techBillDeleteItem: build.mutation({ query: ({ jobId, itemId }) => ({ url: `${techBill(jobId)}/items/${id(itemId)}`, method: 'DELETE' }) }),
    techBillNotes: build.mutation({ query: ({ jobId, notes }) => ({ url: `${techBill(jobId)}/notes`, method: 'PUT', data: { notes } }) }),
    techBillSubmit: build.mutation({ query: (jobId) => ({ url: `${techBill(jobId)}/submit`, method: 'POST' }) }),
    techBillUpload: build.mutation({ query: ({ url, form, onUploadProgress }) => ({ url, method: 'POST', data: form, onUploadProgress }) }),
    techBillDeletePhoto: build.mutation({ query: ({ jobId, mediaId }) => ({ url: `${techBill(jobId)}/media/${id(mediaId)}`, method: 'DELETE' }) }),
    requesterBill: build.query({ query: (bookingId) => ({ url: requesterBill(bookingId), principal: 'requester' }) }),
  }),
})

const { endpoints } = billEndpoints

function upload(url, file, onProgress) {
  const form = new FormData()
  form.append('file', file)
  const onUploadProgress = (event) => {
    if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100))
  }
  return runMutation(endpoints.techBillUpload, { url, form, onUploadProgress })
}

/** The signed-in technician's work bills. */
export const workBillApi = {
  load: (jobId) => runQuery(endpoints.techBill, jobId),
  addItem: (jobId, item) => runMutation(endpoints.techBillAddItem, { jobId, item }),
  updateItem: (jobId, itemId, item) => runMutation(endpoints.techBillUpdateItem, { jobId, itemId, item }),
  deleteItem: (jobId, itemId) => runMutation(endpoints.techBillDeleteItem, { jobId, itemId }),
  saveNotes: (jobId, notes) => runMutation(endpoints.techBillNotes, { jobId, notes }),
  /** Finalizes the bill. The job itself is not completed by this. */
  submit: (jobId) => runMutation(endpoints.techBillSubmit, jobId),
  uploadMaterialPhoto: (jobId, itemId, file, onProgress) => upload(`${techBill(jobId)}/items/${id(itemId)}/photos`, file, onProgress),
  uploadAttachment: (jobId, file, onProgress) => upload(`${techBill(jobId)}/attachments`, file, onProgress),
  async deletePhoto(jobId, mediaId) {
    await runMutation(endpoints.techBillDeletePhoto, { jobId, mediaId })
  },
  async photoBlob(jobId, mediaId, signal) {
    return (await apiClient.get(`${techBill(jobId)}/media/${id(mediaId)}/content`, { responseType: 'blob', signal })).data
  },
}

/** The requester's view of a booking's work bill: read only. */
export const requesterWorkBillApi = {
  load: (bookingId) => runQuery(endpoints.requesterBill, bookingId),
  async photoBlob(bookingId, mediaId, signal) {
    return (await bookingClient.get(`${requesterBill(bookingId)}/media/${id(mediaId)}/content`, { responseType: 'blob', signal })).data
  },
}
