import { ChartFrame, flowColors, LineChart } from '../../charts'
import { HintButton, SectionTitle } from '../ui'
import { OIL_DENSITY } from '../../data/catalog'
import type { Bucket, OilKpi, OilStatus } from '../../types/reports'
import { periodLabel } from '../../utils/period'
import { formatKg, formatPercent, formatQty } from '../../utils/format'

const statusText: Record<OilStatus, string> = {
  green: 'On target',
  amber: 'Just under target',
  red: 'Below target',
  none: 'No production yet',
}
const pointName: Record<Bucket, string> = { day: 'day', week: 'week', month: 'month', year: 'year' }
const statusColor: Record<OilStatus, string> = { green: '#1F9D6B', amber: '#D98A0B', red: '#D4380D', none: '#8A919E' }

/** Everything about the oil KPI in one hover panel: what it is, how it is worked out, the colours. */
function OilKpiHint({ kpi, bucket }: { kpi: OilKpi | null; bucket: Bucket }) {
  const green = kpi?.green_at ?? 40
  const red = kpi?.red_below ?? 39
  const oilL = kpi?.oil_l ?? 0
  const oilKg = kpi?.oil_kg ?? 0
  const processed = kpi?.processed_kg ?? 0
  // The weight per litre actually used; each company has its own, so all companies together is a mix.
  const density = oilL ? oilKg / oilL : OIL_DENSITY.default
  return (
    <HintButton title="Oil KPI · how it works">
      <h4>What it shows</h4>
      <p>How much oil we get from the tyres we put into the plant. A higher % means more oil from the same tyres.</p>

      <h4>Oil %</h4>
      <div className="formula">Oil % = Oil made (kg) ÷ Weight processed (kg) × 100</div>
      {processed > 0 && (
        <p>
          This period: {formatKg(oilKg)} ÷ {formatKg(processed)} × 100 = <b>{formatPercent(kpi?.pct ?? 0)}</b>
        </p>
      )}

      <h4>Oil made</h4>
      <p>All oil entered in production entries. Oil is measured in litres, so it is changed to kg to compare it with the tyres.</p>
      <div className="formula">Oil (kg) = Oil (litres) × weight of 1 litre</div>
      <p>
        {oilL > 0 ? (
          <>
            This period: {formatQty(oilL, 'L')} × {density.toFixed(3)} kg = <b>{formatKg(oilKg)}</b>.{' '}
          </>
        ) : null}
        The weight of 1 litre is set for each company by the Super Admin (between {OIL_DENSITY.min} and {OIL_DENSITY.max} kg, normally {OIL_DENSITY.default} kg).
      </p>

      <h4>Weight processed</h4>
      <p>The tyres actually used in production:</p>
      <div className="formula">Weight processed = Tyres taken from stock − Tyres sent back to stock</div>
      <p>It includes everything that came out of those tyres: oil, carbon, steel, waste water and wastage.</p>

      <h4>Colours</h4>
      <ul>
        <li><span className="swatch" style={{ background: statusColor.green }} />Green: {green}% or more. On target.</li>
        <li><span className="swatch" style={{ background: statusColor.amber }} />Orange: {red}% to {green}%. Just under target.</li>
        <li><span className="swatch" style={{ background: statusColor.red }} />Red: below {red}%. Please check the plant.</li>
      </ul>

      <h4>The chart</h4>
      <p>
        Each point is one {pointName[bucket]}: that period's oil ÷ weight processed. The green line is the {green}% target. The pink area is below {red}%. A gap means nothing was processed then.
      </p>

      <h4>Which entries count</h4>
      <p>All saved production entries, also those still waiting for approval. Rejected and deleted entries do not count. It follows the period picked at the top.</p>

      <h4>Who can see it</h4>
      <p>Only the CEO, Managers and the Super Admin.</p>
    </HintButton>
  )
}

/** CEO / Manager view: oil out as a share of the weight processed, against the 40% target. */
export default function OilKpiPanel({ kpi, bucket, loading, refreshing }: { kpi: OilKpi | null; bucket: Bucket; loading?: boolean; refreshing?: boolean }) {
  if (!kpi && !loading) return null
  const status = kpi?.status ?? 'none'
  const pct = kpi?.pct ?? 0
  const scaleMax = Math.max(60, Math.ceil(pct / 10) * 10)
  return (
    <>
    <SectionTitle title={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Oil KPI <OilKpiHint kpi={kpi} bucket={bucket} /></span>} />
    <div className="oil-kpi">
      <div className="surface chart-card fade-in" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="chart-title">Oil production</div>
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
      </div>
      <ChartFrame
        title="Oil % over time"
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
    </>
  )
}
