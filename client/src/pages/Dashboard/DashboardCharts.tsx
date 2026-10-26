import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  ChartFrame,
  ColumnChart,
  DonutChart,
  flowColors,
  gradeColor,
  HeatmapChart,
  PRODUCT_ORDER,
  productColor,
  StackedBarChart,
  StackedColumnChart,
} from '../../charts'
import { companyItems, itemName, itemsOfCompanies, toKg } from '../../data/catalog'
import { useTrends } from '../../hooks/queries/reports'
import { useAccess } from '../../hooks/useAccess'
import { useCompanyData } from '../../hooks/useCompanyData'
import { formatINRShort, formatTonnes } from '../../utils/format'
import { periodLabel, periodLabels } from '../../utils/period'

const byProductOrder = (a: string, b: string) => PRODUCT_ORDER.indexOf(a as never) - PRODUCT_ORDER.indexOf(b as never)

/** The chart half of the company dashboard. Everything follows the period and company picked in the header. */
export default function DashboardCharts() {
  const navigate = useNavigate()
  const { can, setActive } = useAccess()
  const { scope, period, range, stocks, summaries, total: t, isLoading } = useCompanyData()
  const several = scope.length > 1
  const periodText = periodLabels[period]
  const trendIds = useMemo(() => scope.filter((c) => can('view_all_entries', c.id)).map((c) => c.id), [scope, can])
  const trends = useTrends(trendIds, range)

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

  const salesByProduct = (t?.sales.by_item ?? [])
    .filter((i) => i.amount > 0)
    .map((i) => ({ product: itemName(i.item), amount: i.amount }))
    .sort((a, b) => b.amount - a.amount)

  const gradeAmounts = (grades: { grade: string; amount: number }[]) => Object.fromEntries(grades.map((g) => [g.grade, g.amount])) as Record<'A' | 'B' | 'C', number>
  const gradeRows = t
    ? [
        { flow: 'Purchases', ...gradeAmounts(t.purchases.by_grade) },
        { flow: 'Sales', ...gradeAmounts(t.sales.by_grade) },
      ]
    : []
  const noGrades = !t || (t.purchases.amount === 0 && t.sales.amount === 0)

  const companyRows = scope.map((c) => ({ id: c.id, company: c.code, name: c.name, purchases: summaries.get(c.id)?.purchases.amount ?? 0, sales: summaries.get(c.id)?.sales.amount ?? 0 }))

  // Raw material in stock: a company × material grid when there are several, else one bar per material.
  const materials = itemsOfCompanies(scope, 'inputs').map((m) => m.id)
  const rawCells = scope.flatMap((c) =>
    companyItems(c).inputs.map((m) => ({ x: itemName(m.id), y: c.name, value: Math.max(stocks.get(c.id)?.raw.find((l) => l.item === m.id)?.provisional.balance ?? 0, 0), id: c.id })),
  )
  const single = scope[0]
  const rawBars = !several && single ? companyItems(single).inputs.map((m) => ({ material: itemName(m.id), kg: Math.max(stocks.get(single.id)?.raw.find((l) => l.item === m.id)?.provisional.balance ?? 0, 0) })) : []
  const productBars =
    !several && single
      ? companyItems(single)
          .products.map((p) => ({ product: itemName(p.id), kg: Math.max(toKg(p.id, stocks.get(single.id)?.output.find((l) => l.item === p.id)?.provisional.balance ?? 0), 0) }))
      : []

  return (
    <>
      <div className="viz-grid wide-left">
        <ChartFrame
          title="Purchases vs sales"
          sub={`${periodText} · by ${trends.bucket}`}
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
          table={{ columns: ['Product', 'Weight'], rows: produced.map((p) => [p.label, formatTonnes(p.value)]) }}
        >
          <DonutChart slices={produced} format={formatTonnes} centerValue={formatTonnes(t?.production.output_kg ?? 0)} centerLabel="total output" height={220} />
        </ChartFrame>
      </div>

      <div className="viz-grid cols-3">
        <ChartFrame
          title="Material flow"
          sub={`${periodText} · click a step for details`}
          loading={isLoading}
          empty={flow.every((f) => !f.kg)}
          table={{ columns: ['Step', 'Weight'], rows: flow.map((f) => [f.step, formatTonnes(f.kg)]) }}
        >
          <ColumnChart
            data={flow}
            categoryField="step"
            series={[{ field: 'kg', name: 'Weight', color: '#2a78d6' }]}
            format={formatTonnes}
            valueLabels
            onSelect={(row) => navigate(String(flow.find((f) => f.step === row.step)?.to ?? '/'))}
          />
        </ChartFrame>
        <ChartFrame
          title="Output vs wastage"
          sub={`${periodText} · weight processed, split`}
          loading={trends.isLoading}
          refreshing={trends.isRefreshing}
          empty={noProcessing}
          table={{ columns: ['Period', 'Output', 'Wastage'], rows: timeline.map((p) => [p.label, formatTonnes(p.output_kg), formatTonnes(p.wastage_kg)]) }}
        >
          <StackedColumnChart
            data={timeline}
            categoryField="label"
            series={[
              { field: 'output_kg', name: 'Output', color: flowColors.output },
              { field: 'wastage_kg', name: 'Wastage', color: flowColors.wastage },
            ]}
            format={formatTonnes}
            scrollFrom="end"
          />
        </ChartFrame>
        <ChartFrame
          title="Sales by product"
          sub={`${periodText} · invoice value`}
          loading={isLoading}
          empty={!salesByProduct.length}
          table={{ columns: ['Product', 'Sales'], rows: salesByProduct.map((r) => [r.product, formatINRShort(r.amount)]) }}
        >
          <BarChart data={salesByProduct} categoryField="product" series={[{ field: 'amount', name: 'Sales', color: flowColors.sales }]} format={formatINRShort} />
        </ChartFrame>
      </div>

      <div className="viz-grid cols-2">
        <ChartFrame
          title="Grade A / B / C share"
          sub={`${periodText} · A: plant · B: sold again · C: bill only`}
          loading={isLoading}
          empty={noGrades}
          height={150}
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
            height={150}
          />
        </ChartFrame>
        {several ? (
          <ChartFrame
            title="Companies compared"
            sub={`${periodText} · click a company to open it`}
            loading={isLoading}
            height={150}
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
              height={150}
              onSelect={(row) => setActive(Number(row.id))}
            />
          </ChartFrame>
        ) : (
          <ChartFrame
            title="Products in stock"
            sub="Right now · by weight"
            loading={isLoading}
            height={150}
            empty={productBars.every((r) => !r.kg)}
            table={{ columns: ['Product', 'Weight'], rows: productBars.map((r) => [r.product, formatTonnes(r.kg)]) }}
          >
            <BarChart data={productBars} categoryField="product" series={[{ field: 'kg', name: 'In stock', color: flowColors.output }]} format={formatTonnes} height={150} />
          </ChartFrame>
        )}
      </div>

      <div className="viz-grid">
        {several ? (
          <ChartFrame
            title="Raw material in stock"
            sub="Stock now · darker colour = more stock · click a box to open the company"
            loading={isLoading}
            height={Math.min(scope.length * 34 + 64, 300)}
            empty={rawCells.every((c) => !c.value)}
            table={{
              columns: ['Company', ...materials.map(itemName)],
              rows: scope.map((c) => [c.name, ...materials.map((m) => formatTonnes(rawCells.find((x) => x.y === c.name && x.x === itemName(m))?.value ?? 0))]),
            }}
          >
            <HeatmapChart cells={rawCells} columns={materials.map(itemName)} rows={scope.map((c) => c.name)} format={formatTonnes} onSelect={(cell) => navigate(`/companies/${cell.id}`)} />
          </ChartFrame>
        ) : (
          <ChartFrame
            title="Raw material in stock"
            sub="Right now · tyres and scrap waiting to be processed"
            loading={isLoading}
            height={180}
            empty={rawBars.every((r) => !r.kg)}
            table={{ columns: ['Material', 'Weight'], rows: rawBars.map((r) => [r.material, formatTonnes(r.kg)]) }}
          >
            <BarChart data={rawBars} categoryField="material" series={[{ field: 'kg', name: 'In stock', color: '#2a78d6' }]} format={formatTonnes} height={180} />
          </ChartFrame>
        )}
      </div>
    </>
  )
}
