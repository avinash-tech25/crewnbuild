import { apiClient } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

/**
 * Running a job: the checklist, notes and job photos (technician session). A photo is sent
 * in the upload's body and fetched back as a blob with the session's own cookie: no token
 * in a URL, no storage detail known here, and nothing written to browser storage (the
 * screens show it from memory).
 */
const job = (jobId) => `/technicians/me/jobs/${encodeURIComponent(jobId)}`

const jobEndpoints = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techJobExecution: build.query({ query: (jobId) => ({ url: `${job(jobId)}/execution` }) }),
    techJobStep: build.mutation({
      query: ({ jobId, stepId, completed }) => ({ url: `${job(jobId)}/steps/${encodeURIComponent(stepId)}`, method: 'PATCH', data: { completed } }),
    }),
    techJobNotes: build.mutation({ query: ({ jobId, notes }) => ({ url: `${job(jobId)}/notes`, method: 'PUT', data: { notes } }) }),
    techJobPhotoUpload: build.mutation({
      query: ({ jobId, form, onUploadProgress }) => ({ url: `${job(jobId)}/media`, method: 'POST', data: form, onUploadProgress }),
    }),
    techJobPhotoDelete: build.mutation({
      query: ({ jobId, mediaId }) => ({ url: `${job(jobId)}/media/${encodeURIComponent(mediaId)}`, method: 'DELETE' }),
    }),
  }),
})

const { endpoints } = jobEndpoints

const progressReporter = (onProgress) => (event) => {
  if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100))
}

export const jobExecutionApi = {
  load: (jobId) => runQuery(endpoints.techJobExecution, jobId),
  setStep: (jobId, stepId, completed) => runMutation(endpoints.techJobStep, { jobId, stepId, completed }),
  saveNotes: (jobId, notes) => runMutation(endpoints.techJobNotes, { jobId, notes }),
  /** `onProgress(percent)` is called while the file is sent. */
  uploadPhoto(jobId, kind, file, onProgress) {
    const form = new FormData()
    form.append('kind', kind)
    form.append('file', file)
    return runMutation(endpoints.techJobPhotoUpload, { jobId, form, onUploadProgress: progressReporter(onProgress) })
  },
  async deletePhoto(jobId, mediaId) {
    await runMutation(endpoints.techJobPhotoDelete, { jobId, mediaId })
  },
  /** A file for the screen, not data for the store: fetched with the client directly. */
  async photoBlob(jobId, mediaId, signal) {
    const response = await apiClient.get(`${job(jobId)}/media/${encodeURIComponent(mediaId)}/content`, { responseType: 'blob', signal })
    return response.data
  },
}
