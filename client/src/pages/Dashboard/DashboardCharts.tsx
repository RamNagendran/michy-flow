import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChartFrame, ColumnChart, DonutChart, flowColors, gradeColor, PRODUCT_ORDER, productColor, StackedBarChart, StackedColumnChart } from '../../charts'
import { SectionTitle } from '../../components/ui'
import { itemName, itemsOfCompanies, toKg } from '../../data/catalog'
import { useTrends } from '../../hooks/queries/reports'
import { useAccess } from '../../hooks/useAccess'
import { useCompanyData } from '../../hooks/useCompanyData'
import type { Bucket } from '../../types/reports'
import { formatINRShort, formatPercent, formatKg } from '../../utils/format'
import { bucketLabels, periodLabel, periodLabels } from '../../utils/period'

const byProductOrder = (a: string, b: string) => PRODUCT_ORDER.indexOf(a as never) - PRODUCT_ORDER.indexOf(b as never)

/** Production and money flow. Dates and company come from the top bar; the grouping ("Chart by") from the analysis filter bar above. */
export default function DashboardCharts({ bucket }: { bucket: Bucket }) {
  const navigate = useNavigate()
  const { can, setActive } = useAccess()
  const { scope, period, range, summaries, total: t, isLoading } = useCompanyData()
  const several = scope.length > 1
  const periodText = periodLabels[period]
  const trendIds = useMemo(() => scope.filter((c) => can('view_all_entries', c.id)).map((c) => c.id), [scope, can])
  const trends = useTrends(trendIds, range, bucket)
  const every = bucketLabels[bucket].toLowerCase()

  // Money and processing over time.
  const timeline = trends.series.map((p) => ({ ...p, label: periodLabel(p.period, trends.bucket) }))
  const noTrend = !timeline.some((p) => p.purchase_amount || p.sales_amount)
  const noProcessing = !timeline.some((p) => p.output_kg || p.wastage_kg)

  // What was produced, by weight (oil converted from litres) in the fixed product order.
  const products = itemsOfCompanies(scope, 'products')
    .map((p) => p.id)
    .sort(byProductOrder)
  const produced = products
    .map((id) => ({ label: itemName(id), value: toKg(id, t?.production.by_item.find((i) => i.item === id)?.qty ?? 0), color: productColor(id) }))
    .filter((s) => s.value > 0)

  // The flow from buying to selling, in kg.
  const flow = [
    { step: 'Purchased', kg: t?.purchases.qty_kg ?? 0, to: '/purchases' },
    { step: 'Processed', kg: t?.production.processed_kg ?? 0, to: '/production' },
    { step: 'Produced', kg: t?.production.output_kg ?? 0, to: '/stock' },
    { step: 'Sold', kg: t?.sales.qty_kg ?? 0, to: '/sales' },
  ]

  const gradeAmounts = (grades: { grade: string; amount: number }[]) => Object.fromEntries(grades.map((g) => [g.grade, g.amount])) as Record<'A' | 'B' | 'C', number>
  const gradeRows = t
    ? [
        { flow: 'Purchases', ...gradeAmounts(t.purchases.by_grade) },
        { flow: 'Sales', ...gradeAmounts(t.sales.by_grade) },
      ]
    : []
  const noGrades = !t || (t.purchases.amount === 0 && t.sales.amount === 0)

  const companyRows = scope.map((c) => ({ id: c.id, company: c.code, name: c.name, purchases: summaries.get(c.id)?.purchases.amount ?? 0, sales: summaries.get(c.id)?.sales.amount ?? 0 }))

  const wastagePct = t?.production.processed_kg ? (t.production.wastage_kg / t.production.processed_kg) * 100 : 0

  return (
    <>
      <SectionTitle
        title="Production and money flow"
        hint={`${periodText.toLowerCase()} · wastage ${formatPercent(wastagePct)} of the weight processed`}
      />
      <div className="viz-grid wide-left">
        <ChartFrame
          title="Purchases vs sales"
          sub={`${periodText} · ${every}`}
          loading={trends.isLoading}
          refreshing={trends.isRefreshing}
          empty={noTrend}
          table={{ columns: ['Period', 'Purchases', 'Sales'], rows: timeline.map((p) => [p.label, formatINRShort(p.purchase_amount), formatINRShort(p.sales_amount)]) }}
        >
          <ColumnChart
            data={timeline}
            categoryField="label"
            series={[
              { field: 'purchase_amount', name: 'Purchases', color: flowColors.purchase },
              { field: 'sales_amount', name: 'Sales', color: flowColors.sales },
            ]}
            format={formatINRShort}
            scrollFrom="end"
          />
        </ChartFrame>
        <ChartFrame
          title="What we produced"
          sub={`${periodText} · share by weight`}
          loading={isLoading}
          empty={!produced.length}
          table={{ columns: ['Product', 'Weight'], rows: produced.map((p) => [p.label, formatKg(p.value)]) }}
        >
          <DonutChart slices={produced} format={formatKg} centerValue={formatKg(t?.production.output_kg ?? 0)} centerLabel="total output" height={220} />
        </ChartFrame>
      </div>

      <div className="viz-grid cols-3">
        <ChartFrame
          title="Material flow"
          sub={`${periodText} · click a step for details`}
          loading={isLoading}
          empty={flow.every((f) => !f.kg)}
          table={{ columns: ['Step', 'Weight'], rows: flow.map((f) => [f.step, formatKg(f.kg)]) }}
        >
          <ColumnChart
            data={flow}
            categoryField="step"
            series={[{ field: 'kg', name: 'Weight', color: '#2a78d6' }]}
            format={formatKg}
            valueLabels
            onSelect={(row) => navigate(String(flow.find((f) => f.step === row.step)?.to ?? '/'))}
          />
        </ChartFrame>
        <ChartFrame
          title="Output vs wastage"
          sub={`${periodText} · ${every} · weight processed, split`}
          loading={trends.isLoading}
          refreshing={trends.isRefreshing}
          empty={noProcessing}
          table={{ columns: ['Period', 'Output', 'Wastage'], rows: timeline.map((p) => [p.label, formatKg(p.output_kg), formatKg(p.wastage_kg)]) }}
        >
          <StackedColumnChart
            data={timeline}
            categoryField="label"
            series={[
              { field: 'output_kg', name: 'Output', color: flowColors.output },
              { field: 'wastage_kg', name: 'Wastage', color: flowColors.wastage },
            ]}
            format={formatKg}
            scrollFrom="end"
          />
        </ChartFrame>
        <ChartFrame
          title="Grade A / B / C share"
          sub={`${periodText} · A: plant · B: sold again · C: bill only`}
          loading={isLoading}
          empty={noGrades}
          table={{
            columns: ['', 'Grade A', 'Grade B', 'Grade C'],
            rows: gradeRows.map((r) => [r.flow, formatINRShort(Number(r.A ?? 0)), formatINRShort(Number(r.B ?? 0)), formatINRShort(Number(r.C ?? 0))]),
          }}
        >
          <StackedBarChart
            data={gradeRows}
            categoryField="flow"
            percent
            series={(['A', 'B', 'C'] as const).map((g) => ({ field: g, name: `Grade ${g}`, color: gradeColor[g] }))}
            format={formatINRShort}
            height={200}
          />
        </ChartFrame>
      </div>

      {several && (
        <div className="viz-grid">
          <ChartFrame
            title="Companies compared"
            sub={`${periodText} · click a company to open it`}
            loading={isLoading}
            height={200}
            empty={companyRows.every((r) => !r.purchases && !r.sales)}
            table={{ columns: ['Company', 'Purchases', 'Sales'], rows: companyRows.map((r) => [r.name, formatINRShort(r.purchases), formatINRShort(r.sales)]) }}
          >
            <ColumnChart
              data={companyRows}
              categoryField="company"
              series={[
                { field: 'purchases', name: 'Purchases', color: flowColors.purchase },
                { field: 'sales', name: 'Sales', color: flowColors.sales },
              ]}
              format={formatINRShort}
              height={200}
              onSelect={(row) => setActive(Number(row.id))}
            />
          </ChartFrame>
        </div>
      )}
    </>
  )
}
