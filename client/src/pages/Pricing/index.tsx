import { useMemo, useState } from 'react'
import { Segmented, Table, Tag, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, RightOutlined } from '@ant-design/icons'
import CompanyPicker from '../../components/CompanyPicker'
import PriceChart from '../../components/charts/PriceChart'
import { PageHeader, SectionTitle } from '../../components/ui'
import { companyItems, itemName } from '../../data/catalog'
import { usePrices } from '../../hooks/queries/reports'
import { usePeriod } from '../../hooks/usePeriod'
import { useReportCompany } from '../../hooks/useReportCompany'
import type { SupplierPrice } from '../../types/reports'
import { formatINR, formatPercent, formatQty, formatRateIn } from '../../utils/format'
import { bucketFor } from '../../utils/period'
import SupplierDrawer from './SupplierDrawer'

/** Car and truck tyres side by side when the company buys both; otherwise its first two inputs. */
function comparedItems(inputs: string[]) {
  const preferred = ['car', 'truck'].filter((i) => inputs.includes(i))
  return preferred.length === 2 ? preferred : inputs.slice(0, 2)
}

/** Purchase price history: each supplier against the weighted average, per item. */
export default function Pricing() {
  const { label, range, subtitle } = usePeriod()
  const { companies, company, setCompany } = useReportCompany('view_finance')
  const inputs = useMemo(() => (company ? companyItems(company).inputs.map((i) => i.id) : []), [company])
  const [pickedItem, setItem] = useState<string>()
  const item = pickedItem && inputs.includes(pickedItem) ? pickedItem : inputs[0]
  const [left, right] = comparedItems(inputs)
  const bucket = bucketFor(range, true)
  const a = usePrices(company?.id, left, range)
  const b = usePrices(company?.id, right, range)
  const detail = usePrices(company?.id, item, range)
  const [open, setOpen] = useState<SupplierPrice | null>(null)
  const h = detail.data
  const unit = h?.unit ?? 'kg'

  return (
    <div className="page">
      <PageHeader
        title="Purchase prices"
        subtitle={`What each supplier charged against the average · ${label} (${subtitle}) · Grade C paper entries left out`}
        extra={<CompanyPicker companies={companies} value={company?.id} onChange={setCompany} />}
      />

      <div className={right ? 'grid grid-2' : 'grid'}>
        {left && <PriceChart title={`${itemName(left)} · price history`} history={a.data} bucket={bucket} loading={a.isLoading} refreshing={a.isPlaceholderData} />}
        {right && <PriceChart title={`${itemName(right)} · price history`} history={b.data} bucket={bucket} loading={b.isLoading} refreshing={b.isPlaceholderData} />}
      </div>

      <SectionTitle
        title="Suppliers against the average"
        hint="click a supplier for their price history"
        extra={inputs.length > 1 && <Segmented value={item} onChange={setItem} options={inputs.map((i) => ({ value: i, label: itemName(i) }))} />}
      />
      <div className="grid grid-4 stagger" style={{ marginBottom: 16 }}>
        {(
          [
            ['Average price', h?.avg_rate ? formatRateIn(h.avg_rate, unit) : '—', 'weighted by quantity'],
            ['Lowest paid', h?.min_rate ? formatRateIn(h.min_rate, unit) : '—', 'single bill'],
            ['Highest paid', h?.max_rate ? formatRateIn(h.max_rate, unit) : '—', 'single bill'],
            ['Bought', formatQty(h?.qty ?? 0, unit), formatINR(h?.amount ?? 0)],
          ] as const
        ).map(([l, v, s]) => (
          <div key={l} className="surface stat-tile">
            <div className="label">{l}</div>
            <div className="value num">{v}</div>
            <div className="sub">{s}</div>
          </div>
        ))}
      </div>
      <div className={`surface table-card ${detail.isPlaceholderData ? 'refreshing' : 'settled'}`}>
        <Table<SupplierPrice>
          rowKey="supplier_id"
          loading={detail.isLoading}
          pagination={false}
          dataSource={h?.suppliers}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: `No ${itemName(item ?? '').toLowerCase()} bought in this period` }}
          onRow={(s) => ({ onClick: () => setOpen(s), className: 'clickable' })}
          columns={[
            {
              title: 'Supplier',
              render: (_, s, i) => (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b>{s.name}</b>
                  {i === 0 && (h?.suppliers.length ?? 0) > 1 && <Tag color="success">Best price</Tag>}
                </span>
              ),
            },
            { title: 'Bills', dataIndex: 'bills', align: 'right' },
            { title: 'Quantity', align: 'right', render: (_, s) => <span className="num">{formatQty(s.qty, unit)}</span> },
            { title: 'Their average', align: 'right', render: (_, s) => <span className="num strong">{formatRateIn(s.avg_rate, unit)}</span> },
            {
              title: 'vs average',
              align: 'right',
              render: (_, s) => (
                <span className="num strong" style={{ color: s.diff_pct <= 0 ? '#1F9D6B' : '#D4380D' }}>
                  {s.diff_pct <= 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} {formatPercent(Math.abs(s.diff_pct), 1)}
                </span>
              ),
            },
            { title: 'Range', align: 'right', render: (_, s) => <span className="num faint">{`${formatRateIn(s.min_rate, unit)} – ${formatRateIn(s.max_rate, unit)}`}</span> },
            {
              title: <Tooltip title="(average − their price) × quantity. Positive: they cost less than the average.">Saving · ROI</Tooltip>,
              align: 'right',
              render: (_, s) => (
                <span className="num" style={{ color: s.saving >= 0 ? '#1F9D6B' : '#D4380D', fontWeight: 800 }}>
                  {s.saving >= 0 ? '' : '−'}
                  {formatINR(Math.abs(s.saving))} <span className="faint">· {formatPercent(s.roi_pct, 1)}</span>
                </span>
              ),
            },
            { key: 'go', width: 32, render: () => <RightOutlined className="faint" /> },
          ]}
        />
      </div>
      {company && <SupplierDrawer company={company} history={h} supplier={open} bucket={bucket} onClose={() => setOpen(null)} />}
    </div>
  )
}
