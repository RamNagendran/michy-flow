import { Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WastageMonth } from '../../types/reports'
import { formatKgFine } from '../../utils/format'
import { periodLabel } from '../../utils/period'
import ChartTooltip from '../ChartTooltip'
import ChartCard from './ChartCard'
import { ANIMATION_MS, axisProps, gridProps, reportColors as c } from './chartKit'

const barColor = (m: WastageMonth) => (m.status === 'approved' ? c.output : m.status === 'open' ? c.average : c.wastage)

/** Each month's wastage in kg, coloured by where it is in the Super Admin's approval. */
export default function WastageChart({ months, loading, refreshing }: { months: WastageMonth[]; loading?: boolean; refreshing?: boolean }) {
  return (
    <ChartCard
      title="Monthly wastage"
      sub="Wastage in kg for each month"
      legend={[
        { label: 'Approved', color: c.output },
        { label: 'Waiting', color: c.wastage },
        { label: 'This month', color: c.average },
      ]}
      loading={loading}
      refreshing={refreshing}
      empty={!months.length}
      emptyText="No production in this period"
    >
      <ResponsiveContainer>
        <ComposedChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" tickFormatter={(v) => periodLabel(v, 'month')} {...axisProps} />
          <YAxis tickFormatter={(v) => `${v}`} {...axisProps} width={52} />
          <Tooltip cursor={{ fill: 'rgba(16,24,40,0.04)' }} content={<ChartTooltip format={(v) => formatKgFine(v)} labelFormat={(v) => periodLabel(v, 'month')} />} />
          <Bar dataKey="wastage_kg" name="Wastage" radius={[6, 6, 0, 0]} maxBarSize={44} animationDuration={ANIMATION_MS}>
            {months.map((m) => (
              <Cell key={m.month} fill={barColor(m)} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
