import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Projects: the owner's own, the nearby builders and suppliers for one, timeline
// updates and site photos.
const onlySet = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value))

export const projectsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    ownerProjects: build.query({ query: () => ({ url: '/owners/projects' }) }),
    createProject: build.mutation({
      // With a cover picture the project travels as a form.
      query: (details) => ({
        url: details instanceof FormData ? '/projects/create-with-image' : '/projects/create',
        method: 'POST',
        data: details,
      }),
    }),
    nearbyBuilders: build.query({ query: (params) => ({ url: '/contractors/nearby', params }) }),
    nearbySuppliers: build.query({ query: (params) => ({ url: '/suppliers/nearby', params }) }),
    nearbyClientProjects: build.query({ query: (params) => ({ url: '/contractors/find-clients', params }) }),
    saveTimelineUpdate: build.mutation({
      query: ({ projectId, form }) => ({ url: '/timelines/create', method: 'POST', params: { project_id: projectId }, data: form }),
    }),
    projectTimeline: build.query({ query: (projectId) => ({ url: `/timelines/project/${projectId}` }) }),
    projectDetails: build.query({ query: (projectId) => ({ url: `/projects/${projectId}` }) }),
    projectPhotos: build.query({ query: (projectId) => ({ url: `/projects/${projectId}/photos` }) }),
    saveDailyWorkflow: build.mutation({
      query: ({ projectId, form }) => ({ url: `/projects/${projectId}/daily-workflow`, method: 'POST', data: form }),
    }),
    deleteProjectPhoto: build.mutation({ query: (photoId) => ({ url: `/project-photos/${photoId}`, method: 'DELETE' }) }),
    deleteProject: build.mutation({ query: (projectId) => ({ url: `/projects/${projectId}`, method: 'DELETE' }) }),
    updateRequirement: build.mutation({
      query: ({ projectId, requirement }) => ({ url: `/projects/${projectId}/requirement`, method: 'PATCH', data: requirement }),
    }),
    supplierProjects: build.query({ query: () => ({ url: '/suppliers/my-projects' }) }),
  }),
})

const { endpoints } = projectsApi

export const fetchOwnerProjects = () => runQuery(endpoints.ownerProjects)
export const createProjectRequest = (projectDetails) => runMutation(endpoints.createProject, projectDetails)
export const fetchNearbyContractors = (pincode, country, projectId) =>
  runQuery(endpoints.nearbyBuilders, onlySet({ pincode, country, project_id: projectId }))
export const fetchNearbySuppliers = (pincode, country, projectId) =>
  runQuery(endpoints.nearbySuppliers, onlySet({ pincode, country, project_id: projectId }))
export const fetchNearbyProjects = (country) => runQuery(endpoints.nearbyClientProjects, onlySet({ country }))
export const saveTimelineUpdate = (projectId, form) => runMutation(endpoints.saveTimelineUpdate, { projectId, form })
export const fetchProjectTimelineEntries = (projectId) => runQuery(endpoints.projectTimeline, projectId)
export const fetchProjectDetails = (projectId) => runQuery(endpoints.projectDetails, projectId)
export const fetchProjectPhotos = (projectId) => runQuery(endpoints.projectPhotos, projectId)
export const saveDailyWorkflow = (projectId, form) => runMutation(endpoints.saveDailyWorkflow, { projectId, form })
export const deleteProjectPhoto = (photoId) => runMutation(endpoints.deleteProjectPhoto, photoId)
export const deleteOwnerProject = (projectId) => runMutation(endpoints.deleteProject, projectId)
export const updateProjectRequirement = (projectId, requirement) => runMutation(endpoints.updateRequirement, { projectId, requirement })
export const fetchSupplierMyProjects = () => runQuery(endpoints.supplierProjects)
