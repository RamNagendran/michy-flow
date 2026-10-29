import dayjs from 'dayjs'
import type { Bucket } from '../types/reports'

export type Period = 'month' | 'quarter' | 'fy' | 'custom'
export type DateRange = [string, string]

export const periodLabels: Record<Period, string> = {
  month: 'This month',
  quarter: 'This quarter',
  fy: 'This year',
  custom: 'Custom range',
}

export const today = () => dayjs().format('YYYY-MM-DD')

/** The Indian financial year runs 1 April – 31 March. */
export const fyStart = () => {
  const d = dayjs()
  return dayjs(`${d.month() >= 3 ? d.year() : d.year() - 1}-04-01`)
}

/** [from, to] as YYYY-MM-DD. Presets end today and quarters follow the financial year. */
export function periodRange(period: Period, custom?: DateRange | null): DateRange {
  if (period === 'custom' && custom) return custom
  const d = dayjs()
  const from =
    period === 'month'
      ? d.startOf('month')
      : period === 'quarter'
        ? fyStart().add(Math.floor(d.diff(fyStart(), 'month') / 3) * 3, 'month')
        : fyStart()
  return [from.format('YYYY-MM-DD'), today()]
}

export const rangeSubtitle = ([from, to]: DateRange) => `${dayjs(from).format('D MMM')} – ${dayjs(to).format('D MMM YYYY')}`

export const periodSubtitle = (period: Period, custom?: DateRange | null) => rangeSubtitle(periodRange(period, custom))

/**
 * How finely to group a range so charts stay readable: days for about six weeks, weeks for
 * about six months, months up to three years, years beyond. Price history is smoother, so it
 * never goes to days. Must stay within the server's limits (server/app/routers/_range.py).
 */
export function bucketFor([from, to]: DateRange, prices = false): Bucket {
  const days = dayjs(to).diff(dayjs(from), 'day')
  if (days > 1100) return 'year'
  if (prices) return days <= 62 ? 'week' : 'month'
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month'
}

/** Axis label for a period start. */
export function periodLabel(period: string, bucket: Bucket) {
  const d = dayjs(period)
  return bucket === 'year' ? d.format('YYYY') : bucket === 'month' ? d.format('MMM YY') : d.format('D MMM')
}

export const bucketLabels: Record<Bucket, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }

/** Longest range the server accepts for each grouping (server/app/routers/_range.py). */
export const BUCKET_MAX_DAYS: Record<Bucket, number> = { day: 120, week: 400, month: 1100, year: 3660 }

/** Groupings that fit a range: never more points than the server allows. */
export const bucketsFor = ([from, to]: DateRange): Bucket[] => {
  const days = dayjs(to).diff(dayjs(from), 'day')
  return (['day', 'week', 'month', 'year'] as const).filter((b) => days <= BUCKET_MAX_DAYS[b])
}
