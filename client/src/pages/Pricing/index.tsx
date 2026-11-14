import { useMemo, useState } from 'react'
import { Segmented, Table, Tag, Tooltip } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, RightOutlined } from '@ant-design/icons'
import PriceChart from '../../components/charts/PriceChart'
import { PageHeader, SectionTitle } from '../../components/ui'
import { companyItems, itemName } from '../../data/catalog'
import { usePrices } from '../../hooks/queries/reports'
import { usePeriod } from '../../hooks/usePeriod'
import { useReportCompany } from '../../hooks/useReportCompany'
import type { SupplierPrice, TradeSide } from '../../types/reports'
import { formatINR, formatPercent, formatQty, formatRateIn } from '../../utils/format'
import { bucketFor } from '../../utils/period'
import SupplierDrawer from './SupplierDrawer'

/** Car and truck tyres side by side when the company buys both; otherwise its first two items. */
function comparedItems(inputs: string[]) {
  const preferred = ['car', 'truck'].filter((i) => inputs.includes(i))
  return preferred.length === 2 ? preferred : inputs.slice(0, 2)
}

const WORDS = {
  purchase: { title: 'Purchase prices', party: 'supplier', parties: 'Suppliers', low: 'Lowest paid', high: 'Highest paid', total: 'Bought', done: 'bought', gain: 'Saving · ROI', gainHint: '(average rate − their rate) × quantity. A plus figure means they are cheaper than average.' },
  sale: { title: 'Sale prices', party: 'buyer', parties: 'Buyers', low: 'Lowest sold at', high: 'Highest sold at', total: 'Sold', done: 'sold', gain: 'Extra earned · ROI', gainHint: '(their rate − average rate) × quantity. A plus figure means they pay more than average.' },
}

/**
 * Price history: each supplier (purchases) or buyer (sales) against the weighted average, per item.
 * Purchases compare the company's raw materials, sales its products.
 */
export default function Pricing({ side = 'purchase' }: { side?: TradeSide }) {
  const w = WORDS[side]
  const { label, range, subtitle } = usePeriod()
  const { company } = useReportCompany('view_finance')
  const inputs = useMemo(() => (company ? companyItems(company)[side === 'purchase' ? 'inputs' : 'products'].map((i) => i.id) : []), [company, side])
  const [pickedItem, setItem] = useState<string>()
  const item = pickedItem && inputs.includes(pickedItem) ? pickedItem : inputs[0]
  const [left, right] = comparedItems(inputs)
  const bucket = bucketFor(range, true)
  const a = usePrices(company?.id, left, range, side)
  const b = usePrices(company?.id, right, range, side)
  const detail = usePrices(company?.id, item, range, side)
  // A lower rate is better when buying, a higher one when selling.
  const good = (diff: number) => (side === 'purchase' ? diff <= 0 : diff >= 0)
  const [open, setOpen] = useState<SupplierPrice | null>(null)
  const h = detail.data
  const unit = h?.unit ?? 'kg'

  return (
    <div className="page">
      <PageHeader
        title={w.title}
        subtitle={`Each ${w.party}'s rate compared to the average · ${label} (${subtitle}) · Grade C bills not included`}
      />

      <div className={right ? 'grid grid-2' : 'grid'}>
        {left && <PriceChart title={`${itemName(left)} · price history`} history={a.data} bucket={bucket} loading={a.isLoading} refreshing={a.isPlaceholderData} />}
        {right && <PriceChart title={`${itemName(right)} · price history`} history={b.data} bucket={bucket} loading={b.isLoading} refreshing={b.isPlaceholderData} />}
      </div>

      <SectionTitle
        title={`${w.parties} against the average`}
        hint={`click a ${w.party} for their price history`}
        extra={inputs.length > 1 && <Segmented value={item} onChange={setItem} options={inputs.map((i) => ({ value: i, label: itemName(i) }))} />}
      />
      <div className="grid grid-4 stagger" style={{ marginBottom: 16 }}>
        {(
          [
            ['Average price', h?.avg_rate ? formatRateIn(h.avg_rate, unit) : '—', 'weighted by quantity'],
            [w.low, h?.min_rate ? formatRateIn(h.min_rate, unit) : '—', 'single bill'],
            [w.high, h?.max_rate ? formatRateIn(h.max_rate, unit) : '—', 'single bill'],
            [w.total, formatQty(h?.qty ?? 0, unit), formatINR(h?.amount ?? 0)],
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
          locale={{ emptyText: `No ${itemName(item ?? '').toLowerCase()} ${w.done} in this period` }}
          onRow={(s) => ({ onClick: () => setOpen(s), className: 'clickable' })}
          columns={[
            {
              title: side === 'purchase' ? 'Supplier' : 'Buyer',
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
                <span className="num strong" style={{ color: good(s.diff_pct) ? '#1F9D6B' : '#D4380D' }}>
                  {s.diff_pct <= 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} {formatPercent(Math.abs(s.diff_pct), 1)}
                </span>
              ),
            },
            { title: 'Range', align: 'right', render: (_, s) => <span className="num faint">{`${formatRateIn(s.min_rate, unit)} – ${formatRateIn(s.max_rate, unit)}`}</span> },
            {
              title: <Tooltip title={w.gainHint}>{w.gain}</Tooltip>,
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
      {company && <SupplierDrawer side={side} company={company} history={h} supplier={open} bucket={bucket} onClose={() => setOpen(null)} />}
    </div>
  )
}
