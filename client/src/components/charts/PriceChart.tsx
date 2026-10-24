import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Bucket, PriceHistory } from '../../types/reports'
import { formatRateIn } from '../../utils/format'
import { periodLabel } from '../../utils/period'
import ChartTooltip from '../ChartTooltip'
import ChartCard from './ChartCard'
import { ANIMATION_MS, axisProps, gridProps, reportColors as c, supplierColors } from './chartKit'

interface Props {
  title: string
  sub?: string
  history: PriceHistory | undefined
  bucket: Bucket
  /** Suppliers to draw as their own lines next to the average (by id). */
  suppliers?: number[]
  loading?: boolean
  refreshing?: boolean
  height?: number
}

/** The weighted average price over time, with chosen suppliers' prices for comparison. */
export default function PriceChart({ title, sub, history, bucket, suppliers = [], loading, refreshing, height }: Props) {
  const unit = history?.unit ?? 'kg'
  const names = new Map(history?.suppliers.map((s) => [s.supplier_id, s.name]))
  // Flatten each supplier's rate into its own key, so Recharts can draw one line per supplier.
  const data = history?.series.map((p) => ({ period: p.period, avg: p.avg_rate, ...Object.fromEntries(suppliers.map((id) => [`s${id}`, p.suppliers[id] ?? null])) }))
  return (
    <ChartCard
      title={title}
      sub={sub ?? `Weighted average ₹ per ${unit === 'L' ? 'litre' : 'kg'}`}
      legend={[{ label: 'Average', color: c.average }, ...suppliers.map((id, i) => ({ label: names.get(id) ?? 'Supplier', color: supplierColors[i % supplierColors.length] }))]}
      loading={loading}
      refreshing={refreshing}
      empty={!history?.series.some((p) => p.avg_rate !== null)}
      emptyText="No purchases of this item in the period"
      height={height}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="period" tickFormatter={(v) => periodLabel(v, bucket)} {...axisProps} minTickGap={24} />
          <YAxis tickFormatter={(v) => `₹${v}`} {...axisProps} width={52} domain={['auto', 'auto']} />
          <Tooltip content={<ChartTooltip format={(v) => formatRateIn(v, unit)} labelFormat={(v) => periodLabel(v, bucket)} />} />
          <Line type="monotone" dataKey="avg" name="Average" stroke={c.average} strokeWidth={2.5} dot={{ r: 3 }} connectNulls animationDuration={ANIMATION_MS} />
          {suppliers.map((id, i) => (
            <Line key={id} type="monotone" dataKey={`s${id}`} name={names.get(id) ?? 'Supplier'} stroke={supplierColors[i % supplierColors.length]} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} connectNulls animationDuration={ANIMATION_MS} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
