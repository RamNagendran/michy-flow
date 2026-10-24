import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { AuthUser, TokenResponse } from '../../types/auth'

export interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: AuthUser | null
}

const initialState: AuthState = { accessToken: null, refreshToken: null, user: null }

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionStarted(state, { payload }: PayloadAction<TokenResponse>) {
      state.accessToken = payload.access_token
      state.refreshToken = payload.refresh_token
      state.user = payload.user
    },
    userLoaded(state, { payload }: PayloadAction<AuthUser>) {
      state.user = payload
    },
    loggedOut() {
      return initialState
    },
  },
})

export const { sessionStarted, userLoaded, loggedOut } = authSlice.actions
export default authSlice.reducer
