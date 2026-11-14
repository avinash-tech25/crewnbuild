import { SESSION_CHECK_TIMEOUT_MS } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The technician's account: sign-up (e-mail one-time code), sign-in, onboarding, the
// dashboard, work preferences and the jobs they hold. Technician session only.
const post = (url, data) => ({ url, method: 'POST', data })

export const technicianApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techSignupSendCode: build.mutation({ query: (email) => post('/auth/signup/send-code', { email }) }),
    techSignupVerifyCode: build.mutation({ query: (body) => post('/auth/signup/verify-code', body) }),
    techLogin: build.mutation({ query: (body) => post('/auth/login', body) }),
    techMe: build.query({
      query: ({ skipRefresh = false } = {}) => ({ url: '/auth/me', timeout: SESSION_CHECK_TIMEOUT_MS, skipRefresh }),
      keepUnusedDataFor: 0,
    }),
    onboardingFace: build.mutation({ query: (form) => post('/onboarding/face', form) }),
    onboardingAadhaar: build.mutation({ query: (body) => post('/onboarding/aadhaar', body) }),
    onboardingProfile: build.mutation({ query: (details) => post('/onboarding/profile', details) }),
    techDashboard: build.query({ query: () => ({ url: '/technicians/me/dashboard' }) }),
    techUpdateProfile: build.mutation({ query: (changes) => ({ url: '/technicians/me', method: 'PATCH', data: changes }) }),
    techAvailability: build.mutation({ query: (status) => ({ url: '/technicians/me/availability', method: 'PATCH', data: { status } }) }),
    techProfileImage: build.mutation({ query: (form) => post('/technicians/me/profile-image', form) }),
    techCatalog: build.query({ query: (trade) => ({ url: '/technicians/me/catalog', params: trade ? { trade } : undefined }) }),
    techWorkPreferences: build.query({ query: () => ({ url: '/technicians/me/work-preferences' }) }),
    techSaveWorkPreferences: build.mutation({ query: (preferences) => ({ url: '/technicians/me/work-preferences', method: 'PUT', data: preferences }) }),
    techJobs: build.query({ query: (bucket) => ({ url: '/technicians/me/jobs', params: { bucket } }) }),
    techStartJob: build.mutation({ query: ({ jobId, otp }) => post(`/technicians/me/jobs/${jobId}/start`, { otp }) }),
    techJobAction: build.mutation({ query: ({ jobId, action }) => post(`/technicians/me/jobs/${jobId}/${action}`) }),
    techHandBackJob: build.mutation({ query: ({ jobId, reason }) => post(`/technicians/me/jobs/${jobId}/cancel`, { reason }) }),
    pincodeAreas: build.query({ query: (pincode) => ({ url: `/locations/pincode/${pincode}` }) }),
  }),
})

const { endpoints } = technicianApi

// ---- sign-up and sign-in ----
export const sendSignupCode = (email) => runMutation(endpoints.techSignupSendCode, email)
export const verifySignupCode = ({ email, phone, code }) => runMutation(endpoints.techSignupVerifyCode, { email, phone, code })
// Sign-in is email + password; the email code above is for registration only.
export const loginWithPassword = ({ email, password }) => runMutation(endpoints.techLogin, { email, password })
export const fetchCurrentTechnician = (options) => runQuery(endpoints.techMe, options)

// ---- onboarding ----
// The face capture is sent once and not kept: the blob goes in this request's body only.
export function submitFaceCapture(blob) {
  const form = new FormData()
  form.append('capture', blob, 'face.jpg')
  form.append('consent', 'true')
  return runMutation(endpoints.onboardingFace, form)
}
// The full Aadhaar number goes in this request's body only; the server answers with it masked.
export const submitAadhaar = (aadhaarNumber) => runMutation(endpoints.onboardingAadhaar, { aadhaar_number: aadhaarNumber, consent: true })
export const completeProfile = (details) => runMutation(endpoints.onboardingProfile, details)

// ---- dashboard ----
export const fetchDashboardSummary = () => runQuery(endpoints.techDashboard)
export const updateTechnicianProfile = (changes) => runMutation(endpoints.techUpdateProfile, changes)
/** AVAILABLE, PAUSED (a break: jobs in hand continue) or OFFLINE. */
export const updateAvailability = (status) => runMutation(endpoints.techAvailability, status)
export function uploadProfileImage(file) {
  const form = new FormData()
  form.append('file', file)
  return runMutation(endpoints.techProfileImage, form)
}

// ---- work preferences ----
/** The live services of a trade a technician may choose from (their own trade once set). */
export const fetchTechnicianCatalog = (trade) => runQuery(endpoints.techCatalog, trade)
export const fetchWorkPreferences = () => runQuery(endpoints.techWorkPreferences)
export const saveWorkPreferences = (preferences) => runMutation(endpoints.techSaveWorkPreferences, preferences)

// ---- jobs ----
export const fetchJobs = (bucket) => runQuery(endpoints.techJobs, bucket)
/** ARRIVED -> IN_PROGRESS: only with the customer's Start Work code, in the body. */
export const startWorkWithOtp = (jobId, otp) => runMutation(endpoints.techStartJob, { jobId, otp })
/** A step on a job this technician already holds (accepting an offer is in dispatchApi). */
export const actOnJob = (jobId, action) => runMutation(endpoints.techJobAction, { jobId, action })
/** Hand back a job before arriving. The booking goes straight back to dispatch. */
export async function handBackJob(jobId, reason = 'OTHER') {
  await runMutation(endpoints.techHandBackJob, { jobId, reason })
}

export const lookupPincodeAreas = (pincode) => runQuery(endpoints.pincodeAreas, pincode)
