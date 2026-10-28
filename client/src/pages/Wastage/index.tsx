import { useState } from 'react'
import { Button, Table, Tag } from 'antd'
import { AuditOutlined, CalendarOutlined, PercentageOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import CompanyPicker from '../../components/CompanyPicker'
import WastageChart from '../../components/charts/WastageChart'
import { PageHeader, SectionTitle } from '../../components/ui'
import { itemName, WASTAGE_ALERT_PCT } from '../../data/catalog'
import { useStocks } from '../../hooks/queries/stock'
import { useAllowances, useStockChecks, useWastageMonths } from '../../hooks/queries/wastage'
import { useAccess } from '../../hooks/useAccess'
import { usePeriod } from '../../hooks/usePeriod'
import { useReportCompany } from '../../hooks/useReportCompany'
import type { StockCheck, WastageMonth } from '../../types/reports'
import { formatDate, formatKg, formatPercent, formatQty } from '../../utils/format'
import AllowanceModal from './AllowanceModal'
import StockCheckModal from './StockCheckModal'

function Card({ icon, tone, label, value, sub, action }: { icon: React.ReactNode; tone: string; label: string; value: React.ReactNode; sub: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="surface stat-tile lift" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="kpi-icon" style={{ background: `${tone}1a`, color: tone }}>
          {icon}
        </span>
        <span className="label">{label}</span>
      </div>
      <div className="value num">{value}</div>
      <div className="sub">{sub}</div>
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  )
}

/** Wastage control: the monthly allowance and stock checks. */
export default function Wastage() {
  const { can } = useAccess()
  const { label, range } = usePeriod()
  const { companies, company, setCompany } = useReportCompany('view_all_entries')
  const cid = company?.id
  const manage = !!cid && can('adjust_wastage', cid)
  const months = useWastageMonths(cid, range)
  const allowances = useAllowances(cid)
  const checks = useStockChecks(cid)
  const stocks = useStocks(company ? [company] : [])
  const stock = cid ? stocks.byCompany.get(cid) : undefined
  const [declaring, setDeclaring] = useState(false)
  const [counting, setCounting] = useState(false)

  const thisMonth = dayjs().startOf('month').format('YYYY-MM-DD')
  const declared = allowances.data?.find((a) => a.month === thisMonth)

  return (
    <div className="page">
      <PageHeader title="Wastage control" subtitle={`Allowance and stock checks · ${label}`} extra={<CompanyPicker companies={companies} value={cid} onChange={setCompany} />} />

      <div className="grid grid-2 stagger">
        <Card
          icon={<PercentageOutlined />}
          tone="#2F6FEB"
          label={`Allowance · ${dayjs().format('MMMM')}`}
          value={formatPercent(declared?.pct ?? WASTAGE_ALERT_PCT, 2)}
          sub={declared ? `Declared by ${declared.declared_by_name ?? '—'}${declared.note ? ` · ${declared.note}` : ''}` : `Not declared · the ${WASTAGE_ALERT_PCT}% limit applies`}
          action={manage && <Button onClick={() => setDeclaring(true)}>{declared ? 'Change allowance' : 'Declare allowance'}</Button>}
        />
        <Card
          icon={<AuditOutlined />}
          tone={stock?.check_overdue ? '#D4380D' : '#1F9D6B'}
          label={`Stock check · every ${stock?.check_every_months ?? 1} month${stock?.check_every_months === 3 ? 's' : ''}`}
          value={stock ? (stock.check_overdue ? <span style={{ color: '#D4380D' }}>Overdue</span> : formatDate(stock.next_check_due)) : '—'}
          sub={stock?.last_check_on ? `Last counted ${formatDate(stock.last_check_on)}` : 'Not counted yet'}
          action={manage && <Button type={stock?.check_overdue ? 'primary' : 'default'} icon={<CalendarOutlined />} onClick={() => setCounting(true)}>Count stock now</Button>}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 16, marginTop: 16 }}>
        <WastageChart months={months.data ?? []} loading={months.isLoading} refreshing={months.isPlaceholderData} />
        <div className="surface chart-card fade-in">
          <div className="chart-title">Month by month</div>
          <div className="chart-sub" style={{ marginBottom: 10 }}>
            Missing weight ÷ processed weight
          </div>
          <Table<WastageMonth>
            size="small"
            rowKey="month"
            loading={months.isLoading}
            pagination={false}
            dataSource={[...(months.data ?? [])].reverse()}
            scroll={{ y: 250 }}
            columns={[
              { title: 'Month', render: (_, m) => <b>{dayjs(m.month).format('MMM YYYY')}</b> },
              { title: 'Processed', align: 'right', render: (_, m) => <span className="num">{formatKg(m.processed_kg)}</span> },
              {
                title: 'Wastage',
                align: 'right',
                render: (_, m) => (
                  <span className="num strong" style={{ color: m.wastage_pct > WASTAGE_ALERT_PCT ? '#D4380D' : m.over_allowance ? '#D98A0B' : '#1F9D6B' }}>
                    {formatPercent(m.wastage_pct, 2)}
                  </span>
                ),
              },
              { title: 'Allowance', align: 'right', render: (_, m) => <span className="num">{formatPercent(m.allowance_pct, 2)}{!m.declared && <span className="faint"> *</span>}</span> },
              { title: 'Flagged', align: 'right', render: (_, m) => (m.high_runs ? <Tag color="error">{m.high_runs} over 2%</Tag> : m.flagged_runs ? <Tag color="warning">{m.flagged_runs}</Tag> : <span className="faint">—</span>) },
            ]}
          />
          <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            * not declared: the {WASTAGE_ALERT_PCT}% limit applies
          </div>
        </div>
      </div>

      <SectionTitle title="Stock checks" hint="stock counted by the Manager · any difference corrects the stock" />
      <div className="surface table-card">
        <Table<StockCheck>
          rowKey="id"
          loading={checks.isLoading}
          pagination={{ pageSize: 6, hideOnSinglePage: true }}
          dataSource={checks.data}
          locale={{ emptyText: 'No stock checks yet' }}
          expandable={{
            expandedRowRender: (c) => (
              <div style={{ display: 'grid', gap: 4 }}>
                {c.lines.map((l) => (
                  <div key={`${l.section}${l.item}`} className="summary-line" style={{ padding: '4px 0' }}>
                    <span>
                      {itemName(l.item)} <span className="faint">· Grade {l.grade}</span>
                    </span>
                    <span className="num">
                      book {formatQty(l.book_qty, l.unit)} · counted {formatQty(l.counted_qty, l.unit)} ·{' '}
                      <b style={{ color: l.difference > 0 ? '#D4380D' : l.difference < 0 ? '#1F9D6B' : undefined }}>{l.difference > 0 ? `${formatQty(l.difference, l.unit)} short` : l.difference < 0 ? `${formatQty(-l.difference, l.unit)} extra` : 'matched'}</b>
                    </span>
                  </div>
                ))}
              </div>
            ),
          }}
          columns={[
            { title: 'Counted on', render: (_, c) => <b>{formatDate(c.counted_on)}</b> },
            { title: 'By', dataIndex: 'counted_by_name' },
            { title: 'Lines', align: 'right', render: (_, c) => c.lines.length },
            { title: 'Short', align: 'right', render: (_, c) => <span className="num">{c.lines.filter((l) => l.difference > 0).length}</span> },
            { title: 'Note', dataIndex: 'note', render: (v) => <span className="muted">{v || '—'}</span> },
          ]}
        />
      </div>

      {cid && <AllowanceModal companyId={cid} open={declaring} current={declared?.pct} onClose={() => setDeclaring(false)} />}
      {cid && <StockCheckModal companyId={cid} stock={stock} open={counting} onClose={() => setCounting(false)} />}
    </div>
  )
}
