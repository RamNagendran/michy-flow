import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import { specKey } from './core/categoryChart'
import { addScrollbar } from './core/scroll'
import { ink, sequentialBlue } from './core/tokens'
import { useAmChart } from './core/useAmChart'

export interface HeatCell {
  x: string
  y: string
  value: number
  /** Passed back on click, e.g. a company id. */
  id?: string | number
}

export interface HeatmapChartProps {
  cells: HeatCell[]
  /** Column and row order; defaults to first appearance. */
  columns?: string[]
  rows?: string[]
  format: (v: number) => string
  onSelect?: (cell: HeatCell) => void
  height?: number
}

/**
 * A grid coloured by magnitude in one hue (light = little, dark = a lot), with the value
 * printed in each cell. Use for two categories at once, e.g. stock by company and material.
 */
export default function HeatmapChart({ height, ...spec }: HeatmapChartProps) {
  const columns = spec.columns ?? [...new Set(spec.cells.map((c) => c.x))]
  const rows = spec.rows ?? [...new Set(spec.cells.map((c) => c.y))]
  const ref = useAmChart((root) => {
    const max = Math.max(...spec.cells.map((c) => c.value), 0)
    // Empty cells stay blank instead of repeating "0"; the tooltip and table still give the figure.
    const data = spec.cells.map((c) => ({ ...c, __f: spec.format(c.value), __cell: c.value ? spec.format(c.value) : '', __dark: max > 0 && c.value / max > 0.45 }))
    const chart = root.container.children.push(
      am5xy.XYChart.new(root, { panX: false, panY: false, wheelX: 'none', wheelY: 'none', layout: root.verticalLayout, paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 }),
    )
    chart.zoomOutButton.set('forceHidden', true)

    const yRenderer = am5xy.AxisRendererY.new(root, { inversed: true, minGridDistance: 10 })
    yRenderer.grid.template.set('forceHidden', true)
    yRenderer.labels.template.setAll({ fill: am5.color(ink.secondary), fontWeight: '700', maxWidth: 130, oversizedBehavior: 'truncate', paddingRight: 8 })
    const yAxis = chart.yAxes.push(am5xy.CategoryAxis.new(root, { categoryField: 'y', renderer: yRenderer }))

    const xRenderer = am5xy.AxisRendererX.new(root, { opposite: true, minGridDistance: 10 })
    xRenderer.grid.template.set('forceHidden', true)
    xRenderer.labels.template.setAll({ maxWidth: 84, oversizedBehavior: 'truncate', paddingBottom: 4 })
    const xAxis = chart.xAxes.push(am5xy.CategoryAxis.new(root, { categoryField: 'x', renderer: xRenderer }))

    const series = chart.series.push(am5xy.ColumnSeries.new(root, { calculateAggregates: true, xAxis, yAxis, categoryXField: 'x', categoryYField: 'y', valueField: 'value' }))
    series.columns.template.setAll({
      width: am5.percent(100),
      height: am5.percent(100),
      stroke: am5.color(ink.surface),
      strokeWidth: 2,
      strokeOpacity: 1,
      cornerRadiusTL: 4,
      cornerRadiusTR: 4,
      cornerRadiusBL: 4,
      cornerRadiusBR: 4,
      tooltipText: `[bold]{__f}[/]\n[fontSize:11px ${ink.muted}]{y} · {x}[/]`,
      cursorOverStyle: spec.onSelect ? 'pointer' : 'default',
    })
    series.columns.template.states.create('hover', { fillOpacity: 0.8 })
    series.set('heatRules', [{ target: series.columns.template, dataField: 'value', min: am5.color(sequentialBlue[0]), max: am5.color(sequentialBlue[sequentialBlue.length - 1]), key: 'fill' }])
    if (spec.onSelect) {
      const onSelect = spec.onSelect
      series.columns.template.events.on('click', (ev) => onSelect(ev.target.dataItem?.dataContext as HeatCell))
    }
    // Value in each cell, white on dark cells and ink on light ones so it always reads.
    series.bullets.push(() => {
      const label = am5.Label.new(root, { text: '{__cell}', populateText: true, centerX: am5.p50, centerY: am5.p50, fontSize: 10.5, fontWeight: '700', fill: am5.color(ink.primary) })
      label.adapters.add('fill', (fill, target) => ((target.dataItem?.dataContext as { __dark?: boolean } | undefined)?.__dark ? am5.color(0xffffff) : fill))
      return am5.Bullet.new(root, { locationX: 0.5, locationY: 0.5, sprite: label })
    })

    yAxis.data.setAll(rows.map((y) => ({ y })))
    xAxis.data.setAll(columns.map((x) => ({ x })))
    addScrollbar(root, chart, yAxis, rows.length, { direction: 'y', perCategory: 34 })
    addScrollbar(root, chart, xAxis, columns.length, { direction: 'x', perCategory: 70 })
    series.data.setAll(data)

    const heatLegend = chart.children.push(
      am5.HeatLegend.new(root, { orientation: 'horizontal', startColor: am5.color(sequentialBlue[0]), endColor: am5.color(sequentialBlue[sequentialBlue.length - 1]), startText: spec.format(0), endText: spec.format(max), stepCount: 1, width: 180, x: am5.p100, centerX: am5.p100, marginTop: 6 }),
    )
    heatLegend.startLabel.setAll({ fontSize: 11, fill: am5.color(ink.muted) })
    heatLegend.endLabel.setAll({ fontSize: 11, fill: am5.color(ink.muted) })
    series.columns.template.events.on('pointerover', (ev) => {
      const v = (ev.target.dataItem?.dataContext as HeatCell | undefined)?.value
      if (v !== undefined) heatLegend.showValue(v)
    })
    chart.appear(500, 50)
  }, specKey({ ...spec, columns, rows }))

  // Grows with the rows up to 300px; past that, an amCharts scrollbar moves through them.
  return <div ref={ref} className="viz-canvas" style={{ height: height ?? Math.min(rows.length * 34 + 64, 300) }} />
}
