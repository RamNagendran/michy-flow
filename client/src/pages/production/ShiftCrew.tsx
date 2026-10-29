import { InputNumber, Select } from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { useCrew } from '../../hooks/queries/companies'
import { SHIFT_HOURS } from '../../data/catalog'
import { formatPercent } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

interface Props {
  companyId: number | undefined
  crew: number[]
  onCrew: (ids: number[]) => void
  hours: number | null
  onHours: (h: number | null) => void
}

/** The production in-charge picks who ran the shift and how long the plant actually ran. */
export default function ShiftCrew({ companyId, crew, onCrew, hours, onHours }: Props) {
  const operators = useCrew(companyId)
  const efficiency = hours ? (hours / SHIFT_HOURS) * 100 : null
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 24, marginTop: 24 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{requiredMark('Shift workers on this shift', { required: false })}</div>
        <Select<number[]>
          mode="multiple"
          size="large"
          value={crew}
          onChange={onCrew}
          loading={operators.isLoading}
          disabled={!companyId}
          placeholder={companyId ? 'Choose who worked on this shift' : 'Choose the company first'}
          suffixIcon={<TeamOutlined />}
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: '100%' }}
          maxTagCount="responsive"
          options={operators.data?.map((o) => ({ value: o.id, label: o.name }))}
          notFoundContent="No shift workers yet. Ask the Super Admin to tick 'Shift worker' for them in Settings → Users."
        />
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          Only people ticked as "Shift worker" are shown here.
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{requiredMark('Running hours', { required: false })}</div>
        <InputNumber<number> size="large" value={hours} onChange={onHours} min={0.25} max={24} step={0.5} precision={2} suffix="hours" placeholder={`of ${SHIFT_HOURS}`} style={{ width: '100%' }} />
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          {efficiency === null ? `How long the plant ran, out of a ${SHIFT_HOURS}-hour shift` : `${formatPercent(efficiency, 0)} of the shift`}
        </div>
      </div>
    </div>
  )
}
