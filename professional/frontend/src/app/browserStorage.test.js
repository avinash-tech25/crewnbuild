import { describe, expect, it } from 'vitest'
import { FEEDBACK_STORAGE_KEY } from '../features/support/feedbackStorage.js'
import { logoutUser } from '../shared/auth/authSlice.js'
import { createAppStore } from './store.js'
// The script index.html runs before the app.
import startScript from '../../public/theme-preference.js?raw'

const runStartScript = () => new Function(startScript)()

describe('settings saved by the old app', () => {
  it('are carried over once, so the visitor keeps theme, language and country', () => {
    localStorage.setItem('octabuild_theme_preference', 'dark')
    localStorage.setItem('octabuild_language', 'hi')
    localStorage.setItem('octabuild_language_manual', '1')
    localStorage.setItem('octabuild_country', 'IN')
    document.documentElement.classList.remove('dark')

    runStartScript()

    expect(localStorage.getItem('crewnbuild_theme_preference')).toBe('dark')
    expect(localStorage.getItem('crewnbuild_language')).toBe('hi')
    expect(localStorage.getItem('crewnbuild_language_manual')).toBe('1')
    expect(localStorage.getItem('crewnbuild_country')).toBe('IN')
    expect(localStorage.getItem('octabuild_language')).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('never overwrite a choice made in the new app', () => {
    localStorage.setItem('crewnbuild_language', 'en')
    localStorage.setItem('octabuild_language', 'hi')
    runStartScript()
    expect(localStorage.getItem('crewnbuild_language')).toBe('en')
    expect(localStorage.getItem('octabuild_language')).toBeNull()
  })

  it('leave the light theme alone when nothing was saved', () => {
    document.documentElement.classList.remove('dark')
    runStartScript()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.length).toBe(0)
  })
})

describe('sign-out', () => {
  it('forgets the feedback contact details kept in the browser', () => {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([{ name: 'Asha', email: 'asha@example.in' }]))
    localStorage.setItem('octabuild_feedback', '[]')
    localStorage.setItem('crewnbuild_language', 'hi')
    createAppStore().dispatch(logoutUser())
    expect(localStorage.getItem(FEEDBACK_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('octabuild_feedback')).toBeNull()
    expect(localStorage.getItem('crewnbuild_language')).toBe('hi')
  })
})
