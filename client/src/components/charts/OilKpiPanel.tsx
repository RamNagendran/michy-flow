import { ChartFrame, flowColors, LineChart } from '../../charts'
import type { Bucket, OilKpi, OilStatus } from '../../types/reports'
import { formatKg, formatPercent, formatQty } from '../../utils/format'
import { periodLabel } from '../../utils/period'

const statusText: Record<OilStatus, string> = {
  green: 'On target',
  amber: 'Just under target',
  red: 'Below target',
  none: 'No production yet',
}
const statusColor: Record<OilStatus, string> = { green: '#1F9D6B', amber: '#D98A0B', red: '#D4380D', none: '#8A919E' }

/** CEO / Manager view: oil out as a share of the weight processed, against the 40% target. */
export default function OilKpiPanel({ kpi, bucket, loading, refreshing }: { kpi: OilKpi | null; bucket: Bucket; loading?: boolean; refreshing?: boolean }) {
  if (!kpi && !loading) return null
  const status = kpi?.status ?? 'none'
  const pct = kpi?.pct ?? 0
  const scaleMax = Math.max(60, Math.ceil(pct / 10) * 10)
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 16 }}>
      <div className="surface chart-card fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="chart-title">Oil production</div>
        <div className="chart-sub">Oil out (by weight) ÷ weight processed</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 18 }}>
          <span className="num" style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', color: statusColor[status], lineHeight: 1 }}>
            {formatPercent(pct)}
          </span>
          <span className={`signal ${status}`}>
            <i style={{ width: 8, height: 8, borderRadius: 99, background: 'currentColor', display: 'inline-block' }} />
            {statusText[status]}
          </span>
        </div>
        <div className="meter" style={{ marginTop: 18 }} aria-label={`Oil ${formatPercent(pct)} against a ${kpi?.green_at ?? 40}% target`}>
          <i style={{ width: `${Math.min(pct / scaleMax, 1) * 100}%`, background: statusColor[status] }} />
          <b style={{ left: `${((kpi?.green_at ?? 40) / scaleMax) * 100}%` }} />
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>0%</span>
          <span>Target {kpi?.green_at ?? 40}%</span>
          <span>{scaleMax}%</span>
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>Oil produced</div>
            <div className="num strong">{formatQty(kpi?.oil_l ?? 0, 'L')}</div>
            <div className="faint num" style={{ fontSize: 12 }}>{formatKg(kpi?.oil_kg ?? 0)}</div>
          </div>
          <div>
            <div className="faint" style={{ fontSize: 12, fontWeight: 700 }}>Processed</div>
            <div className="num strong">{formatKg(kpi?.processed_kg ?? 0)}</div>
          </div>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 12 }}>
          Green at {kpi?.green_at ?? 40}% or more · red under {kpi?.red_below ?? 39}% · visible to the CEO and Managers only
        </div>
      </div>
      <ChartFrame
        title="Oil % over time"
        sub={`Each point is that period's oil weight ÷ weight processed · target ${kpi?.green_at ?? 40}%`}
        loading={loading}
        refreshing={refreshing}
        empty={!kpi?.series.some((p) => p.processed_kg > 0)}
        height={240}
        table={{ columns: ['Period', 'Oil %', 'Oil', 'Processed'], rows: (kpi?.series ?? []).map((p) => [periodLabel(p.period, bucket), formatPercent(p.pct), formatQty(p.oil_l, 'L'), formatKg(p.processed_kg)]) }}
      >
        <LineChart
          // A period with nothing processed has no oil % (a gap), not 0%.
          data={(kpi?.series ?? []).map((p) => ({ label: periodLabel(p.period, bucket), pct: p.processed_kg > 0 ? p.pct : null }))}
          categoryField="label"
          series={[{ field: 'pct', name: 'Oil %', color: flowColors.oil }]}
          format={(v) => formatPercent(v)}
          min={0}
          max={scaleMax}
          target={{ value: kpi?.green_at ?? 40, label: `Target ${kpi?.green_at ?? 40}%`, color: flowColors.good }}
          band={{ from: 0, to: kpi?.red_below ?? 39, color: flowColors.critical }}
          height={240}
        />
      </ChartFrame>
    </div>
  )
}
