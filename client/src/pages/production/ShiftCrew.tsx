import { useState } from 'react'
import { Button, Divider, Input, InputNumber, Select, Space } from 'antd'
import { PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { useAddOperator, useOperators } from '../../hooks/queries/companies'
import { SHIFT_HOURS } from '../../data/catalog'
import { formatPercent } from '../../utils/format'
import { requiredMark } from '../../utils/formMarks'

interface Props {
  companyId: number | undefined
  /** The shift chosen on the form: its operators are listed first, and new ones join it. */
  shift: number
  crew: number[]
  onCrew: (ids: number[]) => void
  hours: number | null
  onHours: (h: number | null) => void
}

const SHIFTS = [1, 2, 3]

/** The production in-charge picks who ran the shift (or adds them by name) and how long the plant actually ran. */
export default function ShiftCrew({ companyId, shift, crew, onCrew, hours, onHours }: Props) {
  const operators = useOperators(companyId)
  const add = useAddOperator(companyId)
  const [search, setSearch] = useState('')
  const [newShift, setNewShift] = useState<number | null>(null)
  const efficiency = hours ? (hours / SHIFT_HOURS) * 100 : null

  const name = search.trim()
  const addTo = newShift ?? shift
  const taken = operators.data?.some((o) => o.name.toLowerCase() === name.toLowerCase())
  const order = [shift, ...SHIFTS.filter((s) => s !== shift), null]
  const options = order
    .map((s) => ({
      label: s === null ? 'No shift set' : `Shift ${s}`,
      options: (operators.data ?? []).filter((o) => o.shift === s).map((o) => ({ value: o.id, label: o.name })),
    }))
    .filter((g) => g.options.length)

  const addOperator = () => {
    if (!name || taken) return
    add.mutate(
      { name, shift: addTo },
      {
        onSuccess: (op) => {
          onCrew([...crew, op.id])
          setSearch('')
          setNewShift(null)
        },
      },
    )
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 24, marginTop: 24 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{requiredMark('Operators on this shift', { required: false })}</div>
        <Select<number[]>
          mode="multiple"
          size="large"
          value={crew}
          onChange={onCrew}
          loading={operators.isLoading}
          disabled={!companyId}
          placeholder={companyId ? 'Choose or type a name to add' : 'Choose the company first'}
          suffixIcon={<TeamOutlined />}
          showSearch={{ optionFilterProp: 'label', searchValue: search, onSearch: setSearch, autoClearSearchValue: false }}
          style={{ width: '100%' }}
          maxTagCount="responsive"
          options={options}
          notFoundContent={name ? null : 'No operators yet. Type a name to add one.'}
          popupRender={(menu) => (
            <>
              {menu}
              <Divider style={{ margin: '6px 0' }} />
              <Space.Compact style={{ width: '100%', padding: '0 6px 6px' }}>
                <Input
                  placeholder="New operator name"
                  value={search}
                  maxLength={100}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') addOperator()
                  }}
                />
                <Select<number>
                  value={addTo}
                  onChange={setNewShift}
                  style={{ width: 110 }}
                  // Keep its list inside this popup, so picking a shift does not close it.
                  getPopupContainer={(el) => el.parentElement ?? document.body}
                  options={SHIFTS.map((s) => ({ value: s, label: `Shift ${s}` }))}
                />
                <Button type="primary" icon={<PlusOutlined />} disabled={!name || taken} loading={add.isPending} onClick={addOperator}>
                  Add
                </Button>
              </Space.Compact>
            </>
          )}
        />
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          {taken ? `${name} is already in the list.` : 'New name? Type it and press Add. No login needed.'}
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
