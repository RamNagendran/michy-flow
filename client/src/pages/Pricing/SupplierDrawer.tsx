import { Drawer } from 'antd'
import PriceChart from '../../components/charts/PriceChart'
import EntryTable from '../../components/entries/EntryTable'
import { itemName } from '../../data/catalog'
import type { Company } from '../../types/auth'
import type { Bucket, PriceHistory, SupplierPrice } from '../../types/reports'
import { formatDate, formatINR, formatPercent, formatQty, formatRateIn } from '../../utils/format'

/** One supplier: their price against the average over time, the numbers, and their bills. */
export default function SupplierDrawer({ company, history, supplier, bucket, onClose }: { company: Company; history: PriceHistory | undefined; supplier: SupplierPrice | null; bucket: Bucket; onClose: () => void }) {
  const unit = history?.unit ?? 'kg'
  const s = supplier
  return (
    <Drawer open={!!s} onClose={onClose} width={760} title={s ? `${s.name} · ${itemName(history?.item ?? '')}` : ''} destroyOnHidden>
      {s && (
        <div className="fade-in">
          <div className="grid grid-4" style={{ gap: 10, marginBottom: 16 }}>
            {(
              [
                ['Their average', formatRateIn(s.avg_rate, unit), `${s.diff_pct > 0 ? '+' : ''}${formatPercent(s.diff_pct, 1)} vs average`],
                ['Market average', history?.avg_rate ? formatRateIn(history.avg_rate, unit) : '—', 'all suppliers, weighted'],
                ['Last price', formatRateIn(s.last_rate, unit), formatDate(s.last_date)],
                [s.saving >= 0 ? 'Saved vs average' : 'Paid over average', formatINR(Math.abs(s.saving)), `ROI ${formatPercent(s.roi_pct, 1)} on ${formatQty(s.qty, unit)}`],
              ] as const
            ).map(([label, value, sub], i) => (
              <div key={label} className="surface stat-tile">
                <div className="label">{label}</div>
                <div className="value num" style={{ fontSize: 20, color: i === 3 ? (s.saving >= 0 ? '#1F9D6B' : '#D4380D') : undefined }}>
                  {value}
                </div>
                <div className="sub">{sub}</div>
              </div>
            ))}
          </div>
          <PriceChart title="Price history" sub={`${s.name} against the average, ₹ per ${unit === 'L' ? 'litre' : 'kg'}`} history={history} bucket={bucket} suppliers={[s.supplier_id]} height={240} />
          <div className="strong" style={{ fontSize: 15, margin: '20px 0 10px' }}>
            Their bills
          </div>
          <div className="surface table-card">
            <EntryTable types={['purchase']} companies={[company]} partyId={s.supplier_id} item={history?.item} pageSize={8} compact />
          </div>
        </div>
      )}
    </Drawer>
  )
}
