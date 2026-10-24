import { useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../statemanager/hooks'
import { customRangeSet, periodSet } from '../statemanager/slices/uiSlice'
import { periodLabels, periodRange, rangeSubtitle, type DateRange, type Period } from '../utils/period'

/** The reporting period picked in the header (month / quarter / year / custom), shared by every report page. */
export function usePeriod() {
  const period = useAppSelector((s) => s.ui.period)
  const custom = useAppSelector((s) => s.ui.customRange ?? null)
  const dispatch = useAppDispatch()
  // A stable array, so query keys and memos only change when the dates do.
  const [from, to] = periodRange(period, custom)
  const range = useMemo<DateRange>(() => [from, to], [from, to])
  return {
    period,
    range,
    custom,
    label: periodLabels[period],
    subtitle: rangeSubtitle(range),
    setPeriod: (p: Period) => dispatch(periodSet(p)),
    setCustom: (r: DateRange) => dispatch(customRangeSet(r)),
  }
}
