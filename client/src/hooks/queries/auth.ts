import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import { useAppDispatch, useAppSelector } from '../../statemanager/hooks'
import { sessionStarted } from '../../statemanager/slices/authSlice'
import type { AuthUser, ChangePasswordRequest, LoginRequest, SignupRequest, TokenResponse } from '../../types/auth'
import { markActivity } from '../useIdleLogout'
import { useNotify } from '../useNotify'

export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
}

export function useMe() {
  const token = useAppSelector((s) => s.auth.accessToken)
  return useQuery({
    queryKey: authKeys.me(),
    queryFn: async () => (await api.get<AuthUser>(API_ROUTES.auth.me)).data,
    enabled: !!token,
    staleTime: 5 * 60_000,
  })
}

function useStartSession() {
  const dispatch = useAppDispatch()
  const qc = useQueryClient()
  return (data: TokenResponse) => {
    markActivity()
    dispatch(sessionStarted(data))
    qc.setQueryData(authKeys.me(), data.user)
  }
}

export function useLogin() {
  const startSession = useStartSession()
  return useMutation({
    mutationFn: async (body: LoginRequest) => (await api.post<TokenResponse>(API_ROUTES.auth.login, body)).data,
    onSuccess: startSession,
  })
}

export function useSignup() {
  const startSession = useStartSession()
  return useMutation({
    mutationFn: async (body: SignupRequest) => (await api.post<TokenResponse>(API_ROUTES.auth.signup, body)).data,
    onSuccess: startSession,
  })
}

/** Changing the password signs out every other session; the server returns fresh tokens for this one. */
export function useChangePassword() {
  const notify = useNotify()
  const startSession = useStartSession()
  return useMutation({
    mutationFn: async (body: ChangePasswordRequest) => (await api.post<TokenResponse>(API_ROUTES.auth.changePassword, body)).data,
    onSuccess: (data) => {
      startSession(data)
      notify.success('Password changed')
    },
  })
}
