import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import { specKey, type Row, type SeriesSpec } from './core/categoryChart'
import { formatAxisLabels, RANGE_LABEL, styleLegend, withFormatted } from './core/root'
import { addScrollbar } from './core/scroll'
import { ink } from './core/tokens'
import { useAmChart } from './core/useAmChart'

export interface LineChartProps {
  data: Row[]
  categoryField: string
  series: SeriesSpec[]
  format: (v: number) => string
  /** Light wash under a single line. */
  area?: boolean
  /** A target drawn as a solid line, e.g. the 40% oil target (name it in the card subtitle). */
  target?: { value: number; label: string; color: string }
  /** A band to flag, e.g. below the red threshold. */
  band?: { from: number; to: number; color: string }
  /** Fixed value-axis range. */
  min?: number
  max?: number
  height?: number
}

/**
 * Lines over time. A crosshair snaps to the nearest period and one tooltip lists every series.
 * Many periods → the latest are shown, with an amCharts scrollbar to go back.
 */
export default function LineChart({ height = 220, ...spec }: LineChartProps) {
  const ref = useAmChart((root) => {
    const fields = spec.series.map((s) => s.field)
    const data = withFormatted(spec.data, fields, spec.format)
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', layout: root.verticalLayout, paddingLeft: 0, paddingRight: 4, paddingTop: 4, paddingBottom: 0 }),
    )
    chart.zoomOutButton.set('forceHidden', true)

    const xRenderer = am5xy.AxisRendererX.new(root, { minGridDistance: 44, cellStartLocation: 0, cellEndLocation: 1 })
    xRenderer.grid.template.set('forceHidden', true)
    xRenderer.labels.template.setAll({ paddingTop: 4 })
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField: spec.categoryField, renderer: xRenderer, startLocation: 0.5, endLocation: 0.5 }))
    xAxis.data.setAll(data)
    // Many periods: show the latest ones, with an amCharts scrollbar to go back.
    addScrollbar(root, chart, xAxis, data.length, { direction: 'x', perCategory: 28, from: 'end' })

    const yRenderer = am5xy.AxisRendererY.new(root, { minGridDistance: 34 })
    formatAxisLabels(yRenderer, spec.format)
    const yAxis = chart.yAxes.push(
      am5xy.ValueAxis.new(root, {
        renderer: yRenderer,
        min: spec.min ?? 0,
        // Fixed to the whole series so scrolling never rescales the axis.
        ...(spec.max !== undefined ? { max: spec.max, strictMinMax: true } : { max: Math.max(0, ...data.flatMap((r) => fields.map((f) => Number(r[f] ?? 0)))) * 1.08 || undefined }),
      }),
    )

    if (spec.band) {
      const range = yAxis.createAxisRange(yAxis.makeDataItem({ value: spec.band.from, endValue: spec.band.to }))
      range.get('axisFill')?.setAll({ visible: true, fill: am5.color(spec.band.color), fillOpacity: 0.06 })
      range.get('grid')?.set('forceHidden', true)
      range.get('label')?.set('forceHidden', true)
    }
    if (spec.target) {
      const range = yAxis.createAxisRange(yAxis.makeDataItem({ value: spec.target.value }))
      range.get('grid')?.setAll({ visible: true, stroke: am5.color(spec.target.color), strokeOpacity: 1, strokeWidth: 1.5 })
      // The value axis already labels this height; the target's name goes in the tooltip and the card subtitle.
      range.get('label')?.setAll({ userData: RANGE_LABEL, forceHidden: true })
    }

    // One readout lists every series at the hovered period: value first, then the name.
    const rows = spec.series.map((s) => `[${s.color}]━[/] [bold]{__f_${s.field}}[/] ${spec.series.length > 1 ? s.name : ''}`).join('\n')
    const showDots = data.length <= 24
    spec.series.forEach((s, i) => {
      const color = am5.color(s.color)
      const series = chart.series.push(
        am5xy.LineSeries.new(root, {
          name: s.name,
          xAxis,
          yAxis,
          valueYField: s.field,
          categoryXField: spec.categoryField,
          stroke: color,
          fill: color,
          connect: true,
          ...(i === 0 ? { tooltip: am5.Tooltip.new(root, { labelText: `[fontSize:11px ${ink.muted}]{categoryX}[/]\n${rows}`, pointerOrientation: 'horizontal' }) } : {}),
        }),
      )
      series.strokes.template.setAll({ strokeWidth: 2, lineJoin: 'round', lineCap: 'round' })
      if (spec.area && spec.series.length === 1) series.fills.template.setAll({ visible: true, fillOpacity: 0.1 })
      if (showDots) {
        series.bullets.push(() =>
          am5.Bullet.new(root, { sprite: am5.Circle.new(root, { radius: 4, fill: color, stroke: am5.color(ink.surface), strokeWidth: 2 }) }),
        )
      }
      series.data.setAll(data)
      series.appear(500)
    })

    const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none', xAxis, snapToSeries: chart.series.values as am5xy.XYSeries[] }))
    cursor.lineY.set('forceHidden', true)
    cursor.lineX.setAll({ stroke: am5.color(ink.muted), strokeOpacity: 0.6, strokeDasharray: [] })

    if (spec.series.length > 1) {
      const legend = chart.children.unshift(am5.Legend.new(root, { x: 0, centerX: 0, marginBottom: 6 }))
      styleLegend(legend)
      legend.data.setAll(chart.series.values)
    }
    chart.appear(500, 50)
  }, specKey(spec))

  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
