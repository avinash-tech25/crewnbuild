import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Conversations and their messages. New messages arrive live on the conversation
// socket (MessageThread); these calls load and send.
export const messagesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    conversations: build.query({ query: () => ({ url: '/messages/conversations' }) }),
    conversationMessages: build.query({
      query: ({ conversationId, params }) => ({ url: `/messages/conversation/${conversationId}`, params }),
    }),
    sendMessage: build.mutation({ query: (details) => ({ url: '/messages/send', method: 'POST', data: details }) }),
    editMessage: build.mutation({ query: ({ messageId, body }) => ({ url: `/messages/${messageId}`, method: 'PUT', data: { body } }) }),
    startConversation: build.mutation({ query: (details) => ({ url: '/messages/start', method: 'POST', data: details }) }),
  }),
})

const { endpoints } = messagesApi

export const fetchConversations = () => runQuery(endpoints.conversations)
export const fetchConversationMessages = (conversationId, params = {}) =>
  runQuery(endpoints.conversationMessages, { conversationId, params })
export const sendConversationMessage = (messageDetails) => runMutation(endpoints.sendMessage, messageDetails)
export const editConversationMessage = (messageId, body) => runMutation(endpoints.editMessage, { messageId, body })
export const startConversation = (conversationDetails) => runMutation(endpoints.startConversation, conversationDetails)
