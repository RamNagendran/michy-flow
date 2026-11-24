import { Table } from 'antd'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartCard from '../../components/charts/ChartCard'
import { ANIMATION_MS, axisProps, gridProps } from '../../components/charts/chartKit'
import ChartTooltip from '../../components/ChartTooltip'
import MobileList from '../../components/MobileList'
import { useProductionReport } from '../../hooks/queries/reports'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { ShiftRow } from '../../types/reports'
import { formatKg, formatPercent } from '../../utils/format'

const shiftName = (s: number | null) => (s ? `Shift ${s}` : 'No shift')
const effColor = (pct: number | null) => (pct === null ? '#C9CED6' : pct >= 85 ? '#1F9D6B' : pct >= 65 ? '#D98A0B' : '#D4380D')

/** Running hours and throughput per shift. Operators and machines have their own page. */
export default function ProductionEfficiency({ companyId, range }: { companyId: number | undefined; range: [string, string] }) {
  const report = useProductionReport(companyId, range)
  const mobile = useIsMobile()
  const data = report.data
  const shifts = data?.by_shift ?? []
  return (
    <div className="grid grid-2" style={{ gap: 16 }}>
      <ChartCard
        title="Efficiency by shift"
        sub={`Machine running hours ÷ planned ${data?.shift_hours ?? 8} hours per run · green: 85% or more`}
        loading={report.isLoading}
        refreshing={report.isPlaceholderData}
        empty={!shifts.some((s) => s.efficiency_pct !== null)}
        emptyText="No runs with running hours in this period"
        height={240}
      >
        <ResponsiveContainer>
          <BarChart data={shifts.map((s) => ({ ...s, name: shiftName(s.shift) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis tickFormatter={(v) => `${v}%`} {...axisProps} width={44} domain={[0, 100]} />
            <Tooltip cursor={{ fill: 'rgba(16,24,40,0.04)' }} content={<ChartTooltip format={(v) => formatPercent(v)} />} />
            <Bar dataKey="efficiency_pct" name="Efficiency" radius={[6, 6, 0, 0]} maxBarSize={56} animationDuration={ANIMATION_MS}>
              {shifts.map((s) => (
                <Cell key={String(s.shift)} fill={effColor(s.efficiency_pct)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="surface chart-card fade-in">
        <div className="chart-title">Shifts</div>
        <div className="chart-sub" style={{ marginBottom: 10 }}>
          Throughput counts only runs that logged hours
        </div>
        {mobile ? (
          <MobileList<ShiftRow>
            rows={data && shifts}
            rowKey={(r) => String(r.shift)}
            loading={report.isLoading}
            emptyText="No runs in this period"
            card={(r) => ({
              title: shiftName(r.shift),
              extra: (
                <span className="num strong" style={{ color: effColor(r.efficiency_pct) }}>
                  {r.efficiency_pct === null ? '—' : formatPercent(r.efficiency_pct)}
                </span>
              ),
              lines: [
                <span className="num">
                  {r.runs} runs · {r.hours.toFixed(1)} hours
                </span>,
                <span className="num">
                  Processed {formatKg(r.processed_kg)} · {r.kg_per_hour === null ? '—' : r.kg_per_hour.toLocaleString('en-IN')} kg / hour
                </span>,
              ],
            })}
          />
        ) : (
          <Table<ShiftRow>
            size="small"
            rowKey={(r) => String(r.shift)}
            loading={report.isLoading}
            pagination={false}
            dataSource={shifts}
            columns={[
              { title: 'Shift', render: (_, r) => <b>{shiftName(r.shift)}</b> },
              { title: 'Runs', dataIndex: 'runs', align: 'right' },
              { title: 'Hours', align: 'right', render: (_, r) => <span className="num">{r.hours.toFixed(1)}</span> },
              { title: 'Processed', align: 'right', render: (_, r) => <span className="num">{formatKg(r.processed_kg)}</span> },
              { title: 'kg / hour', align: 'right', render: (_, r) => <span className="num strong">{r.kg_per_hour === null ? '—' : r.kg_per_hour.toLocaleString('en-IN')}</span> },
              { title: 'Efficiency', align: 'right', render: (_, r) => <span className="num strong" style={{ color: effColor(r.efficiency_pct) }}>{r.efficiency_pct === null ? '—' : formatPercent(r.efficiency_pct)}</span> },
            ]}
          />
        )}
      </div>
    </div>
  )
}
