import { InputNumber, Select } from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { useCrew } from '../../hooks/queries/companies'
import { SHIFT_HOURS } from '../../data/catalog'
import { formatPercent } from '../../utils/format'

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
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Operators on this shift</div>
        <Select<number[]>
          mode="multiple"
          size="large"
          value={crew}
          onChange={onCrew}
          loading={operators.isLoading}
          disabled={!companyId}
          placeholder={companyId ? 'Choose the operators who ran it' : 'Choose the company first'}
          suffixIcon={<TeamOutlined />}
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: '100%' }}
          maxTagCount="responsive"
          options={operators.data?.map((o) => ({ value: o.id, label: o.name }))}
          notFoundContent="No operators in this company yet"
        />
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          Used for shift and operator reports.
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Running hours</div>
        <InputNumber<number> size="large" value={hours} onChange={onHours} min={0.25} max={24} step={0.5} precision={2} suffix="h" placeholder={`of ${SHIFT_HOURS}`} style={{ width: '100%' }} />
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          {efficiency === null ? `How long the plant ran, out of a ${SHIFT_HOURS}-hour shift` : `${formatPercent(efficiency, 0)} of the shift`}
        </div>
      </div>
    </div>
  )
}
