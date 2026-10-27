import { Formula } from '../../components/ui'
import { WASTAGE_ALERT_PCT } from '../../data/catalog'
import { formatKg, formatKgFine } from '../../utils/format'
import type { Balance } from '../../utils/production'

/** Products + 2% wastage = raw material used, worked out from what came out. */
export default function MassBalance({ b }: { b: Balance }) {
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 12, padding: '14px 18px' }}>
      <Formula
        parts={[
          { label: 'Products total', value: formatKgFine(b.outputKg), kind: 'in' },
          { op: '+', label: `Wastage ${WASTAGE_ALERT_PCT}%`, value: formatKgFine(b.outputWastageKg), kind: 'out' },
          { op: '=', label: `Raw material used · ${formatKgFine(b.outputKg + b.outputWastageKg)} rounded`, value: formatKg(b.calculatedKg), kind: 'result' },
        ]}
      />
    </div>
  )
}
