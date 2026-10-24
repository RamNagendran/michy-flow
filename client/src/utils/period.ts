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
 * about six months, months beyond. Price history is smoother, so it never goes to days.
 * Must stay within the server's limits (server/app/routers/_range.py).
 */
export function bucketFor([from, to]: DateRange, prices = false): Bucket {
  const days = dayjs(to).diff(dayjs(from), 'day')
  if (prices) return days <= 62 ? 'week' : 'month'
  return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month'
}

/** Axis label for a period start. */
export function periodLabel(period: string, bucket: Bucket) {
  const d = dayjs(period)
  return bucket === 'month' ? d.format('MMM YY') : d.format('D MMM')
}
