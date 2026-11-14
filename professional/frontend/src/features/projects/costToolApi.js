import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The site cost register (labour, materials, expenses, machinery, payments per day) and
// the House Owner's own Project Analysis, an owner-safe subset of its summary.
const registerEntry = (path) => ({ registerId, details }) => ({
  url: `/cost-tool/registers/${registerId}/${path}`,
  method: 'POST',
  data: details,
})

export const costToolApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    ownerProjectAnalysis: build.query({ query: (projectId) => ({ url: `/owners/projects/${projectId}/analysis` }) }),
    costSummary: build.query({
      query: ({ projectId, workDate }) => ({
        url: `/cost-tool/projects/${projectId}/summary`,
        params: workDate ? { work_date: workDate } : {},
      }),
    }),
    saveRegister: build.mutation({ query: (details) => ({ url: '/cost-tool/registers', method: 'POST', data: details }) }),
    saveLabour: build.mutation({ query: registerEntry('labour') }),
    saveMaterialUsage: build.mutation({ query: registerEntry('material-usage') }),
    saveMaterialPurchase: build.mutation({ query: registerEntry('material-purchases') }),
    saveExpense: build.mutation({ query: registerEntry('expenses') }),
    saveMachinery: build.mutation({ query: registerEntry('machinery') }),
    savePayment: build.mutation({ query: registerEntry('payments') }),
  }),
})

const { endpoints } = costToolApi

export const fetchOwnerProjectAnalysis = (projectId) => runQuery(endpoints.ownerProjectAnalysis, projectId)
export const fetchCostToolSummary = (projectId, workDate) => runQuery(endpoints.costSummary, { projectId, workDate })
export const saveDailyCostRegister = (details) => runMutation(endpoints.saveRegister, details)
export const saveCostLabourEntry = (registerId, details) => runMutation(endpoints.saveLabour, { registerId, details })
export const saveCostMaterialUsage = (registerId, details) => runMutation(endpoints.saveMaterialUsage, { registerId, details })
export const saveCostMaterialPurchase = (registerId, details) => runMutation(endpoints.saveMaterialPurchase, { registerId, details })
export const saveCostExpense = (registerId, details) => runMutation(endpoints.saveExpense, { registerId, details })
export const saveCostMachineryUsage = (registerId, details) => runMutation(endpoints.saveMachinery, { registerId, details })
export const saveCostPayment = (registerId, details) => runMutation(endpoints.savePayment, { registerId, details })
