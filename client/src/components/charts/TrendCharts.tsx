import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { WASTAGE_ALERT_PCT } from '../../data/catalog'
import type { Bucket, TrendPoint } from '../../types/reports'
import { formatINR, formatKg, formatPercent } from '../../utils/format'
import { periodLabel } from '../../utils/period'
import ChartTooltip from '../ChartTooltip'
import ChartCard from './ChartCard'
import { ANIMATION_MS, axisProps, gridProps, reportColors as c, shortKg, shortMoney, xTick } from './chartKit'

interface Props {
  series: TrendPoint[]
  bucket: Bucket
  loading?: boolean
  refreshing?: boolean
}

const hasAny = (series: TrendPoint[], keys: (keyof TrendPoint)[]) => series.some((p) => keys.some((k) => Number(p[k]) > 0))

/** Money in and out over time: sales and purchases. */
export function MoneyTrend({ series, bucket, loading, refreshing }: Props) {
  return (
    <ChartCard
      title="Sales and purchases"
      sub="Including entries still in approval"
      legend={[
        { label: 'Sales', color: c.sales },
        { label: 'Purchases', color: c.purchase },
      ]}
      loading={loading}
      refreshing={refreshing}
      empty={!hasAny(series, ['sales_amount', 'purchase_amount'])}
    >
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.sales} stopOpacity={0.22} />
              <stop offset="100%" stopColor={c.sales} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="period" tickFormatter={xTick(bucket)} {...axisProps} minTickGap={24} />
          <YAxis tickFormatter={shortMoney} {...axisProps} width={64} />
          <Tooltip content={<ChartTooltip format={(v) => formatINR(v)} labelFormat={(v) => periodLabel(v, bucket)} />} />
          <Area type="monotone" dataKey="sales_amount" name="Sales" stroke={c.sales} strokeWidth={2.5} fill="url(#salesFill)" animationDuration={ANIMATION_MS} />
          <Line type="monotone" dataKey="purchase_amount" name="Purchases" stroke={c.purchase} strokeWidth={2.5} dot={false} animationDuration={ANIMATION_MS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** What was processed, what came out, and the wastage % against the 2% limit. */
export function ProductionTrend({ series, bucket, loading, refreshing }: Props) {
  return (
    <ChartCard
      title="Production and wastage"
      sub={`Missing weight as a share of what was processed · ${WASTAGE_ALERT_PCT}% is the limit`}
      legend={[
        { label: 'Processed', color: c.processed },
        { label: 'Output', color: c.output },
        { label: 'Wastage %', color: c.wastage },
        { label: `${WASTAGE_ALERT_PCT}% limit`, color: c.danger, dashed: true },
      ]}
      loading={loading}
      refreshing={refreshing}
      empty={!hasAny(series, ['processed_kg'])}
    >
      <ResponsiveContainer>
        <ComposedChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="period" tickFormatter={xTick(bucket)} {...axisProps} minTickGap={24} />
          <YAxis yAxisId="kg" tickFormatter={shortKg} {...axisProps} width={56} />
          <YAxis yAxisId="pct" orientation="right" tickFormatter={(v) => `${v}%`} {...axisProps} width={40} domain={[0, (max: number) => Math.max(WASTAGE_ALERT_PCT * 2, Math.ceil(max))]} />
          <Tooltip content={<ChartTooltip format={(v, key) => (key === 'wastage_pct' ? formatPercent(v, 2) : formatKg(v))} labelFormat={(v) => periodLabel(v, bucket)} />} />
          <Bar yAxisId="kg" dataKey="processed_kg" name="Processed" fill={c.processed} fillOpacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={ANIMATION_MS} />
          <Bar yAxisId="kg" dataKey="output_kg" name="Output" fill={c.output} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={ANIMATION_MS} />
          <ReferenceLine yAxisId="pct" y={WASTAGE_ALERT_PCT} stroke={c.danger} strokeDasharray="5 4" ifOverflow="extendDomain" />
          <Line yAxisId="pct" type="monotone" dataKey="wastage_pct" name="Wastage %" stroke={c.wastage} strokeWidth={2.5} dot={{ r: 3 }} animationDuration={ANIMATION_MS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
