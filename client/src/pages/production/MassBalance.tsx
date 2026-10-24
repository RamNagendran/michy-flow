import { Formula, type FormulaPart } from '../../components/ui'
import { WASTAGE_ALERT_PCT } from '../../data/catalog'
import { formatKg, formatPercent } from '../../utils/format'
import type { Balance } from '../../utils/production'

export default function MassBalance({ b }: { b: Balance }) {
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 12, padding: '14px 18px' }}>
      <Formula
        parts={([
          { label: 'Taken from stock', value: formatKg(b.takenKg), kind: 'in' },
          ...(b.returnedKg ? [{ op: '−', label: 'Returned to stock', value: formatKg(b.returnedKg), kind: 'out' as const }] : []),
          { op: '−', label: 'Weight out (oil by density)', value: formatKg(b.outputKg), kind: 'out' },
          { op: '=', label: `Missing · ${formatPercent(Math.max(b.missingPct, 0))}`, value: formatKg(Math.max(b.missingKg, 0)), kind: 'result' },
        ] as FormulaPart[])}
      />
      <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>
        Stock goes down by the processed weight ({formatKg(b.processedKg)}). Missing weight over {WASTAGE_ALERT_PCT}% of it is flagged as waste for the Admin.
      </div>
    </div>
  )
}
