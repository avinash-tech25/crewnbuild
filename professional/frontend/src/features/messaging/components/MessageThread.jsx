import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { FileText, ImagePlus, Search, SendHorizontal } from 'lucide-react'
import DashboardCard from '../../../shared/dashboard/DashboardCard.jsx'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import {
  acceptProjectRequest,
  confirmProjectAssignment,
  rejectProjectRequest,
} from '../../requests/requestsApi.js'
import {
  editConversationMessage,
  fetchConversationMessages,
  fetchConversations,
  sendConversationMessage,
} from '../messagesApi.js'
import { imageUrl, websocketUrl } from '../../../shared/api/apiClient.js'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { AssignmentMessageCard, ChatEventCard, RequestMessageCard, parseChatEvent, requestLinkFor } from './MessageCards.jsx'
import {
  assignmentBodyWithStatus,
  dayLabel,
  formatMessageTime,
  messageAttachmentType,
  parseAssignmentMessage,
  parseRequestMessage,
  hasSignedInUser,
  requestBodyWithStatus,
} from '../messageHelpers.jsx'
import { RequestProfileDashboard } from '../../requests/components/RequestProfileDashboard.jsx'

function DaySeparator({ label }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-slate-200/80" />
      <span className="rounded-full bg-white px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-graphite/45 shadow-sm ring-1 ring-slate-200/70">{label}</span>
      <span className="h-px flex-1 bg-slate-200/80" />
    </div>
  )
}

/**
  * The other person in a conversation, resolved from their own participant
  * record -- `avatar_url` is their uploaded picture and `role` is their role,
  * both already on the payload the conversation list returns. So Devipriya
  * shows Devipriya whether she is reading the thread or Jogindar is.
  */
function Avatar({ participant, name, className = '' }) {
  return <img src={userAvatarSrc(participant)} alt={name || ''} className={`shrink-0 rounded-full object-cover ${className}`} />
}

