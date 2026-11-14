import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Engineers and suppliers on a project: the builder's team, invitations, discovery,
// the owner-side engineer assignment and the project specialist team.
const post = (url, data) => ({ url, method: 'POST', data })
const onlySet = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value))

export const engineersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Builder side
    inviteEngineer: build.mutation({ query: (payload) => post('/engineers/invite', payload) }),
    engineerTeam: build.query({ query: () => ({ url: '/engineers/my-team' }) }),
    revokeInvitation: build.mutation({ query: (invitationId) => post('/engineers/invite/revoke', { invitation_id: invitationId }) }),
    nearbyEngineers: build.query({ query: (params) => ({ url: '/engineers/find', params }) }),
    sendBuilderEngineerRequest: build.mutation({ query: (payload) => post('/engineers/send-request', payload) }),
    respondJoinRequest: build.mutation({
      query: ({ relationshipId, action }) => post('/engineers/join-request/respond', { relationship_id: relationshipId, action }),
    }),
    assignEngineerFromRequest: build.mutation({ query: (requestId) => post('/project-requests/assign-engineer', { request_id: requestId }) }),
    assignEngineer: build.mutation({ query: ({ projectId, engineerId }) => post(`/projects/${projectId}/assign-engineer`, { engineer_id: engineerId }) }),
    projectEngineer: build.query({ query: (projectId) => ({ url: `/projects/${projectId}/engineer` }) }),
    unassignEngineer: build.mutation({
      query: ({ projectId, engineerId }) => post(`/projects/${projectId}/unassign-engineer`, { engineer_id: engineerId }),
    }),
    // Engineer side
    joinTeam: build.mutation({ query: (inviteCode) => post('/engineers/join-team', { invite_code: inviteCode }) }),
    requestJoin: build.mutation({ query: (builderId) => post('/engineers/request-join', { contractor_id: builderId }) }),
    opportunities: build.query({ query: (params) => ({ url: '/engineers/opportunities', params }) }),
    applyOpportunity: build.mutation({ query: (projectId) => post(`/engineers/opportunities/${projectId}/apply`) }),
    engineerProjects: build.query({ query: () => ({ url: '/engineers/my-projects' }) }),
    // Supplier assignment
    builderSuppliers: build.query({ query: () => ({ url: '/contractors/my-suppliers' }) }),
    assignSupplier: build.mutation({
      query: ({ projectId, supplierId, engineerId }) =>
        post(`/projects/${projectId}/assign-supplier`, { supplier_id: supplierId, engineer_id: engineerId }),
    }),
    unassignSupplier: build.mutation({
      query: ({ projectId, supplierId, engineerId }) =>
        post(`/projects/${projectId}/unassign-supplier`, { supplier_id: supplierId, engineer_id: engineerId }),
    }),
    projectSuppliers: build.query({ query: (projectId) => ({ url: `/projects/${projectId}/suppliers` }) }),
    projectTeamSuppliers: build.query({ query: (projectId) => ({ url: `/projects/${projectId}/team-suppliers` }) }),
    // Project specialist team
    specialistTeam: build.query({ query: (projectId) => ({ url: `/projects/${projectId}/specialist-team` }) }),
    specialistCandidates: build.query({
      query: ({ projectId, category }) => ({ url: `/projects/${projectId}/specialist-candidates`, params: { category } }),
    }),
    sendSpecialistRequest: build.mutation({
      query: ({ projectId, engineerId }) => post(`/projects/${projectId}/specialist-request`, { engineer_id: engineerId }),
    }),
  }),
})

const { endpoints } = engineersApi

// ---- Builder side ----
export const inviteEngineer = (payload) => runMutation(endpoints.inviteEngineer, payload)
export const fetchEngineerTeam = () => runQuery(endpoints.engineerTeam)
export const revokeEngineerInvitation = (invitationId) => runMutation(endpoints.revokeInvitation, invitationId)
// `category` narrows discovery to one Engineer Category ('Site Engineer' for Find Site
// Engineers); omitted, the list is unfiltered.
export const fetchNearbyEngineers = (pincode, country, projectId, category) =>
  runQuery(endpoints.nearbyEngineers, onlySet({ pincode, country, project_id: projectId, category }))
export const sendContractorEngineerRequest = (engineerId, projectId) =>
  runMutation(endpoints.sendBuilderEngineerRequest, projectId ? { engineer_id: engineerId, project_id: projectId } : { engineer_id: engineerId })
export const respondEngineerJoinRequest = (relationshipId, action) => runMutation(endpoints.respondJoinRequest, { relationshipId, action })
// The owner-side assignment for a self-construction project: the owner picks one
// engineer who has already accepted, as they pick a builder quotation.
export const assignEngineerFromRequest = (requestId) => runMutation(endpoints.assignEngineerFromRequest, requestId)
export const assignEngineerToProject = (projectId, engineerId) => runMutation(endpoints.assignEngineer, { projectId, engineerId })
export const fetchProjectEngineer = (projectId) => runQuery(endpoints.projectEngineer, projectId)
export const unassignEngineerFromProject = (projectId, engineerId) => runMutation(endpoints.unassignEngineer, { projectId, engineerId })

// ---- Engineer side ----
export const joinEngineerTeam = (inviteCode) => runMutation(endpoints.joinTeam, inviteCode)
export const requestEngineerJoin = (builderId) => runMutation(endpoints.requestJoin, builderId)
export const fetchEngineerOpportunities = (country) => runQuery(endpoints.opportunities, onlySet({ country }))
export const applyEngineerOpportunity = (projectId) => runMutation(endpoints.applyOpportunity, projectId)
export const fetchEngineerProjects = () => runQuery(endpoints.engineerProjects)

// ---- Supplier assignment ----
export const fetchContractorSuppliers = () => runQuery(endpoints.builderSuppliers)
export const assignSupplierToProject = (projectId, supplierId, engineerId) =>
  runMutation(endpoints.assignSupplier, { projectId, supplierId, engineerId })
export const unassignSupplierFromProject = (projectId, supplierId, engineerId) =>
  runMutation(endpoints.unassignSupplier, { projectId, supplierId, engineerId })
export const fetchProjectSuppliers = (projectId) => runQuery(endpoints.projectSuppliers, projectId)
// Site Engineer only: every Supplier the project's Builder has accepted, plus any
// assigned to this engineer on the project.
export const fetchProjectTeamSuppliers = (projectId) => runQuery(endpoints.projectTeamSuppliers, projectId)

// ---- Builder -> project specialist team (accept/reject use the request endpoints) ----
export const fetchProjectSpecialistTeam = (projectId) => runQuery(endpoints.specialistTeam, projectId)
export const fetchProjectSpecialistCandidates = (projectId, category) => runQuery(endpoints.specialistCandidates, { projectId, category })
export const sendProjectSpecialistRequest = (projectId, engineerId) => runMutation(endpoints.sendSpecialistRequest, { projectId, engineerId })
