import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { DateRange, Period } from '../../utils/period'
import { loggedOut } from './authSlice'

/** A company id, or 'all' for the combined view of every company the person can see. */
export type CompanySelection = number | 'all'

export interface UiState {
  /** Keep the full menu open. When false the menu shows icons only and opens on hover. */
  sidebarPinned: boolean
  period: Period
  /** The range picked when period is 'custom'. */
  customRange: DateRange | null
  /** null until the person (or the app, when there is only one) picks a company. */
  activeCompany: CompanySelection | null
}

const initialState: UiState = { sidebarPinned: false, period: 'fy', customRange: null, activeCompany: null }

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    sidebarPinToggled(state) {
      state.sidebarPinned = !state.sidebarPinned
    },
    periodSet(state, { payload }: PayloadAction<Period>) {
      // A custom period needs a range; until one is picked, stay on the current period.
      if (payload !== 'custom' || state.customRange) state.period = payload
    },
    customRangeSet(state, { payload }: PayloadAction<DateRange>) {
      state.customRange = payload
      state.period = 'custom'
    },
    activeCompanySet(state, { payload }: PayloadAction<CompanySelection | null>) {
      state.activeCompany = payload
    },
  },
  // The next person to sign in on this browser must not inherit the last one's company.
  extraReducers: (builder) => builder.addCase(loggedOut, (state) => ({ ...state, activeCompany: null })),
})

export const { sidebarPinToggled, periodSet, customRangeSet, activeCompanySet } = uiSlice.actions
export default uiSlice.reducer
