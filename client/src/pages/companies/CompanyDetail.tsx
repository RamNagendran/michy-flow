import { useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button, Segmented, Skeleton, Tabs, Tag } from 'antd'
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons'
import { CompanyBadge, StockFigure } from '../../components/CompanyCards'
import { activeLines } from '../../utils/stock'
import EntryTable from '../../components/entries/EntryTable'
import { PageHeader, SectionTitle } from '../../components/ui'
import { itemName, processOf, itemColor } from '../../data/catalog'
import { useStocks, useSummaries } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePeriod } from '../../hooks/usePeriod'
import type { EntryType, StockLine } from '../../types/entries'
import { formatINRShort, formatPercent, formatQty, formatKg } from '../../utils/format'
import { periodLabels } from '../../utils/period'
import { roleColor } from '../../utils/permissions'
import { accessRoleLabel } from '../../utils/user'

function StockCards({ lines, empty }: { lines: StockLine[]; empty: string }) {
  if (!lines.length) return <div className="surface faint" style={{ padding: 20 }}>{empty}</div>
  return (
    <div className="grid grid-4">
      {lines.map((l) => (
        <div key={l.item} className="surface detail-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
            <span className="legend-dot" style={{ background: itemColor(l.item) }} />
            {itemName(l.item)}
          </div>
          <div className="detail-card-value stock">
            <StockFigure line={l} />
          </div>
          <div className="num muted" style={{ fontSize: 12.5, marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>In {l.unit === 'L' ? formatQty(l.provisional.in_qty, 'L') : formatKg(l.provisional.in_qty)}</span>
            <span>Out {l.unit === 'L' ? formatQty(l.provisional.out_qty, 'L') : formatKg(l.provisional.out_qty)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const ENTRY_TABS: { key: string; label: string; types: EntryType[] }[] = [
  { key: 'all', label: 'All', types: ['purchase', 'production', 'sale'] },
  { key: 'purchase', label: 'Purchases', types: ['purchase'] },
  { key: 'production', label: 'Production', types: ['production'] },
  { key: 'sale', label: 'Sales', types: ['sale'] },
]

const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) => (
  <div className="surface detail-card">
    <div className="muted" style={{ fontWeight: 700, fontSize: 13 }}>
      {label}
    </div>
    <div className="num strong detail-card-value">
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
  const mobile = useIsMobile()
  const [entryTab, setEntryTab] = useState('all')
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
  // The header's company always wins: switching it there opens that company here.
  if (access.active !== null && company.id !== access.active) return <Navigate to={`/companies/${access.active}`} replace />
  const stock = stocks.byCompany.get(company.id)
  const t = summaries.byCompany.get(company.id)
  const myRole = accessRoleLabel(user, entry)
  const can = (p: Parameters<typeof access.can>[0]) => access.can(p, company.id)

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <a onClick={() => navigate('/stock')} style={{ color: 'inherit' }}>
            <ArrowLeftOutlined /> Stock
          </a>
        }
        title={
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px' }}>
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
        {mobile ? (
          // On a phone the four lists fit as one switch, so none hide off screen.
          <>
            <div style={{ padding: '12px 12px 0' }}>
              <Segmented block value={entryTab} onChange={setEntryTab} options={ENTRY_TABS.map((t) => ({ value: t.key, label: t.label }))} />
            </div>
            <EntryTable key={entryTab} types={ENTRY_TABS.find((t) => t.key === entryTab)!.types} companies={list} />
          </>
        ) : (
          <div className="tabs-pad">
            <Tabs destroyOnHidden items={ENTRY_TABS.map((t) => ({ key: t.key, label: t.label, children: <EntryTable types={t.types} companies={list} /> }))} />
          </div>
        )}
      </div>
    </div>
  )
}
