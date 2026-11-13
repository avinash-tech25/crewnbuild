/**
 * The Crew&Build Account Deletion Policy, as approved by the business, shown on
 * the public /delete-account page and in the Delete Account form in Profile
 * Settings (DeletionPolicy.jsx renders it). One copy, so the two never say
 * different things. Change the wording only with the business's approval.
 *
 * Each section has a title and any of: `intro`, `items` ({ label, text }, the
 * label in bold), `paragraphs` (strings, or arrays whose { strong } parts are
 * bold), `outro`, `quote`.
 */

// Used only until the server's own list (GET /account/deletion-form) arrives.
export const FALLBACK_ROLES = [
  { value: 'OWNER', label: 'House Owner' },
  { value: 'BUILDER', label: 'Builder' },
  { value: 'ENGINEER', label: 'Site Engineer / Engineer' },
  { value: 'STORE_MANAGER', label: 'Store Manager' },
  { value: 'SUPPLIER', label: 'Supplier' },
]

// The statement the confirmation checkbox stands for (the English text of
// account.deleteAgree).
export const CONFIRMATION_STATEMENT = 'I understand that deleting my account is permanent and cannot be undone. I request the permanent deletion of my Crew&Build account and associated personal data, subject to the limited retention described in this policy.'

export const POLICY_TITLE = 'Crew&Build – Account Deletion Policy'

export const POLICY_SECTIONS = [
  {
    id: 'deleted',
    title: 'What is deleted',
    intro: 'When you confirm deletion of your Crew&Build account, we delete your account and associated personal information, including:',
    items: [
      { label: 'Account and sign-in information', text: 'Your name, registered email address, mobile number, password, active sign-in sessions and linked sign-in credentials used to access Crew&Build. Your Google or Microsoft account itself is not deleted.' },
      { label: 'Profile information', text: 'Your address, location and personal profile details associated with your role as an owner, builder, site engineer, store manager or supplier.' },
      { label: 'Personal files', text: 'Your profile photo, company or store logo, personal documents and portfolio images stored on your profile.' },
      { label: 'Account activity', text: 'Your personal notifications, messages, reviews, estimates and requests, subject to preserving records that other users are entitled to retain or that must be kept for legitimate legal or business reasons.' },
      { label: 'Role-specific information', text: "Your supplier product listings and store manager inventory, where those records are not required to be retained for another user's transactions or other legitimate purposes." },
      { label: 'Projects', text: 'Projects and records belonging solely to you will be deleted, subject to any required legal or financial retention. Shared project records belonging to other users will be preserved where necessary, with your account access and personal association removed where possible.' },
    ],
  },
  {
    id: 'retained',
    title: 'What is retained and why',
    intro: "Some information may need to be retained for legitimate purposes, including legal compliance, accounting, payment disputes, fraud prevention and protecting other users' records.",
    items: [
      { label: 'Financial and transaction records', text: 'Payment records, subscription purchases, receipts, invoices and orders may be retained where required by applicable law or for legitimate accounting, tax, dispute-resolution or fraud-prevention purposes. Access will be restricted, and records will be retained only for the applicable retention period.' },
      { label: "Other users' information and shared records", text: "Information belonging to other users will remain available to those users. For example, a project owner's records, files uploaded to another user's project and messages sent by other users may be preserved where necessary. Your access to these records will end when your account is deleted." },
      { label: 'Account deletion audit record', text: 'We retain a limited record to document the deletion and prevent misuse of the deletion process. This may include your name, role, registered mobile number, registered email address, account joining date, deletion date and the reason category you selected. This record is accessible only to authorized administrators and retained only for the applicable documented retention period.' },
    ],
    outro: 'Information retained for these purposes will not be used to restore your deleted account.',
  },
  {
    id: 'timing',
    title: 'When deletion happens',
    paragraphs: [
      'Your Crew&Build account is permanently deleted immediately after you confirm. No administrator approval or manual processing is involved. You will be signed out, your active sessions will be invalidated, and you will no longer be able to sign in using that account.',
      ['Some records may remain for the limited purposes described in the ', { strong: 'What is retained and why' }, ' section.'],
    ],
  },
  {
    id: 'before',
    title: 'Before deleting your account',
    items: [
      { label: 'Permanent deletion', text: 'Account deletion is permanent. Your account and deleted personal information cannot be recovered.' },
      { label: 'Subscriptions and payments', text: 'Your builder subscription access will end when your account is deleted. Any refund or outstanding payment will be handled according to the applicable subscription terms and law. If your subscription is billed through an external payment provider, you may need to cancel its recurring payment separately.' },
      { label: 'Shared projects', text: 'Records belonging to other users will be protected. Where a project needs ownership transfer or another arrangement before deletion, the necessary steps will be explained to you.' },
      { label: 'Pending transactions', text: 'Complete or cancel pending orders, requests or payments with other users where possible before deleting your account.' },
      { label: 'Your records', text: 'Download or save anything you need, such as invoices, receipts or project details, before confirming deletion.' },
    ],
  },
  {
    id: 'confirmation',
    title: 'Your confirmation',
    paragraphs: [
      ['By verifying your registered email address, selecting the confirmation checkbox, typing ', { strong: 'DELETE' }, ' and clicking ', { strong: 'Delete Account' }, ', you confirm:'],
    ],
    quote: CONFIRMATION_STATEMENT,
  },
]
