import type { ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button, Skeleton, Tabs, Tag } from 'antd'
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons'
import { CompanyBadge, StockFigure } from '../../components/CompanyCards'
import { activeLines } from '../../utils/stock'
import EntryTable from '../../components/entries/EntryTable'
import { PageHeader, SectionTitle } from '../../components/ui'
import { itemName, processOf } from '../../data/catalog'
import { useStocks, useSummaries } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { usePeriod } from '../../hooks/usePeriod'
import { seriesColors } from '../../styles/theme'
import type { StockLine } from '../../types/entries'
import { formatINRShort, formatPercent, formatQty, formatKg } from '../../utils/format'
import { periodLabels } from '../../utils/period'
import { roleColor } from '../../utils/permissions'
import { accessRoleLabel } from '../../utils/user'

function StockCards({ lines, empty }: { lines: StockLine[]; empty: string }) {
  if (!lines.length) return <div className="surface faint" style={{ padding: 20 }}>{empty}</div>
  return (
    <div className="grid grid-4">
      {lines.map((l) => (
        <div key={l.item} className="surface" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
            <span className="legend-dot" style={{ background: seriesColors[l.item as keyof typeof seriesColors] }} />
            {itemName(l.item)}
          </div>
          <div style={{ fontSize: 22, marginTop: 8 }}>
            <StockFigure line={l} />
          </div>
          <div className="num muted" style={{ fontSize: 12.5, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span>In {l.unit === 'L' ? formatQty(l.provisional.in_qty, 'L') : formatKg(l.provisional.in_qty)}</span>
            <span>Out {l.unit === 'L' ? formatQty(l.provisional.out_qty, 'L') : formatKg(l.provisional.out_qty)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) => (
  <div className="surface" style={{ padding: 20 }}>
    <div className="muted" style={{ fontWeight: 700, fontSize: 13 }}>
      {label}
    </div>
    <div className="num strong" style={{ fontSize: 24, marginTop: 6 }}>
      {value}
    </div>
    <div className="faint" style={{ fontSize: 12.5 }}>
      {sub}
    </div>
  </div>
)

export default function CompanyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { period, range } = usePeriod()
  const access = useAccess()
  // A company this person cannot open (or a made-up id in the link) goes back to the list.
  const entry = access.accessFor(Number(id))
  const company = entry?.company
  const list = company ? [company] : []
  const stocks = useStocks(list)
  const canSeeTotals = !!company && access.can('view_all_entries', company.id)
  const summaries = useSummaries(canSeeTotals ? list : [], range)

  if (!entry || !company) return <Navigate to="/stock" replace />
  const stock = stocks.byCompany.get(company.id)
  const t = summaries.byCompany.get(company.id)
  const myRole = accessRoleLabel(user, entry)
  const can = (p: Parameters<typeof access.can>[0]) => access.can(p, company.id)

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <a onClick={() => navigate('/stock')} style={{ color: 'inherit' }}>
            <ArrowLeftOutlined /> All companies
          </a>
        }
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <CompanyBadge code={company.code} />
            {company.name}
            {myRole && (
              <Tag color={roleColor[user?.global_role ?? entry.role ?? 'operator']} style={{ fontWeight: 700, fontSize: 12 }}>
                You: {myRole}
              </Tag>
            )}
          </span>
        }
        subtitle={[processOf(company.category).summary, company.city].filter(Boolean).join(' · ')}
        extra={
          <>
            {can('enter_purchase') && (
              <Button size="large" icon={<PlusOutlined />} onClick={() => navigate('/purchases/new')}>
                Purchase
              </Button>
            )}
            {can('enter_sales') && (
              <Button size="large" icon={<PlusOutlined />} onClick={() => navigate('/sales/new')}>
                Sale
              </Button>
            )}
            {can('enter_production') && (
              <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => navigate('/production/new')}>
                Record production
              </Button>
            )}
          </>
        }
      />

      {t && (
        <div className="grid grid-4" style={{ marginBottom: 8 }}>
          <Stat label={`Purchased · ${periodLabels[period].toLowerCase()}`} value={formatINRShort(t.purchases.amount)} sub={`${formatKg(t.purchases.qty_kg)} · ${t.purchases.count} bills`} />
          <Stat label="Processed" value={formatKg(t.production.input_kg)} sub={`${formatKg(t.production.output_kg)} out · ${formatPercent(t.production.input_kg ? (t.production.wastage_kg / t.production.input_kg) * 100 : 0)} wastage`} />
          <Stat label="Sold" value={formatINRShort(t.sales.amount)} sub={`${formatKg(t.sales.qty_kg)} · ${t.sales.count} invoices`} />
          <Stat label="Not final yet" value={t.queue.pending + t.queue.approved + t.queue.change_requested} sub={`${t.queue.pending} Manager · ${t.queue.approved} Finance · ${t.queue.change_requested} Super Admin`} />
        </div>
      )}

      <SectionTitle title="Raw material in stock · Grade A" hint="in stock now · finalised underneath" />
      {stock ? <StockCards lines={activeLines(stock.raw)} empty="No raw material bought yet." /> : <Skeleton active />}

      <SectionTitle title="Output ready to sell" hint="oil in litres, everything else in kg" />
      {stock ? <StockCards lines={activeLines(stock.output)} empty="Nothing produced yet." /> : <Skeleton active />}

      <SectionTitle title="Entries" />
      <div className="surface table-card">
        <div style={{ padding: '4px 20px 0' }}>
          <Tabs
            destroyOnHidden
            items={[
              { key: 'all', label: 'All', children: <EntryTable types={['purchase', 'production', 'sale']} companies={list} /> },
              { key: 'purchase', label: 'Purchases', children: <EntryTable types={['purchase']} companies={list} /> },
              { key: 'production', label: 'Production', children: <EntryTable types={['production']} companies={list} /> },
              { key: 'sale', label: 'Sales', children: <EntryTable types={['sale']} companies={list} /> },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
