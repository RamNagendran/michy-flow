import axios, { type InternalAxiosRequestConfig } from 'axios'
import { config } from '../utils/config'
import { API_ROUTES, NO_REFRESH_ROUTES } from '../utils/apiRoutes'
import { sessionStarted } from '../statemanager/slices/authSlice'
import { store } from '../statemanager/store'
import type { TokenResponse } from '../types/auth'
import { toApiError } from './apiError'
import { endSession } from './session'

/** The app's single axios instance. */
// `indexes: null` sends arrays as ?type=a&type=b, the form FastAPI reads as a list.
export const api = axios.create({ baseURL: config.backendApi, timeout: 30_000, paramsSerializer: { indexes: null } })

api.interceptors.request.use((req) => {
  const token = store.getState().auth.accessToken
  if (token) req.headers.Authorization = `Bearer ${token}`
  return req
})

// Shared so that several requests failing with 401 at once trigger only one refresh.
let refreshing: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = store.getState().auth.refreshToken
  if (!refreshToken) throw new Error('No refresh token')
  // Plain axios, not `api`, so this call doesn't loop back through the interceptors.
  const { data } = await axios.post<TokenResponse>(config.backendApi + API_ROUTES.auth.refresh, {
    refresh_token: refreshToken,
  })
  store.dispatch(sessionStarted(data))
  return data.access_token
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean }

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as RetriableConfig | undefined
    const shouldRefresh =
      error.response?.status === 401 && original && !original._retried && !NO_REFRESH_ROUTES.includes(original.url ?? '')

    if (shouldRefresh) {
      original._retried = true
      try {
        refreshing ??= refreshAccessToken().finally(() => {
          refreshing = null
        })
        const token = await refreshing
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      } catch {
        endSession()
      }
    }
    return Promise.reject(toApiError(error))
  },
)
