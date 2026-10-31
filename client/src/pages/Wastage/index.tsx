import { useState } from 'react'
import { Button, Space, Table } from 'antd'
import { AuditOutlined, CalendarOutlined, CheckCircleOutlined, FieldTimeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import CompanyPicker from '../../components/CompanyPicker'
import WastageChart from '../../components/charts/WastageChart'
import { HintButton, PageHeader, SectionTitle } from '../../components/ui'
import { itemName, WASTAGE_ALERT_PCT } from '../../data/catalog'
import { useStocks } from '../../hooks/queries/stock'
import { useStockChecks, useWastageMonths } from '../../hooks/queries/wastage'
import { useAccess } from '../../hooks/useAccess'
import { usePeriod } from '../../hooks/usePeriod'
import { useReportCompany } from '../../hooks/useReportCompany'
import type { StockCheck } from '../../types/reports'
import { formatDate, formatKgFine, formatQty } from '../../utils/format'
import ApproveModal from './ApproveModal'
import MonthDrawer from './MonthDrawer'
import MonthTable from './MonthTable'
import StockCheckModal from './StockCheckModal'
import { approvable } from './wastageMeta'

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

/** Wastage control: each month's wastage on its way to the Super Admin, and stock checks. */
export default function Wastage() {
  const { can } = useAccess()
  const { range } = usePeriod()
  const { companies, company, setCompany } = useReportCompany('view_all_entries')
  const cid = company?.id
  const manage = !!cid && can('adjust_wastage', cid)
  const canApprove = !!cid && can('approve_wastage', cid)
  // At least a year back, so months still waiting are never hidden by a short period.
  const yearBack = dayjs().subtract(11, 'month').startOf('month').format('YYYY-MM-DD')
  const from = range[0] < yearBack ? range[0] : yearBack
  const months = useWastageMonths(cid, [from, dayjs().format('YYYY-MM-DD')])
  const checks = useStockChecks(cid)
  const stocks = useStocks(company ? [company] : [])
  const stock = cid ? stocks.byCompany.get(cid) : undefined
  const [counting, setCounting] = useState(false)
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [approving, setApproving] = useState(false)

  const all = months.data ?? []
  const waiting = all.filter((m) => m.status === 'pending')
  const withManager = all.filter((m) => m.status === 'escalated')
  const running = all.find((m) => m.status === 'open')
  const toApprove = all.filter((m) => selected.includes(m.month) && approvable(m))

  return (
    <div className="page">
      <PageHeader
        title="Wastage control"
        subtitle="Monthly approval and stock checks"
        extra={
          <Space>
            <HintButton title="How monthly wastage works">
              <p>Every production run counts {WASTAGE_ALERT_PCT}% of its output as wastage.</p>
              <p>When a month ends, its total goes to the Super Admin. The next month starts fresh at once; it does not wait for approval.</p>
              <p>The Super Admin can approve one month or several together, ask the Manager a question, or change the wastage. The Manager replies and sends it back.</p>
              <p>If the Super Admin changes the wastage, the difference is taken out of (or put back into) raw stock by share of tyres used in that month. It happens only on approval.</p>
              <p>After approval, production for that month is locked. Only the Super Admin can change wastage.</p>
            </HintButton>
            <CompanyPicker companies={companies} value={cid} onChange={setCompany} />
          </Space>
        }
      />

      <div className="grid grid-3 stagger">
        <Card
          icon={<FieldTimeOutlined />}
          tone="#2F6FEB"
          label={`This month · ${dayjs().format('MMMM')}`}
          value={formatKgFine(running?.wastage_kg ?? 0)}
          sub={running ? `${running.runs} run${running.runs === 1 ? '' : 's'} so far · goes for approval on ${dayjs().add(1, 'month').startOf('month').format('DD MMM')}` : 'No production yet'}
        />
        <Card
          icon={<CheckCircleOutlined />}
          tone={waiting.length ? '#D98A0B' : '#1F9D6B'}
          label="Waiting for Super Admin"
          value={`${waiting.length} month${waiting.length === 1 ? '' : 's'}`}
          sub={withManager.length ? `${withManager.length} with the Manager for a reply` : 'None with the Manager'}
          action={
            canApprove &&
            waiting.length + withManager.length > 0 && (
              <Button type="primary" onClick={() => setSelected([...waiting, ...withManager].map((m) => m.month))}>
                Select all to approve
              </Button>
            )
          }
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

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)', gap: 16, marginTop: 16 }}>
        <WastageChart months={all} loading={months.isLoading} refreshing={months.isPlaceholderData} />
        <MonthTable months={all} loading={months.isLoading} canApprove={canApprove} selected={selected} onSelect={setSelected} onOpen={setOpenMonth} onApprove={() => setApproving(true)} />
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

      {cid && <MonthDrawer companyId={cid} month={openMonth} onClose={() => setOpenMonth(null)} />}
      {cid && <ApproveModal companyId={cid} months={approving ? toApprove : []} onClose={() => setApproving(false)} onDone={() => setSelected([])} />}
      {cid && <StockCheckModal companyId={cid} stock={stock} open={counting} onClose={() => setCounting(false)} />}
    </div>
  )
}
