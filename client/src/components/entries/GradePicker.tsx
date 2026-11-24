import { Radio } from 'antd'
import { GRADES } from '../../data/grades'
import type { Grade } from '../../types/entries'

interface Props {
  value?: Grade
  onChange?: (g: Grade) => void
  disabled?: boolean
}

/** Choose Grade A, B or C. Works inside Form.Item. */
export default function GradePicker({ value, onChange, disabled }: Props) {
  return (
    <Radio.Group value={value} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} className="grade-pick">
      {GRADES.map((g) => {
        const on = value === g.id
        return (
          <Radio key={g.id} value={g.id} className="grade-pick-option" style={{ border: `1.5px solid ${on ? g.fg : '#e6e8ec'}`, background: on ? g.bg : '#fff' }}>
            <div style={{ fontWeight: 800, color: on ? g.fg : '#1f2329' }}>{g.name}</div>
          </Radio>
        )
      })}
    </Radio.Group>
  )
}
