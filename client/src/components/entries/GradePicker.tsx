import { Radio } from 'antd'
import { GRADES, type TradeKind } from '../../data/grades'
import type { Grade } from '../../types/entries'

interface Props {
  kind: TradeKind
  value?: Grade
  onChange?: (g: Grade) => void
  disabled?: boolean
}

/** Choose Grade A, B or C, each explained for a purchase or a sale. Works inside Form.Item. */
export default function GradePicker({ kind, value, onChange, disabled }: Props) {
  return (
    <Radio.Group value={value} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, width: '100%' }}>
      {GRADES.map((g) => {
        const on = value === g.id
        return (
          <Radio
            key={g.id}
            value={g.id}
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1.5px solid ${on ? g.fg : '#e6e8ec'}`,
              background: on ? g.bg : '#fff',
              alignItems: 'flex-start',
            }}
          >
            <div style={{ fontWeight: 800, color: on ? g.fg : '#1f2329' }}>
              {g.name} · {g.short}
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.35 }}>
              {g[kind]}
            </div>
          </Radio>
        )
      })}
    </Radio.Group>
  )
}
