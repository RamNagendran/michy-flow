import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { WASTAGE_ALERT_PCT } from '../../data/catalog'
import type { WastageMonth } from '../../types/reports'
import { formatPercent } from '../../utils/format'
import { periodLabel } from '../../utils/period'
import ChartTooltip from '../ChartTooltip'
import ChartCard from './ChartCard'
import { ANIMATION_MS, axisProps, gridProps, reportColors as c } from './chartKit'

const barColor = (m: WastageMonth) => (m.wastage_pct > WASTAGE_ALERT_PCT ? c.danger : m.over_allowance ? c.wastage : c.output)

/** Each month's wastage % against the Admin's declared allowance and the hard limit. */
export default function WastageChart({ months, loading, refreshing }: { months: WastageMonth[]; loading?: boolean; refreshing?: boolean }) {
  return (
    <ChartCard
      title="Monthly wastage"
      sub="Green: within allowed wastage · Amber: above it · Red: above 2%"
      legend={[
        { label: 'Wastage %', color: c.output },
        { label: 'Allowance', color: c.average },
        { label: `${WASTAGE_ALERT_PCT}% limit`, color: c.danger, dashed: true },
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
          <YAxis tickFormatter={(v) => `${v}%`} {...axisProps} width={44} domain={[0, (max: number) => Math.max(WASTAGE_ALERT_PCT + 1, Math.ceil(max))]} />
          <Tooltip cursor={{ fill: 'rgba(16,24,40,0.04)' }} content={<ChartTooltip format={(v) => formatPercent(v, 2)} labelFormat={(v) => periodLabel(v, 'month')} />} />
          <ReferenceLine y={WASTAGE_ALERT_PCT} stroke={c.danger} strokeDasharray="5 4" />
          <Bar dataKey="wastage_pct" name="Wastage" radius={[6, 6, 0, 0]} maxBarSize={44} animationDuration={ANIMATION_MS}>
            {months.map((m) => (
              <Cell key={m.month} fill={barColor(m)} />
            ))}
          </Bar>
          <Line type="stepAfter" dataKey="allowance_pct" name="Allowance" stroke={c.average} strokeWidth={2} dot={false} animationDuration={ANIMATION_MS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
