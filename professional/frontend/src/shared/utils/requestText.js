// The server writes request notices in English with the request's type code in them
// ("SUPPLIER_TO_CONTRACTOR: Yamini sent a request."). The code is taken out for display;
// the stored text is unchanged. Tidy first, then translate (td).
const SENDER_WORDS = {
  OWNER: 'home owner',
  CONTRACTOR: 'builder',
  BUILDER: 'builder',
  SUPPLIER: 'supplier',
  ENGINEER: 'site engineer',
}

const SENT_REQUEST = /^([A-Z_]+)_TO_[A-Z_]+: (.+?) sent a request/
const LEADING_CODE = /^[A-Z_]+_TO_[A-Z_]+: /
const CODE_BEFORE_REQUEST = /[A-Z_]+_TO_[A-Z_]+ request/

export function plainRequestText(text) {
  return String(text || '')
    .replace(SENT_REQUEST, (_, sender, name) => {
      const word = SENDER_WORDS[sender]
      return `${name}${word ? ` (${word})` : ''} sent you a request`
    })
    .replace(LEADING_CODE, '')
    .replace(CODE_BEFORE_REQUEST, 'request')
}

// The words the server puts before a chat's workflow notices ("REQUEST: ...").
const NOTICE_WORD = /^(?:REQUEST|REQUEST ACCEPTED|QUOTATION|QUOTATION ACCEPTED|COUNTER-OFFER|OFFER ACCEPTED|OFFER REJECTED|ASSIGNMENT|ASSIGNMENT CANCELLED|ASSIGNMENT DECLINED|BUILDER CONFIRMED|CONFIRMATION CANCELLED|CONFIRMATION REQUESTED|CONFIRMATION WITHDRAWN|NEGOTIATION CANCELLED|NEGOTIATION DECLINED|PROJECT ASSIGNED|PROJECT UNASSIGNED): /

/** A chat list's last message without the notice word, for display. */
export function plainChatPreview(text) {
  return String(text || '').replace(NOTICE_WORD, '')
}
