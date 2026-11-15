import { InputNumber, Select } from 'antd'
import { TeamOutlined, ToolOutlined } from '@ant-design/icons'
import { useMachines, useOperators } from '../../hooks/queries/plant'
import { SHIFT_HOURS } from '../../data/catalog'
import { formatPercent } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

interface Props {
  companyId: number | undefined
  /** The shift chosen on the form: its operators are listed first. */
  shift: number
  machine: number | null
  onMachine: (id: number) => void
  crew: number[]
  onCrew: (ids: number[]) => void
  hours: number | null
  onHours: (h: number | null) => void
}

const SHIFTS = [1, 2, 3]
const HINT = { fontSize: 12.5, marginTop: 4 }

/** The production in-charge picks the machine, who ran the shift and how long the plant ran. The Manager keeps the lists. */
export default function ShiftCrew({ companyId, shift, machine, onMachine, crew, onCrew, hours, onHours }: Props) {
  const operators = useOperators(companyId)
  const machines = useMachines(companyId)
  const efficiency = hours ? (hours / SHIFT_HOURS) * 100 : null

  const order = [shift, ...SHIFTS.filter((s) => s !== shift), null]
  const options = order
    .map((s) => ({
      label: s === null ? 'No shift set' : `Shift ${s}`,
      options: (operators.data ?? []).filter((o) => o.shift === s).map((o) => ({ value: o.id, label: o.name })),
    }))
    .filter((g) => g.options.length)
  const noMachines = machines.isSuccess && machines.data.length === 0

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 24, marginTop: 24 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{requiredMark('Machine', { required: true })}</div>
          <Select<number>
            size="large"
            value={machine ?? undefined}
            onChange={onMachine}
            loading={machines.isLoading}
            disabled={!companyId}
            placeholder={companyId ? 'Choose the machine' : 'Choose the company first'}
            suffixIcon={<ToolOutlined />}
            showSearch={{ optionFilterProp: 'label' }}
            style={{ width: '100%' }}
            options={(machines.data ?? []).map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))}
            status={noMachines ? 'warning' : undefined}
          />
          <div className="faint" style={HINT}>
            {noMachines ? 'No machines yet. Ask the Manager to add them.' : 'The machine this run was on'}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{requiredMark('Running hours', { required: false })}</div>
          <InputNumber<number> size="large" value={hours} onChange={onHours} min={0.25} max={24} step={0.5} precision={2} suffix="hours" placeholder={`of ${SHIFT_HOURS}`} style={{ width: '100%' }} />
          <div className="faint" style={HINT}>
            {efficiency === null ? `How long the plant ran, out of a ${SHIFT_HOURS}-hour shift` : `${formatPercent(efficiency, 0)} of the shift`}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{requiredMark('Operators on this shift', { required: false })}</div>
        <Select<number[]>
          mode="multiple"
          size="large"
          value={crew}
          onChange={onCrew}
          loading={operators.isLoading}
          disabled={!companyId}
          placeholder={companyId ? 'Choose the operators' : 'Choose the company first'}
          suffixIcon={<TeamOutlined />}
          showSearch={{ optionFilterProp: 'label' }}
          style={{ width: '100%' }}
          maxTagCount="responsive"
          options={options}
          notFoundContent="No operators yet. Ask the Manager to add them."
        />
        <div className="faint" style={HINT}>
          Missing a name? Ask the Manager to add the operator.
        </div>
      </div>
    </>
  )
}
