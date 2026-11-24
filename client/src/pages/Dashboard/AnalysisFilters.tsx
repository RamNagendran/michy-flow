import { useState } from 'react'
import { Button, Checkbox, Segmented, Select, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { FilterButton, FilterChips, FilterField, FilterSheet, type FilterChip } from '../../components/FilterSheet'
import { itemName } from '../../data/catalog'
import type { ChartGrouping as Grouping } from '../../hooks/useChartGrouping'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Grade } from '../../types/entries'
import type { Bucket, TradeSide } from '../../types/reports'
import { BUCKET_MAX_DAYS, bucketLabels, rangeSubtitle, type DateRange } from '../../utils/period'

const GRADES = ['A', 'B', 'C'] as const

interface Props {
  side: TradeSide
  onSide: (side: TradeSide) => void
  words: { party: string; parties: string; item: string; items: string }
  grouping: Grouping
  f: {
    filters: { range: DateRange; item?: string; grades: Grade[]; partyKeys: string[] }
    changed: boolean
    setItem: (item: string | undefined) => void
    setGrades: (grades: Grade[]) => void
    setParties: (keys: string[]) => void
    reset: () => void
  }
  itemChoices: string[]
  /** Parties to pick from; only when one company is shown. */
  parties?: { key: string; name: string }[]
  /** The bar has reached the top bar (shows a shadow). */
  stuck: boolean
}

/**
 * The analysis filter bar. On a computer every filter sits in the bar. On a phone the bar keeps only
 * Purchases / Sales and a Filters button; the rest open in a sheet from the bottom, and filters in use show as chips.
 */
export default function AnalysisFilters({ side, onSide, words: w, grouping, f, itemChoices, parties, stuck }: Props) {
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const barClass = `surface filter-bar sticky-filters${stuck ? ' is-stuck' : ''}`
  const sideSwitch = (
    <Segmented<TradeSide> value={side} onChange={onSide} block={mobile} options={[{ value: 'purchase', label: 'Purchases' }, { value: 'sale', label: 'Sales' }]} />
  )
  const bucketSwitch = (
    <Segmented<Bucket>
      value={grouping.bucket}
      onChange={grouping.setBucket}
      block={mobile}
      options={(['day', 'week', 'month', 'year'] as const).map((b) => ({
        value: b,
        disabled: !grouping.allowed.includes(b),
        label: grouping.allowed.includes(b) ? bucketLabels[b] : <Tooltip title={`Only for up to ${BUCKET_MAX_DAYS[b]} days`}>{bucketLabels[b]}</Tooltip>,
      }))}
    />
  )
  const itemOptions = [{ value: '', label: `All ${w.items}` }, ...itemChoices.map((i) => ({ value: i, label: itemName(i) }))]
  const partyOptions = (parties ?? []).map((p) => ({ value: p.key, label: p.name }))

  if (!mobile)
    return (
      <div className={barClass}>
        {sideSwitch}
        <span className="filter-divider" />
        <Tooltip title="Change the dates in the top bar of the screen">
          <span className="filter-dates num">{rangeSubtitle(f.filters.range)}</span>
        </Tooltip>
        <span className="filter-label">Chart by</span>
        {bucketSwitch}
        <Select prefix={<span className="filter-label">{w.item}</span>} style={{ width: 230 }} value={f.filters.item ?? ''} onChange={(i) => f.setItem(i || undefined)} options={itemOptions} />
        <Select<Grade[]>
          mode="multiple"
          prefix={<span className="filter-label">Grade</span>}
          maxTagCount="responsive"
          style={{ width: 200 }}
          value={f.filters.grades}
          onChange={(g) => g.length && f.setGrades(g)}
          options={GRADES.map((g) => ({ value: g, label: g }))}
        />
        {parties && (
          <Select
            mode="multiple"
            allowClear
            prefix={<span className="filter-label">{w.party}</span>}
            maxTagCount="responsive"
            style={{ width: 240 }}
            placeholder="All"
            value={f.filters.partyKeys}
            onChange={f.setParties}
            optionFilterProp="label"
            options={partyOptions}
          />
        )}
        {f.changed && (
          <Button type="text" icon={<ReloadOutlined />} onClick={f.reset}>
            Reset
          </Button>
        )}
      </div>
    )

  // Filters in use, each removable on its own.
  const { item, grades, partyKeys } = f.filters
  const chips: FilterChip[] = [
    grouping.picked && { key: 'bucket', label: bucketLabels[grouping.bucket], clear: grouping.reset },
    item && { key: 'item', label: itemName(item), clear: () => f.setItem(undefined) },
    grades.join() !== 'A,B' && { key: 'grade', label: `Grade ${grades.join(', ')}`, clear: () => f.setGrades(['A', 'B']) },
    partyKeys.length > 0 && {
      key: 'party',
      label: partyKeys.length === 1 ? (parties?.find((p) => p.key === partyKeys[0])?.name ?? w.party) : `${partyKeys.length} ${w.parties.toLowerCase()}`,
      clear: () => f.setParties([]),
    },
  ].filter((c) => !!c)

  return (
    <>
      <div className={`${barClass} m-filter-bar`}>
        <div className="m-filter-row">
          <div style={{ flex: 1, minWidth: 0 }}>{sideSwitch}</div>
          <FilterButton label="Chart options" count={chips.length} onClick={() => setOpen(true)} />
        </div>
        <FilterChips chips={chips} />
      </div>

      <FilterSheet title="Chart options" open={open} onClose={() => setOpen(false)} onReset={f.reset} canReset={f.changed}>
        <FilterField label="Dates">
          <div className="num">{rangeSubtitle(f.filters.range)}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            Change the dates at the top of the screen.
          </div>
        </FilterField>
        <FilterField label="Chart by">{bucketSwitch}</FilterField>
        <FilterField label={w.item}>
          <Select style={{ width: '100%' }} value={item ?? ''} onChange={(i) => f.setItem(i || undefined)} options={itemOptions} />
        </FilterField>
        <FilterField label="Grade">
          <Checkbox.Group<Grade> value={grades} onChange={(g) => g.length && f.setGrades(g)} options={GRADES.map((g) => ({ value: g, label: `Grade ${g}` }))} />
        </FilterField>
        {parties && (
          <FilterField label={w.parties}>
            <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="All" value={partyKeys} onChange={f.setParties} optionFilterProp="label" options={partyOptions} />
          </FilterField>
        )}
      </FilterSheet>
    </>
  )
}
