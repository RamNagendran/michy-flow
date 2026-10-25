import { useMemo } from 'react'
import dayjs from 'dayjs'
import { ChartFrame, DonutChart, entryTypeColor, StackedColumnChart, statusColor, STATUS_ORDER } from '../../charts'
import { useEntries, useStatusSummary } from '../../hooks/queries/entries'
import type { EntryType } from '../../types/entries'
import { statusMeta } from '../../utils/entryStatus'

const DAYS = 14
const typeName: Record<EntryType, string> = { purchase: 'Purchases', production: 'Production', sale: 'Sales' }
const count = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`

/** An operator's own work: entries per day for the last two weeks, and where they stand in approval. */
export default function OperatorCharts({ types, companyIds }: { types: EntryType[]; companyIds: number[] }) {
  const from = dayjs().subtract(DAYS - 1, 'day').format('YYYY-MM-DD')
  // The server returns only this operator's own entries, of the kinds they may enter.
  const recent = useEntries({ type: types, company_id: companyIds, date_from: from, page_size: 200 }, types.length > 0)
  const statuses = useStatusSummary({ type: types, company_id: companyIds }, types.length > 0)

  const days = useMemo(() => {
    const rows = Array.from({ length: DAYS }, (_, i) => {
      const d = dayjs(from).add(i, 'day')
      return { date: d.format('YYYY-MM-DD'), label: d.format('D MMM'), purchase: 0, production: 0, sale: 0 }
    })
    const byDate = new Map(rows.map((r) => [r.date, r]))
    for (const e of recent.data?.items ?? []) {
      const row = byDate.get(e.entry_date)
      if (row) row[e.type] += 1
    }
    return rows
  }, [recent.data, from])

  const slices = STATUS_ORDER.map((s) => ({ label: statusMeta[s].label, value: statuses.data?.find((r) => r.status === s)?.count ?? 0, color: statusColor[s] })).filter((s) => s.value > 0)
  const total = slices.reduce((n, s) => n + s.value, 0)

  return (
    <div className="viz-grid wide-left">
      <ChartFrame
        title="My entries · last 14 days"
        sub="How many you recorded each day"
        loading={recent.isLoading}
        refreshing={recent.isPlaceholderData}
        empty={days.every((d) => !d.purchase && !d.production && !d.sale)}
        emptyText="Nothing recorded in the last 14 days"
        height={200}
        table={{ columns: ['Day', ...types.map((t) => typeName[t])], rows: days.map((d) => [d.label, ...types.map((t) => d[t])]) }}
      >
        <StackedColumnChart data={days} categoryField="label" series={types.map((t) => ({ field: t, name: typeName[t], color: entryTypeColor[t] }))} format={count} axisFormat={(v) => String(v)} integer scrollFrom="end" height={200} />
      </ChartFrame>
      <ChartFrame
        title="Where my entries stand"
        sub="All your entries, by approval step"
        loading={statuses.isLoading}
        empty={!total}
        emptyText="No entries yet"
        height={200}
        table={{ columns: ['Status', 'Entries'], rows: slices.map((s) => [s.label, s.value]) }}
      >
        <DonutChart slices={slices} format={count} centerValue={String(total)} centerLabel="entries" height={200} />
      </ChartFrame>
    </div>
  )
}
