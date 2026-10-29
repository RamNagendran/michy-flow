import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import { specKey } from './core/categoryChart'
import { formatAxisLabels, RANGE_LABEL } from './core/root'
import { addScrollbar } from './core/scroll'
import { ink } from './core/tokens'
import { useAmChart } from './core/useAmChart'

export interface RangeRow {
  name: string
  low: number
  high: number
  avg: number
  color: string
  /** Extra tooltip line, e.g. "12 bills · 40,000 kg". */
  note?: string
}

export interface RangeBarChartProps {
  rows: RangeRow[]
  format: (v: number) => string
  /** Everyone's average, drawn as a line across all the bars. */
  reference?: number | null
  height?: number
}

/**
 * Each supplier's (or buyer's) price spread: a bar from their lowest to their highest bill,
 * with a dot at their average. Narrow bar = steady price; far right = expensive.
 */
export default function RangeBarChart({ height, ...spec }: RangeBarChartProps) {
  const ref = useAmChart((root) => {
    const data = spec.rows.map((r) => ({
      ...r,
      __avg: spec.format(r.avg),
      __range: `${spec.format(r.low)} – ${spec.format(r.high)}`,
      __note: r.note ?? '',
      bar: { fill: am5.color(r.color) },
      dot: { fill: am5.color(r.color) },
    }))
    const lo = Math.min(...spec.rows.map((r) => r.low))
    const hi = Math.max(...spec.rows.map((r) => r.high))
    const pad = Math.max((hi - lo) * 0.12, hi * 0.02)

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', layout: root.verticalLayout, paddingLeft: 0, paddingRight: 14, paddingTop: 6, paddingBottom: 0 }),
    )
    chart.zoomOutButton.set('forceHidden', true)

    const yRenderer = am5xy.AxisRendererY.new(root, { inversed: true, minGridDistance: 10, cellStartLocation: 0.2, cellEndLocation: 0.8 })
    yRenderer.grid.template.set('forceHidden', true)
    yRenderer.labels.template.setAll({ fill: am5.color(ink.secondary), fontWeight: '700', maxWidth: 130, oversizedBehavior: 'truncate', paddingRight: 6 })
    const yAxis = chart.yAxes.push(am5xy.CategoryAxis.new(root, { categoryField: 'name', renderer: yRenderer }))
    yAxis.data.setAll(data)
    addScrollbar(root, chart, yAxis, data.length, { direction: 'y', perCategory: 30 })

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 70 })
    formatAxisLabels(xRenderer, spec.format)
    const xAxis = chart.xAxes.push(am5xy.ValueAxis.new(root, { renderer: xRenderer, min: Math.max(0, lo - pad), max: hi + pad, strictMinMax: true }))

    if (spec.reference) {
      const range = xAxis.createAxisRange(xAxis.makeDataItem({ value: spec.reference }))
      range.get('grid')?.setAll({ visible: true, stroke: am5.color(ink.secondary), strokeOpacity: 0.8, strokeWidth: 1.5, strokeDasharray: [4, 3] })
      range.get('label')?.setAll({ userData: RANGE_LABEL, forceHidden: true })
    }

    const bars = chart.series.push(am5xy.ColumnSeries.new(root, { xAxis, yAxis, valueXField: 'high', openValueXField: 'low', categoryYField: 'name' }))
    bars.columns.template.setAll({
      templateField: 'bar',
      height: am5.percent(50),
      maxHeight: 12,
      fillOpacity: 0.35,
      strokeOpacity: 0,
      cornerRadiusTL: 6,
      cornerRadiusTR: 6,
      cornerRadiusBL: 6,
      cornerRadiusBR: 6,
      tooltipText: `[bold]{__avg}[/] average\n[${ink.secondary}]{__range}[/]\n[fontSize:11px ${ink.muted}]{categoryY}  {__note}[/]`,
      tooltipY: am5.p50,
    })
    bars.data.setAll(data)

    // The average as a ringed dot on each bar.
    const avg = chart.series.push(am5xy.LineSeries.new(root, { xAxis, yAxis, valueXField: 'avg', categoryYField: 'name', maskBullets: false }))
    avg.strokes.template.set('forceHidden', true)
    avg.bullets.push(() =>
      am5.Bullet.new(root, {
        locationY: 0.5,
        sprite: am5.Circle.new(root, { radius: 5, templateField: 'dot', stroke: am5.color(ink.surface), strokeWidth: 2, tooltipText: `[bold]{__avg}[/] average\n[fontSize:11px ${ink.muted}]{categoryY}[/]` }),
      }),
    )
    avg.data.setAll(data)
    chart.appear(500, 50)
  }, specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height: height ?? Math.min(Math.max(spec.rows.length * 30 + 50, 160), 300) }} />
}
