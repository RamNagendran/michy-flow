import type { Storage } from 'redux-persist'

/**
 * localStorage adapter for redux-persist. Used instead of `redux-persist/lib/storage`, whose
 * CommonJS default export Vite hands over as `{ default }`. Falls back to no persistence when
 * storage is blocked (private mode, disabled site data).
 */
export const localStorageAdapter: Storage = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(localStorage.getItem(key))
    } catch {
      return Promise.resolve(null)
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage full or blocked: state just won't survive a reload */
    }
    return Promise.resolve()
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
    return Promise.resolve()
  },
}
