import { InputNumber } from 'antd'
import { itemColor, itemName } from '../../data/catalog'
import { kgInputProps } from '../../utils/format'
import { typeMaterial } from '../../utils/production'

/** How much of each raw material went in. Shared equally to start; the person can change any line. */
export default function MaterialSplit({
  total,
  split,
  typed,
  onTyped,
  available,
  size = 'large',
}: {
  total: number
  split: Record<string, number>
  typed: Record<string, number | null>
  onTyped: (typed: Record<string, number | null>) => void
  available?: (id: string) => number | undefined
  size?: 'large' | 'middle'
}) {
  const ids = Object.keys(split)
  return (
    <div className="grid grid-3" style={{ gap: 12 }}>
      {ids.map((id) => {
        const bad = split[id] <= 0 || (!!available && split[id] > (available(id) ?? Infinity))
        return (
          <div key={id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6 }}>
              <span className="legend-dot" style={{ background: itemColor(id) }} />
              {itemName(id)}
            </div>
            <InputNumber<number> size={size} value={split[id]} onChange={(v) => onTyped(typeMaterial(typed, ids, id, v))} style={{ width: '100%' }} status={bad ? 'error' : undefined} {...kgInputProps} precision={0} />
            <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
              {total > 0 ? `${Math.round((split[id] / total) * 100)}% of the total` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
