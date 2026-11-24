import { Table, Tag } from 'antd'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartCard from '../../components/charts/ChartCard'
import { ANIMATION_MS, axisProps, axisTick, reportColors, shortKg } from '../../components/charts/chartKit'
import ChartTooltip from '../../components/ChartTooltip'
import MobileList from '../../components/MobileList'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { PlantRow } from '../../types/reports'
import { formatKg, formatPercent } from '../../utils/format'

/** Bars shown; the table below always lists everyone. */
const TOP = 10

/** Efficiency as a labelled tag: green 85% or more, amber 65% or more, red below. */
export function Efficiency({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="faint">—</span>
  return <Tag color={pct >= 85 ? 'success' : pct >= 65 ? 'warning' : 'error'}>{formatPercent(pct)}</Tag>
}

const label = (r: PlantRow) => (r.code ? `${r.code} · ${r.name}` : r.name)

interface Props {
  title: string
  rows: PlantRow[]
  loading: boolean
  refreshing: boolean
  /** Clicking a row filters the whole page to it. */
  onPick: (id: number) => void
  emptyText: string
}

/** One operator or machine per row: the top ones by output as bars, then every figure in a table. */
export default function RankingCard({ title, rows, loading, refreshing, onPick, emptyText }: Props) {
  const mobile = useIsMobile()
  const top = rows
    .slice()
    .sort((a, b) => b.output_kg - a.output_kg)
    .slice(0, TOP)
    .map((r) => ({ ...r, label: label(r) }))
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <ChartCard title={`${title} · output`} loading={loading} refreshing={refreshing} empty={!top.some((r) => r.output_kg > 0)} emptyText={emptyText} height={Math.max(160, top.length * 34 + 24)}>
        <ResponsiveContainer>
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid {...{ stroke: reportColors.grid, horizontal: false }} />
            <XAxis type="number" tickFormatter={shortKg} {...axisProps} />
            <YAxis type="category" dataKey="label" width={mobile ? 100 : 150} axisLine={false} tickLine={false} tick={{ ...axisTick, fill: '#5B6270' }} />
            <Tooltip cursor={{ fill: 'rgba(16,24,40,0.04)' }} content={<ChartTooltip format={(v) => formatKg(v)} />} />
            <Bar
              dataKey="output_kg"
              name="Output"
              fill={reportColors.output}
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
              animationDuration={ANIMATION_MS}
              onClick={(d) => onPick((d as unknown as PlantRow).id)}
              style={{ cursor: 'pointer' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="surface table-card">
        {mobile ? (
          <MobileList<PlantRow>
            rows={loading ? undefined : rows.slice().sort((a, b) => b.output_kg - a.output_kg)}
            rowKey={(r) => r.id}
            loading={loading}
            emptyText={emptyText}
            pageSize={10}
            card={(r) => ({
              title: <span style={{ opacity: r.is_active ? 1 : 0.55 }}>{label(r)}</span>,
              extra: <Efficiency pct={r.efficiency_pct} />,
              lines: [
                <span className="num">
                  Output <b>{formatKg(r.output_kg)}</b> · processed {formatKg(r.processed_kg)}
                </span>,
                <span className="num">
                  {r.runs} runs · {r.hours.toFixed(1)} hours · {r.kg_per_hour === null ? '—' : r.kg_per_hour.toLocaleString('en-IN')} kg / hour
                </span>,
                <span className="num">
                  Wastage {formatKg(r.wastage_kg)} · {formatPercent(r.wastage_pct, 2)}
                </span>,
              ],
              onClick: () => onPick(r.id),
            })}
          />
        ) : (
          <Table<PlantRow>
            size="small"
            scroll={{ x: 'max-content' }}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, hideOnSinglePage: true, size: 'small' }}
            dataSource={rows}
            locale={{ emptyText }}
            onRow={(r) => ({ onClick: () => onPick(r.id), style: { cursor: 'pointer' } })}
            columns={[
              { title: title.replace(/s$/, ''), render: (_, r) => <b style={{ opacity: r.is_active ? 1 : 0.55 }}>{label(r)}</b> },
              { title: 'Runs', dataIndex: 'runs', align: 'right', sorter: (a, b) => a.runs - b.runs },
              { title: 'Hours', align: 'right', sorter: (a, b) => a.hours - b.hours, render: (_, r) => <span className="num">{r.hours.toFixed(1)}</span> },
              { title: 'Processed', align: 'right', sorter: (a, b) => a.processed_kg - b.processed_kg, render: (_, r) => <span className="num">{formatKg(r.processed_kg)}</span> },
              {
                title: 'Output',
                align: 'right',
                defaultSortOrder: 'descend',
                sorter: (a, b) => a.output_kg - b.output_kg,
                render: (_, r) => <span className="num strong">{formatKg(r.output_kg)}</span>,
              },
              {
                title: 'Wastage',
                align: 'right',
                sorter: (a, b) => a.wastage_pct - b.wastage_pct,
                render: (_, r) => <span className="num">{`${formatKg(r.wastage_kg)} · ${formatPercent(r.wastage_pct, 2)}`}</span>,
              },
              {
                title: 'kg / hour',
                align: 'right',
                sorter: (a, b) => (a.kg_per_hour ?? -1) - (b.kg_per_hour ?? -1),
                render: (_, r) => <span className="num strong">{r.kg_per_hour === null ? '—' : r.kg_per_hour.toLocaleString('en-IN')}</span>,
              },
              { title: 'Efficiency', align: 'right', sorter: (a, b) => (a.efficiency_pct ?? -1) - (b.efficiency_pct ?? -1), render: (_, r) => <Efficiency pct={r.efficiency_pct} /> },
            ]}
          />
        )}
      </div>
    </div>
  )
}
