import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { AssistantError, clearHistory, fetchHistory, fetchWelcome, streamChat, voteOnAnswer } from './assistantApi.js'
import { Helmet } from './Helmet.jsx'
import { DisclaimerNote } from '../../shared/ui/DisclaimerNote.jsx'

/**
 * Viswa's chat window, ported from Kuwait-Version's ChatWidget (same look: the green
 * helmet, a 380x540 panel bottom right, full screen on a phone, chips and buttons).
 *
 * - A House Owner's chat is kept on the server (30 days; Clear chat removes it). A
 *   visitor's chat lives only in this browser tab (sessionStorage) and its last turns go
 *   with each question; the server never stores it.
 * - The answer streams in as it is written; screen readers hear only the finished answer.
 * - Text only: answers are never rendered as HTML. Buttons open app pages only.
 * - A dialog: focus moves into it, Tab stays inside, Escape closes it.
 */
const GUEST_STORAGE_KEY = 'crewnbuild_viswa_guest_chat'
const GUEST_TURNS_SENT = 10

const readGuestChat = () => {
  try {
    return JSON.parse(sessionStorage.getItem(GUEST_STORAGE_KEY)) || null
  } catch {
    return null
  }
}
const saveGuestChat = (messages) => {
  try {
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // Storage blocked (private mode): the chat still works for this page.
  }
}

const isArabic = (text) => (text.match(/[؀-ۿ]/g) || []).length > (text.match(/[A-Za-z]/g) || []).length

/** Bold, simple lists and [label](/page) links (shown as their label), as React text only. */
function Answer({ text }) {
  const blocks = []
  let list = null
  const inline = (line) =>
    line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .split(/\*\*(.+?)\*\*/g)
      .map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>))
  String(text || '').split('\n').forEach((raw, index) => {
    const line = raw.trim()
    const item = line.match(/^(?:\d+[.)]|[-•*])\s+(.*)/)
    if (item) {
      if (!list) {
        list = { ordered: /^\d/.test(line), items: [] }
        blocks.push(list)
      }
      list.items.push(<li key={index}>{inline(item[1])}</li>)
      return
    }
    list = null
    if (line) blocks.push(<p key={index}>{inline(line)}</p>)
  })
  return blocks.map((block, index) =>
    block.items ? (
      block.ordered ? <ol key={index} className="ms-5 list-decimal space-y-1">{block.items}</ol> : <ul key={index} className="ms-5 list-disc space-y-1">{block.items}</ul>
    ) : (
      block
    ),
  )
}

const fromWelcome = (welcome) => ({ role: 'assistant', text: welcome.message || '', buttons: [], suggestions: welcome.suggestions || [] })
const fromStored = (row) => ({
  role: row.role,
  text: row.text,
  buttons: row.buttons || [],
  suggestions: [],
  messageId: row.role === 'assistant' ? row.id : undefined,
  vote: row.vote || null,
})

