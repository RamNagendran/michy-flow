import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import dayjs from 'dayjs'
import { specKey } from './core/categoryChart'
import { formatAxisLabels, styleLegend } from './core/root'
import { ink } from './core/tokens'
import { useAmChart } from './core/useAmChart'

export interface ScatterPoint {
  date: string
  value: number
  /** Drives the dot size (e.g. quantity on the bill). */
  size: number
  /** Extra tooltip line, e.g. the bill number and quantity. */
  note?: string
}

export interface ScatterGroup {
  name: string
  color: string
  points: ScatterPoint[]
}

export interface ScatterChartProps {
  groups: ScatterGroup[]
  format: (v: number) => string
  height?: number
}

/**
 * Every bill as a dot: when it was billed (across), at what rate (up), how big (dot size), and
 * who (colour, named in the legend). Shows whether big bills get better rates, and outliers.
 */
export default function ScatterChart({ height = 260, ...spec }: ScatterChartProps) {
  const ref = useAmChart((root) => {
    const maxSize = Math.max(1, ...spec.groups.flatMap((g) => g.points.map((p) => p.size)))
    const values = spec.groups.flatMap((g) => g.points.map((p) => p.value))
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = Math.max((hi - lo) * 0.12, hi * 0.03)

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', layout: root.verticalLayout, paddingLeft: 0, paddingRight: 14, paddingTop: 8, paddingBottom: 0 }),
    )
    chart.zoomOutButton.set('forceHidden', true)

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 70 })
    xRenderer.grid.template.set('forceHidden', true)
    const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, { baseInterval: { timeUnit: 'day', count: 1 }, renderer: xRenderer, extraMin: 0.02, extraMax: 0.02 }))
    xAxis.get('dateFormats')!['day'] = 'd MMM'
    xAxis.get('periodChangeDateFormats')!['day'] = 'd MMM yy'

    const yRenderer = am5xy.AxisRendererY.new(root, { minGridDistance: 34 })
    formatAxisLabels(yRenderer, spec.format)
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yRenderer, min: Math.max(0, lo - pad), max: hi + pad, strictMinMax: true }))

    for (const g of spec.groups) {
      const color = am5.color(g.color)
      const series = chart.series.push(am5xy.LineSeries.new(root, { name: g.name, xAxis, yAxis, valueXField: 'x', valueYField: 'value', fill: color, stroke: color, maskBullets: false }))
      series.strokes.template.set('forceHidden', true)
      series.bullets.push((_root, _series, dataItem) => {
        const ctx = dataItem.dataContext as { size: number }
        return am5.Bullet.new(root, {
          sprite: am5.Circle.new(root, {
            // Area, not radius, follows the size, so a bill twice as big does not look four times bigger.
            radius: 4 + 8 * Math.sqrt(ctx.size / maxSize),
            fill: color,
            fillOpacity: 0.72,
            stroke: am5.color(ink.surface),
            strokeWidth: 1.5,
            tooltipText: `[bold]{__v}[/]  ${g.name}\n[fontSize:11px ${ink.muted}]{__d} · {__note}[/]`,
          }),
        })
      })
      series.data.setAll(
        g.points.map((p) => ({ ...p, x: dayjs(p.date).valueOf(), __v: spec.format(p.value), __d: dayjs(p.date).format('D MMM YYYY'), __note: p.note ?? '' })),
      )
    }

    if (spec.groups.length > 1) {
      const legend = chart.children.unshift(am5.Legend.new(root, { x: 0, centerX: 0, marginBottom: 6 }))
      styleLegend(legend)
      legend.data.setAll(chart.series.values)
    }
    chart.appear(500, 50)
  }, specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
