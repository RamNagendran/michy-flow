import { useMemo, useState } from 'react'
import { Button, Select } from 'antd'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ChartCard from '../../components/charts/ChartCard'
import { ANIMATION_MS, axisProps, gridProps, reportColors, shortKg, xTick } from '../../components/charts/chartKit'
import ChartTooltip from '../../components/ChartTooltip'
import { FilterButton, FilterChips, FilterField, FilterSheet, type FilterChip } from '../../components/FilterSheet'
import { HintButton, PageHeader, SectionTitle } from '../../components/ui'
import { useMachines, useOperators } from '../../hooks/queries/plant'
import { usePlantReport } from '../../hooks/queries/reports'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePeriod } from '../../hooks/usePeriod'
import { useReportCompany } from '../../hooks/useReportCompany'
import type { PlantFilters } from '../../types/reports'
import { formatKg, formatPercent } from '../../utils/format'
import { periodLabel } from '../../utils/period'
import RankingCard, { Efficiency } from './RankingCard'

const NO_FILTERS: PlantFilters = { shift: [], machine_id: [], operator_id: [] }

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="surface stat-tile lift">
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

/** How each operator and machine performed in the header's period and company. Manager and Super Admin only. */
export default function PlantAnalytics() {
  const { label, range, subtitle } = usePeriod()
  const { company } = useReportCompany('view_plant_analytics')
  const [filters, setFilters] = useState<PlantFilters>(NO_FILTERS)
  const mobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)
  const operators = useOperators(company?.id)
  const machines = useMachines(company?.id)
  const report = usePlantReport(company?.id, range, filters)
  const data = report.data
  const t = data?.totals
  const filtered = filters.shift.length + filters.machine_id.length + filters.operator_id.length > 0
  const set = (patch: Partial<PlantFilters>) => setFilters((f) => ({ ...f, ...patch }))
  // Clicking a bar or row narrows the page to that one; clicking it again clears it.
  const pick = (key: 'operator_id' | 'machine_id') => (id: number) => set({ [key]: filters[key].length === 1 && filters[key][0] === id ? [] : [id] })
  const trend = useMemo(() => data?.trend ?? [], [data])
  const machineName = (id: number) => machines.data?.find((m) => m.id === id)?.code ?? 'Machine'
  const operatorName = (id: number) => operators.data?.find((o) => o.id === id)?.name ?? 'Operator'
  // On a phone: filters in use as chips; the pickers themselves are in the sheet.
  const chips: FilterChip[] = [
    filters.shift.length > 0 && { key: 'shift', label: `Shift ${filters.shift.slice().sort().join(', ')}`, clear: () => set({ shift: [] }) },
    filters.machine_id.length > 0 && { key: 'machine', label: filters.machine_id.length === 1 ? machineName(filters.machine_id[0]) : `${filters.machine_id.length} machines`, clear: () => set({ machine_id: [] }) },
    filters.operator_id.length > 0 && { key: 'operator', label: filters.operator_id.length === 1 ? operatorName(filters.operator_id[0]) : `${filters.operator_id.length} operators`, clear: () => set({ operator_id: [] }) },
  ].filter((c) => !!c)
  const shiftSelect = (style: React.CSSProperties) => (
    <Select<number[]> mode="multiple" allowClear placeholder="All shifts" value={filters.shift} onChange={(shift) => set({ shift })} style={style} options={[1, 2, 3].map((s) => ({ value: s, label: `Shift ${s}` }))} />
  )
  const machineSelect = (style: React.CSSProperties) => (
    <Select<number[]>
      mode="multiple"
      allowClear
      placeholder="All machines"
      value={filters.machine_id}
      onChange={(machine_id) => set({ machine_id })}
      style={style}
      maxTagCount="responsive"
      loading={machines.isLoading}
      showSearch={{ optionFilterProp: 'label' }}
      options={(machines.data ?? []).map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))}
    />
  )
  const operatorSelect = (style: React.CSSProperties) => (
    <Select<number[]>
      mode="multiple"
      allowClear
      placeholder="All operators"
      value={filters.operator_id}
      onChange={(operator_id) => set({ operator_id })}
      style={style}
      maxTagCount="responsive"
      loading={operators.isLoading}
      showSearch={{ optionFilterProp: 'label' }}
      options={(operators.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
    />
  )
  const loading = report.isLoading
  const refreshing = report.isPlaceholderData

  return (
    <div className="page">
      <PageHeader
        title="Operators & machines"
        subtitle={`${label} · ${subtitle} · ${company?.name ?? ''}`}
        extra={
          <HintButton title="How these figures work">
            <p>Every operator on a run gets the whole run: its hours, its processed kg and its output. So operator totals can add up to more than the company total.</p>
            <p>Each run is on one machine. Runs saved before machines were added show as “No machine”.</p>
            <p>
              kg per hour counts only runs that logged running hours. Efficiency is running hours ÷ {data?.shift_hours ?? 8} planned hours per run: green is 85% or more, amber 65% or more, red below.
            </p>
            <p>Wastage % is wastage kg out of processed kg. Click a bar or a row to see only that operator or machine.</p>
          </HintButton>
        }
      />

      {mobile ? (
        <div className="surface m-list-filters" style={{ marginBottom: 12 }}>
          <FilterButton label="Shift & machine" count={chips.length} onClick={() => setSheetOpen(true)} />
          <FilterChips chips={chips} />
          <FilterSheet title="Shift & machine" open={sheetOpen} onClose={() => setSheetOpen(false)} onReset={() => setFilters(NO_FILTERS)} canReset={filtered}>
            <FilterField label="Shift">{shiftSelect({ width: '100%' })}</FilterField>
            <FilterField label="Machine">{machineSelect({ width: '100%' })}</FilterField>
            <FilterField label="Operator">{operatorSelect({ width: '100%' })}</FilterField>
          </FilterSheet>
        </div>
      ) : (
        <div className="surface" style={{ display: 'flex', gap: 10, padding: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          {shiftSelect({ minWidth: 160 })}
          {machineSelect({ minWidth: 220 })}
          {operatorSelect({ minWidth: 240 })}
          {filtered && (
            <Button type="link" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-4 stagger">
        <Tile label="Runs" value={t ? t.runs.toLocaleString('en-IN') : '—'} sub={t ? `${t.hours.toFixed(1)} running hours` : undefined} />
        <Tile label="Output" value={t ? formatKg(t.output_kg) : '—'} sub={t ? `${formatKg(t.processed_kg)} processed` : undefined} />
        <Tile label="Wastage" value={t ? formatPercent(t.wastage_pct, 2) : '—'} sub={t ? formatKg(t.wastage_kg) : undefined} />
        <Tile label="Efficiency" value={t ? <Efficiency pct={t.efficiency_pct} /> : '—'} sub={t?.kg_per_hour ? `${t.kg_per_hour.toLocaleString('en-IN')} kg per hour` : undefined} />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartCard title="Output over time" loading={loading} refreshing={refreshing} empty={!trend.some((p) => p.output_kg > 0)} emptyText="No production runs in this period" height={240}>
          <ResponsiveContainer>
            <BarChart data={trend} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="period" tickFormatter={xTick(data?.bucket ?? 'day')} {...axisProps} minTickGap={24} />
              <YAxis tickFormatter={shortKg} {...axisProps} width={64} />
              <Tooltip cursor={{ fill: 'rgba(16,24,40,0.04)' }} content={<ChartTooltip format={(v) => formatKg(v)} labelFormat={(v) => periodLabel(v, data?.bucket ?? 'day')} />} />
              <Bar dataKey="output_kg" name="Output" fill={reportColors.output} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={ANIMATION_MS} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-2" style={{ marginTop: 8, gap: 16, alignItems: 'start' }}>
        <div>
          <SectionTitle title="Operators" />
          <RankingCard
            title="Operators"
            rows={data?.by_operator ?? []}
            loading={loading}
            refreshing={refreshing}
            onPick={pick('operator_id')}
            emptyText="No operators recorded on runs in this period"
          />
        </div>
        <div>
          <SectionTitle title="Machines" />
          <RankingCard
            title="Machines"
            rows={(data?.by_machine ?? []).filter((m) => m.id !== 0 || m.runs > 0)}
            loading={loading}
            refreshing={refreshing}
            onPick={(id) => id !== 0 && pick('machine_id')(id)}
            emptyText="No runs in this period"
          />
        </div>
      </div>
    </div>
  )
}