export default function ChatPanel({ open, user, onClose }) {
  const { t, language } = useLanguage()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const signedIn = Boolean(user)
  const [messages, setMessages] = useState(() => (signedIn ? [] : readGuestChat() || []))
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const panelRef = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  const update = useCallback(
    (next) =>
      setMessages((current) => {
        const value = typeof next === 'function' ? next(current) : next
        if (!signedIn) saveGuestChat(value)
        return value
      }),
    [signedIn],
  )

  const greet = useCallback(async () => {
    try {
      update([fromWelcome(await fetchWelcome())])
    } catch {
      update([{ role: 'assistant', text: t('assistant.unavailable'), buttons: [], suggestions: [] }])
    }
  }, [t, update])

  // The first time it opens: the stored chat (signed in), else the greeting.
  useEffect(() => {
    if (!open || loaded) return
    setLoaded(true)
    if (signedIn) {
      fetchHistory()
        .then((answer) => {
          const rows = (answer.messages || []).map(fromStored)
          if (rows.length) update(rows)
          else greet()
        })
        .catch(() => greet())
    } else if (!messages.length) {
      greet()
    }
  }, [open, loaded, signedIn, messages.length, greet, update])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight })
  }, [open, messages, busy])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Escape closes; Tab and Shift+Tab stay inside the window.
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return
    const focusable = [...panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]')]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function ask(text) {
    const message = text.trim()
    if (!message || busy) return
    setInput('')
    const earlier = messages.filter((m) => m.text).slice(-GUEST_TURNS_SENT).map((m) => ({ role: m.role, text: m.text }))
    update((current) => [
      ...current.map((m) => ({ ...m, suggestions: [] })),
      { role: 'user', text: message },
      { role: 'assistant', text: '', buttons: [], suggestions: [], streaming: true, question: message },
    ])
    setBusy(true)
    setAnnouncement('')
    const patchLast = (patch) =>
      update((current) => current.map((m, index) => (index === current.length - 1 ? { ...m, ...patch(m) } : m)))
    try {
      const final = await streamChat(
        { message, current_page: pathname, history: signedIn ? [] : earlier },
        { onDelta: (chunk) => patchLast((m) => ({ text: m.text + chunk })), onReset: () => patchLast(() => ({ text: '' })) },
      )
      patchLast(() => ({
        text: final.answer,
        buttons: final.buttons || [],
        suggestions: final.suggestions || [],
        messageId: final.message_id || undefined,
        streaming: false,
      }))
      setAnnouncement(final.answer)
    } catch (error) {
      const text =
        error instanceof AssistantError && error.status === 429
          ? t('assistant.slowDown')
          : error instanceof AssistantError && error.status === 422 && error.message
            ? error.message
            : t('assistant.unavailable')
      patchLast(() => ({ text, streaming: false, suggestions: [message] }))
      setAnnouncement(text)
    } finally {
      setBusy(false)
    }
  }

  function vote(index, value) {
    const message = messages[index]
    if (!message?.messageId) return
    update((current) => current.map((m, i) => (i === index ? { ...m, vote: value } : m)))
    voteOnAnswer(message.messageId, value).catch(() => {})
  }

  async function clearChat() {
    if (signedIn) await clearHistory().catch(() => {})
    else saveGuestChat([])
    update([])
    greet()
  }

  function openPage(path) {
    onClose()
    navigate(path)
  }

  if (!open) return null
  const rtl = language === 'ar'
  const last = messages[messages.length - 1]

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="viswa-title"
      dir={rtl ? 'rtl' : 'ltr'}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-toast flex flex-col overflow-hidden bg-white font-sans text-oc-ink shadow-[0_24px_60px_rgba(23,32,28,0.14)] sm:inset-auto sm:bottom-[104px] sm:end-7 sm:h-[540px] sm:max-h-[calc(100vh-128px)] sm:w-[380px] sm:rounded-[20px] sm:border sm:border-[#e7ece9]"
    >
      <div className="flex items-center gap-3 border-b border-[#e7ece9] px-5 py-4">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-oc-mint">
          <Helmet className="h-6 w-6" stroke="#126b45" />
        </span>
        <div className="min-w-0">
          <h2 id="viswa-title" className="font-display text-base font-bold leading-tight">Viswa</h2>
          <p className="text-xs text-oc-muted">
            <span aria-hidden="true" className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#22a06b] align-middle" />
            {t('assistant.online')}
          </p>
        </div>
        <button type="button" onClick={clearChat} disabled={busy}
          className="ms-auto rounded-full px-2.5 py-1 text-xs font-semibold text-oc-muted hover:bg-[#f4f6f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-oc-green disabled:opacity-40">
          {t('assistant.clear')}
        </button>
        <button type="button" onClick={onClose} aria-label={t('assistant.close')}
          className="grid h-8 w-8 place-items-center rounded-full text-xl text-oc-muted hover:bg-[#f4f6f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-oc-green">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-5" data-testid="viswa-messages">
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div key={index} dir={isArabic(message.text) ? 'rtl' : 'ltr'}
              className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-se-md bg-oc-green px-3.5 py-2.5 text-[14.5px] text-white">
              {message.text}
            </div>
          ) : (
            <div key={index} className="flex max-w-full flex-col gap-2" data-testid="viswa-answer">
              {(message.text || !message.streaming) && (
                <div dir={isArabic(message.text) ? 'rtl' : 'ltr'}
                  className="max-w-[90%] space-y-2 break-words rounded-2xl rounded-ss-md bg-[#f4f6f5] px-3.5 py-2.5 text-[14.5px] leading-relaxed">
                  <Answer text={message.text} />
                </div>
              )}
              {message.buttons?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {message.buttons.map((button) => (
                    <button key={button.path + button.label} type="button" onClick={() => openPage(button.path)}
                      className="rounded-[10px] bg-oc-green px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-oc-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oc-green">
                      {button.label}
                    </button>
                  ))}
                </div>
              )}
              {message.suggestions?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {message.suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => ask(suggestion)} disabled={busy}
                      className="rounded-full border border-[#e7ece9] bg-white px-3.5 py-1.5 text-[13.5px] text-oc-ink transition-colors hover:border-oc-green hover:text-oc-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-oc-green disabled:opacity-40">
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {message.messageId && (
                <div className="flex gap-1 text-sm">
                  {['up', 'down'].map((value) => (
                    <button key={value} type="button" onClick={() => vote(index, value)} aria-pressed={message.vote === value}
                      aria-label={value === 'up' ? t('assistant.goodAnswer') : t('assistant.badAnswer')}
                      className={`rounded-md px-1.5 py-0.5 ${message.vote === value ? 'bg-oc-mint' : 'opacity-60 hover:opacity-100'}`}>
                      <span aria-hidden="true">{value === 'up' ? '👍' : '👎'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && last?.streaming && !last.text && (
          <div className="flex w-14 gap-1 self-start rounded-2xl rounded-ss-md bg-[#f4f6f5] px-3.5 py-3" role="status" aria-label={t('assistant.typing')}>
            {[0, 1, 2].map((dot) => (
              <span key={dot} aria-hidden="true" className="h-1.5 w-1.5 animate-bounce rounded-full bg-oc-muted motion-reduce:animate-none" style={{ animationDelay: `${dot * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>
      {/* Only the finished answer is read out, not every streamed piece. */}
      <p className="sr-only" aria-live="polite" data-testid="viswa-announcement">{announcement}</p>

      <form className="flex flex-none items-center gap-2.5 px-4 pb-4 pt-3" onSubmit={(event) => { event.preventDefault(); ask(input) }}>
        <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)}
          maxLength={1000} placeholder={t('assistant.placeholder')} aria-label={t('assistant.message')} autoComplete="off"
          className="min-w-0 flex-1 rounded-full border border-[#e7ece9] bg-white px-4 py-2.5 text-sm text-oc-ink outline-none placeholder:text-oc-muted focus-visible:ring-2 focus-visible:ring-oc-green" />
        <button type="submit" disabled={busy || !input.trim()} aria-label={t('assistant.send')}
          className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-oc-green text-white disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oc-green">
          <svg className={`h-[18px] w-[18px] ${rtl ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12 H19 M13 6 L19 12 L13 18" />
          </svg>
        </button>
      </form>
      <DisclaimerNote kind="assistant" className="-mt-2 justify-center px-4 pb-2.5" />
    </section>
  )
}
