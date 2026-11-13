import { baseApi } from './baseApi.js'
import { runMutation } from './callEndpoint.js'

export const uploadApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    uploadFile: build.mutation({ query: (formData) => ({ url: '/files/upload', method: 'POST', data: formData }) }),
  }),
})

export async function uploadLocalFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const stored = await runMutation(uploadApi.endpoints.uploadFile, formData)
  return { ...stored, previewUrl: URL.createObjectURL(file), name: file.name, type: file.type }
}
