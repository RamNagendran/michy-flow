import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import { specKey } from './core/categoryChart'
import { formatAxisLabels } from './core/root'
import { addScrollbar } from './core/scroll'
import { ink } from './core/tokens'
import { useAmChart } from './core/useAmChart'

export interface RangePoint {
  label: string
  /** Lowest and highest single rate in the period; null when nothing was billed. */
  low: number | null
  high: number | null
  avg: number | null
}

export interface RangeTrendChartProps {
  data: RangePoint[]
  color: string
  format: (v: number) => string
  height?: number
}

/**
 * How a price moved: a thin bar from the lowest to the highest rate in each period, and the
 * weighted average as a line through it. The value axis starts near the lowest rate, not at
 * zero, so small changes in price are visible (the bars are ranges, not amounts).
 */
export default function RangeTrendChart({ height = 240, ...spec }: RangeTrendChartProps) {
  const ref = useAmChart((root) => {
    const data = spec.data.map((p) => ({
      ...p,
      __avg: p.avg === null ? '—' : spec.format(p.avg),
      __range: p.low === null || p.high === null ? '—' : `${spec.format(p.low)} – ${spec.format(p.high)}`,
    }))
    const values = spec.data.flatMap((p) => [p.low, p.high, p.avg]).filter((v): v is number => v !== null)
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const pad = Math.max((hi - lo) * 0.15, hi * 0.02)

    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', layout: root.verticalLayout, paddingLeft: 0, paddingRight: 10, paddingTop: 8, paddingBottom: 0 }),
    )
    chart.zoomOutButton.set('forceHidden', true)

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 44, cellStartLocation: 0.2, cellEndLocation: 0.8 })
    xRenderer.grid.template.set('forceHidden', true)
    xRenderer.labels.template.setAll({ paddingTop: 4 })
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField: 'label', renderer: xRenderer }))
    xAxis.data.setAll(data)
    addScrollbar(root, chart, xAxis, data.length, { direction: 'x', perCategory: 34, from: 'end' })

    const yRenderer = am5xy.AxisRendererY.new(root, { minGridDistance: 34 })
    formatAxisLabels(yRenderer, spec.format)
    const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, { renderer: yRenderer, min: Math.max(0, lo - pad), max: hi + pad, strictMinMax: true }))

    const color = am5.color(spec.color)
    const band = chart.series.push(
      am5xy.ColumnSeries.new(root, { name: 'Lowest – highest', xAxis, yAxis, valueYField: 'high', openValueYField: 'low', categoryXField: 'label', fill: color, stroke: color }),
    )
    band.columns.template.setAll({ width: am5.percent(40), maxWidth: 14, fillOpacity: 0.28, strokeOpacity: 0, cornerRadiusTL: 4, cornerRadiusTR: 4, cornerRadiusBL: 4, cornerRadiusBR: 4 })
    band.data.setAll(data)

    const line = chart.series.push(
      am5xy.LineSeries.new(root, {
        name: 'Average',
        xAxis,
        yAxis,
        valueYField: 'avg',
        categoryXField: 'label',
        stroke: color,
        fill: color,
        connect: true,
        maskBullets: false,
        tooltip: am5.Tooltip.new(root, { labelText: `[fontSize:11px ${ink.muted}]{categoryX}[/]\n[bold]{__avg}[/] average\n[${ink.secondary}]{__range}[/] range`, pointerOrientation: 'horizontal' }),
      }),
    )
    line.strokes.template.setAll({ strokeWidth: 2, lineJoin: 'round', lineCap: 'round' })
    line.bullets.push(() => am5.Bullet.new(root, { sprite: am5.Circle.new(root, { radius: 4, fill: color, stroke: am5.color(ink.surface), strokeWidth: 2 }) }))
    line.data.setAll(data)

    const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis, snapToSeries: [line] }))
    cursor.lineY.set('forceHidden', true)
    cursor.lineX.setAll({ stroke: am5.color(ink.muted), strokeOpacity: 0.6, strokeDasharray: [] })

    const legend = chart.children.unshift(am5.Legend.new(root, { x: 0, centerX: 0, marginBottom: 6 }))
    legend.markers.template.setAll({ width: 10, height: 10 })
    legend.labels.template.setAll({ fontSize: 12, fill: am5.color(ink.secondary), fontWeight: '700' })
    legend.data.setAll(chart.series.values)
    chart.appear(500, 50)
  }, specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