export default function MessageThread() {
  const { requireCompleteProfile } = useProfileGate()
  const { user } = useSelector((state) => state.auth)
  const { t, td } = useLanguage()
  const [conversationList, setConversationList] = useState([])
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [messageList, setMessageList] = useState([])
  const [messageBody, setMessageBody] = useState('')
  const [messageSearch, setMessageSearch] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [typingNotice, setTypingNotice] = useState('')
  const [quotationInputs, setQuotationInputs] = useState({})
  const [quotationStatus, setQuotationStatus] = useState({})
  const [requestActionStates, setRequestActionStates] = useState({})
  const [assignmentActionStates, setAssignmentActionStates] = useState({})
  const [profileDashboard, setProfileDashboard] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [participantOnline, setParticipantOnline] = useState(false)
  const socketRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const pingTimerRef = useRef(null)
  const scrollRef = useRef(null)
  const lastMessageIdRef = useRef(null)

  const appendSocketMessage = (message) => {
    setMessageList((items) => {
      if (items.some((item) => item.id === message.id)) return items
      return [...items, message]
    })
  }

  // An edit arrives without the viewer's own flags (is_mine); keep them.
  const replaceMessage = (message) => {
    setMessageList((items) => items.map((item) => (item.id === message.id ? { ...item, ...message, is_mine: item.is_mine } : item)))
  }

  const saveEdit = async (event) => {
    event.preventDefault()
    if (!editingMessage?.body.trim()) return
    const updated = await editConversationMessage(editingMessage.id, editingMessage.body)
    replaceMessage(updated)
    setEditingMessage(null)
    loadConversations()
  }

  const loadConversations = async () => {
    const items = await fetchConversations()
    setConversationList(items)
    setSelectedConversation((currentConversation) => {
      if (currentConversation) {
        return items.find((item) => item.id === currentConversation.id) || currentConversation
      }
      return items[0] || null
    })
  }

  useEffect(() => {
    loadConversations()
    const pollingTimer = window.setInterval(loadConversations, 15000)
    return () => window.clearInterval(pollingTimer)
  }, [])

  const loadMessages = async (options = {}) => {
    if (!selectedConversation) return
    const items = await fetchConversationMessages(selectedConversation.id, options)
    setMessageList(options.before_id ? [...items, ...messageList] : items)
    loadConversations()
  }

  useEffect(() => {
    setParticipantOnline(Boolean(selectedConversation?.participant?.online))
  }, [selectedConversation?.id, selectedConversation?.participant?.online])

  useEffect(() => {
    if (!selectedConversation) return undefined
    setEditingMessage(null)
    loadMessages({ search: messageSearch })
    if (!hasSignedInUser()) return undefined

    let closedByEffect = false
    const connectSocket = () => {
      const socket = new WebSocket(websocketUrl(`/messages/ws/${selectedConversation.id}`))
      socketRef.current = socket
      socket.onopen = () => {
        window.clearInterval(pingTimerRef.current)
        pingTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event: 'ping' }))
        }, 25000)
      }
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data)
        if (payload.event === 'connected' && Array.isArray(payload.messages)) {
          // The backlog is the latest messages, unfiltered; while a search is
          // active the list holds its results, which the backlog must not replace.
          if (!messageSearch) setMessageList(payload.messages)
          socket.send(JSON.stringify({ event: 'read' }))
          loadConversations()
        }
        if (payload.event === 'message') {
          appendSocketMessage(payload.message)
          if (!payload.message?.is_mine) socket.send(JSON.stringify({ event: 'read' }))
          loadConversations()
        }
        if (payload.event === 'typing') {
          setTypingNotice(t('dash.msg.typing'))
          window.setTimeout(() => setTypingNotice(''), 1800)
        }
        if (payload.event === 'read') {
          setMessageList((items) => items.map((item) => (item.is_mine ? { ...item, read: true, delivered: true } : item)))
        }
        if (payload.event === 'delivered') {
          setMessageList((items) => items.map((item) => (item.is_mine ? { ...item, delivered: true } : item)))
        }
        if (payload.event === 'edit' && payload.message) {
          replaceMessage(payload.message)
          loadConversations()
        }
        if (payload.event === 'online') setParticipantOnline(true)
        if (payload.event === 'offline') setParticipantOnline(false)
      }
      socket.onclose = () => {
        window.clearInterval(pingTimerRef.current)
        if (!closedByEffect) {
          reconnectTimerRef.current = window.setTimeout(connectSocket, 2000)
        }
      }
    }

    connectSocket()
    return () => {
      closedByEffect = true
      window.clearTimeout(reconnectTimerRef.current)
      window.clearInterval(pingTimerRef.current)
      socketRef.current?.close()
    }
  }, [selectedConversation?.id, messageSearch])

  useEffect(() => {
    if (selectedConversation?.id) lastMessageIdRef.current = null
    const lastMessage = messageList[messageList.length - 1]
    const lastMessageId = lastMessage?.id
    if (lastMessageId && lastMessageId !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessageId
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messageList, selectedConversation?.id, typingNotice])

  const sendMessage = async (event) => {
    event.preventDefault()
    if (!messageBody.trim() || !selectedConversation) return
    const outgoingMessage = { event: 'message', body: messageBody, message_type: 'TEXT' }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(outgoingMessage))
    } else {
      await sendConversationMessage({ conversation_id: selectedConversation.id, body: messageBody, message_type: 'TEXT' })
      await loadMessages({ search: messageSearch })
    }
    setMessageBody('')
  }

  const uploadAttachment = async (file) => {
    if (!file || !selectedConversation) return
    setUploadMessage(t('dash.msg.uploadingAttachment'))
    const uploadedFile = await uploadLocalFile(file)
    // The upload's address (/files/<id>) has no extension, so the type comes
    // from the file itself; the address is only a fallback.
    const type = String(file.type || '').startsWith('image/') ? 'IMAGE' : messageAttachmentType(uploadedFile.url)
    await sendConversationMessage({
      conversation_id: selectedConversation.id,
      body: type === 'IMAGE' ? t('dash.msg.photoAttached') : file.name,
      attachment_url: uploadedFile.url,
      message_type: type,
    })
    setUploadMessage('')
    await loadMessages({ search: messageSearch })
  }

  const loadOlderMessages = async () => {
    if (!messageList.length) return
    await loadMessages({ search: messageSearch, before_id: messageList[0].id })
  }

  const acceptRequestFromMessage = async (event, details) => {
    event.preventDefault()
    const needsQuote = details.request_type === 'OWNER_TO_CONTRACTOR'
    const amount = Number(quotationInputs[details.request_id] || 0)
    if (needsQuote && (!amount || amount <= 0)) {
      setQuotationStatus((items) => ({ ...items, [details.request_id]: t('dash.msg.validQuotation') }))
      return
    }
    if (needsQuote && Number(details.budget || 0) > 0 && amount > Number(details.budget)) {
      setQuotationStatus((items) => ({ ...items, [details.request_id]: t('dash.msg.quoteWithinBudget') }))
      return
    }
    // Accepting from a chat card is the same action as accepting on the
    // dashboard, so it asks for Complete Profile the same way. The request and
    // the quotation typed so far go with it and are sent as they were.
    if (requireCompleteProfile('acceptRequestFromMessage', { details, amount })) return
    await submitAcceptFromMessage(details, amount)
  }

  const submitAcceptFromMessage = async (details, amount) => {
    const needsQuote = details.request_type === 'OWNER_TO_CONTRACTOR'
    setQuotationStatus((items) => ({ ...items, [details.request_id]: needsQuote ? t('dash.msg.sendingQuotation') : t('dash.msg.acceptingRequest') }))
    try {
      await acceptProjectRequest(details.request_id, needsQuote ? amount : null)
      setRequestActionStates((items) => ({ ...items, [details.request_id]: 'accepted' }))
      setMessageList((items) => items.map((message) => requestBodyWithStatus(message, details.request_id, 'accepted')))
      setQuotationStatus((items) => ({ ...items, [details.request_id]: needsQuote ? t('dash.msg.quotationSent') : t('dash.msg.requestAccepted') }))
      loadConversations()
    } catch (error) {
      setQuotationStatus((items) => ({ ...items, [details.request_id]: error.response?.data?.detail || t('dash.msg.unableQuotation') }))
    }
  }

  useResumeGatedAction({
    acceptRequestFromMessage: ({ details, amount }) => details && submitAcceptFromMessage(details, amount),
  })

  const rejectRequestFromMessage = async (details) => {
    setQuotationStatus((items) => ({ ...items, [details.request_id]: t('dash.msg.rejectingRequest') }))
    try {
      await rejectProjectRequest(details.request_id)
      setRequestActionStates((items) => ({ ...items, [details.request_id]: 'rejected' }))
      setMessageList((items) => items.map((message) => requestBodyWithStatus(message, details.request_id, 'rejected')))
      setQuotationStatus((items) => ({ ...items, [details.request_id]: t('dash.msg.requestRejected') }))
      loadConversations()
    } catch (error) {
      setQuotationStatus((items) => ({ ...items, [details.request_id]: error.response?.data?.detail || t('dash.msg.unableReject') }))
    }
  }

  const confirmAssignmentFromMessage = async (details) => {
    setAssignmentActionStates((items) => ({ ...items, [details.request_id]: t('dash.msg.acceptingAssignment') }))
    try {
      await confirmProjectAssignment(details.request_id)
      setAssignmentActionStates((items) => ({ ...items, [details.request_id]: 'accepted' }))
      setMessageList((items) => items.map((message) => assignmentBodyWithStatus(message, details.request_id, 'accepted')))
      loadConversations()
    } catch (error) {
      setAssignmentActionStates((items) => ({ ...items, [details.request_id]: error.response?.data?.detail || t('dash.msg.unableAcceptAssignment') }))
    }
  }

  const selectedParticipant = selectedConversation?.participant
  // The other person's own name, as they entered it.
  const filteredTitle = useMemo(() => td(selectedParticipant?.primary_name || selectedConversation?.title) || t('dash.common.messages'), [selectedConversation, selectedParticipant, t, td])

  const groupedMessages = useMemo(() => {
    const groups = []
    for (const message of messageList) {
      const label = dayLabel(message.created_at, t)
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, messages: [] })
      groups[groups.length - 1].messages.push(message)
    }
    return groups
  }, [messageList, t])

  // The builder <-> owner request this conversation is about (the latest one),
  // so workflow events posted as text can link to it.
  const conversationRequest = useMemo(() => {
    for (let index = messageList.length - 1; index >= 0; index -= 1) {
      const details = parseRequestMessage(messageList[index]) || parseAssignmentMessage(messageList[index])
      if (details?.request_id && (details.project_id || details.request_type)) return details
    }
    return null
  }, [messageList])
  const conversationRequestLink = conversationRequest
    ? requestLinkFor({ ...conversationRequest, request_type: conversationRequest.request_type || 'CONTRACTOR_TO_OWNER' }, user?.role)
    : null

  const totalUnread = useMemo(() => conversationList.reduce((sum, conversation) => sum + Number(conversation.unread_count || 0), 0), [conversationList])

  return (
    <>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <DashboardCard
        title={t('dash.msg.chats')}
        action={totalUnread > 0 ? (
          <span className="rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm">{totalUnread} {t('dash.msg.new')}</span>
        ) : undefined}
      >
        <div className="-mr-2 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          {conversationList.map((conversation) => {
            const participant = conversation.participant || {}
            const active = selectedConversation?.id === conversation.id
            return (
              <button
                key={conversation.id}
                onClick={() => setSelectedConversation(conversation)}
                className={`group w-full rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${
                  active
                    ? 'border-brand-200 bg-gradient-to-br from-brand-50 to-white shadow-[0_10px_28px_-16px_rgba(26,80,56,0.55)]'
                    : 'border-transparent bg-white dash-gold-hover'
                }`}
              >
                <div className="flex gap-3">
                  <div className="relative shrink-0">
                    <Avatar participant={participant} name={participant.primary_name || conversation.title} className="h-11 w-11" />
                    {conversation.unread_count > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-brand-600 px-1 text-[10px] font-extrabold text-white">{conversation.unread_count}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-graphite">{td(participant.primary_name || conversation.title)}</p>
                        <p className="truncate text-[11px] font-semibold text-graphite/50">{td(participant.secondary_name) || t('dash.msg.crewnbuildChat')}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold ${conversation.unread_count > 0 ? 'text-brand-700' : 'text-graphite/40'}`}>{conversation.latest_message_time}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {/* The last thing either of them typed. */}
                      <p className={`truncate text-xs ${conversation.unread_count > 0 ? 'font-bold text-graphite/75' : 'text-graphite/55'}`}>{td(conversation.latest_message) || t('dash.msg.noMessagesYet')}</p>
                      {active && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600 opacity-0 transition-opacity group-hover:opacity-60" />}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
          {!conversationList.length && <EmptyState title={t('dash.msg.noConversations')} message={t('dash.msg.noConversationsSub')} />}
        </div>
      </DashboardCard>

      <DashboardCard title="">
        {!selectedConversation ? (
          <EmptyState title={t('dash.msg.selectConversation')} message={t('dash.msg.selectConversationSub')} />
        ) : (
          <div className="flex h-[calc(100vh-240px)] min-h-[540px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="relative shrink-0">
                <Avatar participant={selectedParticipant} name={filteredTitle} className="h-11 w-11" />
                {participantOnline && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-graphite">{filteredTitle}</p>
                <p className="truncate text-[11px] font-semibold text-graphite/50">{typingNotice ? <span className="font-bold text-brand-600">{t('dash.msg.typing')}</span> : (td(selectedParticipant?.secondary_name) || (participantOnline ? t('dash.msg.online') : ''))}</p>
              </div>
              <div className="hidden min-w-[220px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition focus-within:border-brand-300 focus-within:bg-white md:flex">
                <Search className="h-4 w-4 text-brand-700" />
                <input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder={t('dash.msg.searchMessages')} className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50/80 p-3 sm:p-4">
              {messageList.length > 0 && (
                <div className="flex justify-center">
                  <button onClick={loadOlderMessages} className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[11px] font-bold text-graphite/60 shadow-sm transition hover:border-brand-200 hover:text-brand-700">
                    ↥ {t('dash.msg.loadOlder')}
                  </button>
                </div>
              )}
              {groupedMessages.map((group) => (
                <div key={group.label} className="space-y-3">
                  <DaySeparator label={group.label} />
                  {group.messages.map((message) => {
                    const requestDetails = parseRequestMessage(message)
                    const assignmentDetails = parseAssignmentMessage(message)
                    const actionState = requestDetails ? requestActionStates[requestDetails.request_id] || requestDetails.status : ''
                    const canAct = Boolean(requestDetails && !message.is_mine && requestDetails.receiver_role === user?.role && !['accepted', 'rejected', 'withdrawn'].includes(actionState))
                    const canConfirmAssignment = Boolean(
                      assignmentDetails
                      && user?.role === 'BUILDER'
                      && !message.is_mine
                      && assignmentDetails.status !== 'accepted'
                      && assignmentActionStates[assignmentDetails.request_id] !== 'accepted'
                    )
                    const canViewContact = Boolean(actionState === 'accepted')
                    const needsQuote = requestDetails?.request_type === 'OWNER_TO_CONTRACTOR'
                    const chatEvent = !requestDetails && !assignmentDetails ? parseChatEvent(message.body) : null
                    // Workflow messages are small cards on the sender's side;
                    // everything else is an ordinary chat bubble.
                    const isRich = Boolean(requestDetails || assignmentDetails || chatEvent)
                    return (
                      <div key={message.id} className={`flex items-end gap-2 ${message.is_mine ? 'flex-row-reverse' : 'justify-start'}`}>
                        {!message.is_mine && !isRich && (
                          <Avatar participant={selectedParticipant} name={filteredTitle} className="mb-1 h-7 w-7" />
                        )}
                        <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[70%] ${
                          isRich
                            ? 'w-full max-w-[88%] bg-transparent p-0 shadow-none sm:max-w-sm'
                            : message.is_mine
                              ? 'rounded-br-md bg-gradient-to-br from-brand-700 to-brand-600 text-white'
                              : 'rounded-bl-md border border-slate-200 bg-white text-graphite'
                        }`}>
                          {message.attachment_url && message.messageType === 'IMAGE' && <img src={imageUrl(message.attachment_url)} alt="" className="mb-2 max-h-56 rounded-xl object-cover" />}
                          {message.attachment_url && message.messageType !== 'IMAGE' && (
                            <a href={imageUrl(message.attachment_url)} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 font-bold hover:bg-black/10">
                              <FileText className="h-4 w-4" /> {t('dash.msg.openAttachment')}
                            </a>
                          )}
                          {requestDetails ? (
                            <RequestMessageCard
                              details={requestDetails}
                              isMine={message.is_mine}
                              viewerRole={user?.role}
                              canAct={canAct}
                              needsQuote={needsQuote}
                              actionState={actionState}
                              quoteValue={quotationInputs[requestDetails.request_id] || ''}
                              quoteStatus={quotationStatus[requestDetails.request_id] || ''}
                              onQuoteChange={(event) => setQuotationInputs((items) => ({ ...items, [requestDetails.request_id]: event.target.value }))}
                              onAccept={(event) => acceptRequestFromMessage(event, requestDetails)}
                              onReject={() => rejectRequestFromMessage(requestDetails)}
                              onViewProfile={() => setProfileDashboard({ details: requestDetails, participant: selectedParticipant, canViewContact })}
                            />
                          ) : assignmentDetails ? (
                            <AssignmentMessageCard
                              details={assignmentDetails}
                              viewerRole={user?.role}
                              canConfirm={canConfirmAssignment}
                              actionStatus={assignmentActionStates[assignmentDetails.request_id] || assignmentDetails.status}
                              onConfirm={() => confirmAssignmentFromMessage(assignmentDetails)}
                            />
                          ) : chatEvent ? (
                            <ChatEventCard event={chatEvent} link={conversationRequestLink} />
                          ) : editingMessage?.id === message.id ? (
                            <form onSubmit={saveEdit} className="flex flex-col gap-2">
                              <input
                                autoFocus
                                value={editingMessage.body}
                                onChange={(event) => setEditingMessage({ ...editingMessage, body: event.target.value })}
                                className="min-w-[12rem] rounded-lg bg-white px-3 py-1.5 text-sm text-graphite outline-none"
                              />
                              <div className="flex justify-end gap-2 text-[11px] font-bold">
                                <button type="button" onClick={() => setEditingMessage(null)} className="text-white/80 hover:text-white">{t('dash.common.cancel')}</button>
                                <button type="submit" disabled={!editingMessage.body.trim()} className="text-white hover:underline disabled:opacity-50">{t('dash.common.save')}</button>
                              </div>
                            </form>
                          ) : (
                            /* What the other person typed. Nothing is stored
                               or sent differently; only what is painted. */
                            <p className="whitespace-pre-wrap break-words">{td(message.body)}</p>
                          )}
                          {isRich ? (
                            <p className={`mt-1 text-[10px] text-graphite/40 ${message.is_mine ? 'text-right' : 'text-left'}`}>{formatMessageTime(message.created_at)}</p>
                          ) : (
                            <p className={`mt-1 text-right text-[10px] ${message.is_mine ? 'text-white/70' : 'text-graphite/40'}`}>
                              {message.is_mine && !message.attachment_url && (message.messageType || message.message_type) === 'TEXT' && editingMessage?.id !== message.id && (
                                <button type="button" onClick={() => setEditingMessage({ id: message.id, body: message.body })} className="mr-2 font-bold underline-offset-2 hover:underline">{t('dash.common.edit')}</button>
                              )}
                              {formatMessageTime(message.created_at)}
                              {message.edited ? ` · ${t('dash.msg.edited')}` : ''}
                              {message.is_mine ? ` · ${message.read ? t('dash.msg.read') : message.delivered ? t('dash.msg.delivered') : t('dash.msg.sent')}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
              {!messageList.length && <EmptyState title={t('dash.msg.noMessages')} message={messageSearch ? t('dash.msg.noMessagesSearch') : t('dash.msg.startConversation')} />}
            </div>

            <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
              <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100">
                <ImagePlus className="h-5 w-5" />
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => uploadAttachment(event.target.files?.[0]).catch(() => setUploadMessage(t('dash.msg.uploadFailed')))} className="sr-only" />
              </label>
              <input
                value={messageBody}
                onFocus={() => socketRef.current?.send(JSON.stringify({ event: 'typing' }))}
                onChange={(event) => setMessageBody(event.target.value)}
                placeholder={uploadMessage || t('dash.msg.typeMessage')}
                className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
              <button
                disabled={!messageBody.trim()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-500 text-white shadow-[0_8px_20px_-10px_rgba(26,80,56,0.8)] transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </DashboardCard>
    </div>
    {profileDashboard && (
      <RequestProfileDashboard
        details={profileDashboard.details}
        participant={profileDashboard.participant}
        canViewContact={profileDashboard.canViewContact}
        onClose={() => setProfileDashboard(null)}
      />
    )}
    </>
  )
}
