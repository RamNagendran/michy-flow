import { Formula } from '../../components/ui'
import type { WastageType } from '../../types/entries'
import { formatKgFine } from '../../utils/format'
import { rawMaterialUsed, wastageTypeLabel } from '../../utils/production'

/** Products + wastage = raw material used. Without wastage, only the products total. */
export default function MassBalance({ outputKg, wastageKg = 0, wastageType }: { outputKg: number; wastageKg?: number; wastageType?: WastageType | null }) {
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 12, padding: '14px 18px' }}>
      <Formula
        parts={[
          { label: 'Products total', value: formatKgFine(outputKg), kind: wastageKg ? 'in' : 'result' },
          ...(wastageKg
            ? [
                { op: '+' as const, label: `Wastage${wastageType ? ` · ${wastageTypeLabel[wastageType]}` : ''}`, value: formatKgFine(wastageKg), kind: 'out' as const },
                { op: '=' as const, label: 'Raw material used', value: formatKgFine(rawMaterialUsed(outputKg, wastageKg)), kind: 'result' as const },
              ]
            : []),
        ]}
      />
    </div>
  )
}
