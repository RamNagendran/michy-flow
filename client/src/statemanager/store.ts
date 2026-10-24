import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE, type PersistedState } from 'redux-persist'
import authReducer from './slices/authSlice'
import uiReducer from './slices/uiSlice'
import { localStorageAdapter } from './storage'

/** Bump this whenever a persisted slice changes shape. Old saved state is then discarded. */
export const REDUX_VERSION = 2

const rootReducer = combineReducers({
  auth: authReducer,
  ui: uiReducer,
})

const persistedReducer = persistReducer(
  {
    key: 'michy-flow',
    version: REDUX_VERSION,
    storage: localStorageAdapter,
    whitelist: ['auth', 'ui'],
    migrate: (state: PersistedState) =>
      Promise.resolve(state?._persist?.version === REDUX_VERSION ? state : undefined),
  },
  rootReducer,
)

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefault) =>
    getDefault({ serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] } }),
})

export const persistor = persistStore(store)

export type RootState = ReturnType<typeof rootReducer>
export type AppDispatch = typeof store.dispatch
