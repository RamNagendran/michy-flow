import { useMemo } from 'react'
import { Table } from 'antd'
import { InfoCircleFilled } from '@ant-design/icons'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartTooltip from '../../components/ChartTooltip'
import { Formula, GradeTag, PageHeader, SectionTitle } from '../../components/ui'
import { gradeInfo } from '../../data/grades'
import { itemsOfCompanies } from '../../data/catalog'
import { useSummaries } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { usePeriod } from '../../hooks/usePeriod'
import { seriesColors } from '../../styles/theme'
import type { MoneyTotals } from '../../types/entries'
import { formatINR, formatINRShort, formatPercent, formatKg } from '../../utils/format'
import { periodLabels } from '../../utils/period'

function ByItemChart({ title, totals, items }: { title: string; totals: MoneyTotals | undefined; items: { id: string; name: string }[] }) {
  const data = items.map((i) => ({ key: i.id, name: i.name, value: totals?.by_item.find((x) => x.item === i.id)?.amount ?? 0 }))
  return (
    <div className="surface" style={{ padding: 22 }}>
      <div className="strong" style={{ fontSize: 16 }}>
        {title}
      </div>
      <div style={{ height: 200, marginTop: 8 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 84 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={120} tick={{ fill: '#3a3f47', fontSize: 13, fontWeight: 700 }} />
            <Tooltip cursor={{ fill: 'rgba(16,24,40,0.04)' }} content={<ChartTooltip format={(v) => formatINR(v)} />} />
            <Bar isAnimationActive={false} dataKey="value" name="Value" radius={[0, 4, 4, 0]} barSize={22} label={{ position: 'right', formatter: (v: unknown) => formatINRShort(Number(v)), fill: '#1f2329', fontSize: 12.5, fontWeight: 700 }}>
              {data.map((d) => (
                <Cell key={d.key} fill={seriesColors[d.key as keyof typeof seriesColors] ?? '#8a919e'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function Finance() {
  const { period, range, subtitle } = usePeriod()
  // Only companies where this person may see money figures.
  const { scope, can } = useAccess()
  const companies = useMemo(() => scope.filter((c) => can('view_finance', c.id) && can('view_all_entries', c.id)), [scope, can])
  const { byCompany, total: t } = useSummaries(companies, range)
  const margin = (t?.sales.amount ?? 0) - (t?.purchases.amount ?? 0)
  const verifiedMargin = (t?.sales.verified_amount ?? 0) - (t?.purchases.verified_amount ?? 0)

  return (
    <div className="page">
      <PageHeader title="Finance" subtitle={`Money spent and received · ${periodLabels[period].toLowerCase()} (${subtitle})`} />

      <div className="info-banner" style={{ marginBottom: 20 }}>
        <InfoCircleFilled style={{ marginTop: 3 }} />
        <div>
          <b>A basic difference only:</b> sales received minus purchases spent. Labour, electricity, transport and other overheads are not included. "Final" counts
          only entries Finance has approved.
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 16 }}>
        {(
          [
            ['All entries (including those in approval)', t?.sales.amount, t?.purchases.amount, margin],
            ['Final only (Finance approved)', t?.sales.verified_amount, t?.purchases.verified_amount, verifiedMargin],
          ] as const
        ).map(([label, sales, spend, diff]) => (
          <div key={label} className="surface" style={{ padding: 22 }}>
            <div className="strong" style={{ marginBottom: 12 }}>
              {label}
            </div>
            <Formula
              parts={[
                { label: 'Received from sales', value: formatINRShort(sales ?? 0), kind: 'in' },
                { op: '−', label: 'Spent on purchases', value: formatINRShort(spend ?? 0), kind: 'out' },
                { op: '=', label: 'Basic difference', value: formatINRShort(diff), kind: 'result' },
              ]}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <ByItemChart title="Sales by product" totals={t?.sales} items={itemsOfCompanies(companies, 'products')} />
        <ByItemChart title="Purchases by raw material" totals={t?.purchases} items={itemsOfCompanies(companies, 'inputs')} />
      </div>

      <SectionTitle title="By grade" hint="A: plant · B: sold again as bought · C: bill only" />
      <div className="surface table-card">
        <Table
          scroll={{ x: 'max-content' }}
          pagination={false}
          rowKey="grade"
          dataSource={t ? t.purchases.by_grade.map((p, i) => ({ grade: p.grade, bought: p, sold: t.sales.by_grade[i] })) : []}
          columns={[
            { title: 'Grade', render: (_, r) => <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><GradeTag grade={r.grade} /><b>{gradeInfo(r.grade).short}</b></span> },
            { title: 'Bought', align: 'right', render: (_, r) => <span className="num">{formatKg(r.bought.qty_kg)} · {r.bought.count} bills</span> },
            { title: 'Spent', align: 'right', render: (_, r) => <span className="num strong">{formatINR(r.bought.amount)}</span> },
            { title: 'Sold', align: 'right', render: (_, r) => <span className="num">{formatKg(r.sold.qty_kg)} · {r.sold.count} invoices</span> },
            { title: 'Received', align: 'right', render: (_, r) => <span className="num strong">{formatINR(r.sold.amount)}</span> },
            {
              title: 'Basic difference',
              align: 'right',
              render: (_, r) => {
                const d = r.sold.amount - r.bought.amount
                return <span className="num strong" style={{ color: d < 0 ? '#D4380D' : undefined }}>{formatINR(d)}</span>
              },
            },
          ]}
        />
      </div>

      <SectionTitle title="By company" hint={periodLabels[period]} />
      <div className="surface table-card">
        <Table
          scroll={{ x: 'max-content' }}
          pagination={false}
          rowKey="id"
          dataSource={companies.filter((c) => byCompany.has(c.id)).map((c) => ({ ...c, s: byCompany.get(c.id)! }))}
          columns={[
            { title: 'Company', dataIndex: 'name', render: (v) => <b>{v}</b> },
            { title: 'Bought (kg)', align: 'right', render: (_, c) => <span className="num">{formatKg(c.s.purchases.qty_kg)}</span> },
            { title: 'Spent', align: 'right', render: (_, c) => <span className="num strong">{formatINR(c.s.purchases.amount)}</span> },
            { title: 'Sold', align: 'right', render: (_, c) => <span className="num">{formatKg(c.s.sales.qty_kg)}</span> },
            { title: 'Received', align: 'right', render: (_, c) => <span className="num strong">{formatINR(c.s.sales.amount)}</span> },
            {
              title: 'Basic difference',
              align: 'right',
              render: (_, c) => {
                const d = c.s.sales.amount - c.s.purchases.amount
                return (
                  <span className="num strong" style={{ color: d < 0 ? '#D4380D' : undefined }}>
                    {formatINR(d)} <span className="faint">({formatPercent(c.s.sales.amount ? (d / c.s.sales.amount) * 100 : 0)})</span>
                  </span>
                )
              },
            },
            { title: 'Not final yet', align: 'right', render: (_, c) => <span className="num">{c.s.queue.pending + c.s.queue.approved + c.s.queue.change_requested}</span> },
          ]}
        />
      </div>
    </div>
  )
}
