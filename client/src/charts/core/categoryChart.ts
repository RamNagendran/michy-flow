import * as am5 from '@amcharts/amcharts5'
import * as am5xy from '@amcharts/amcharts5/xy'
import { formatAxisLabels, styleLegend, withFormatted } from './root'
import { addScrollbar } from './scroll'
import { ink } from './tokens'

export interface SeriesSpec {
  /** Data field holding this series' value. */
  field: string
  name: string
  color: string
}

export type Row = Record<string, string | number | null | undefined>

export interface CategoryChartSpec {
  data: Row[]
  /** Field with the category label shown on the axis. */
  categoryField: string
  series: SeriesSpec[]
  /** Bars run left to right, categories down the side. */
  horizontal?: boolean
  stacked?: boolean
  /** Stacked to 100%: each category shows its parts as shares. */
  percent?: boolean
  format: (v: number) => string
  /** Axis tick text, when it should differ from the tooltip (e.g. "2" on the axis, "2 entries" on hover). */
  axisFormat?: (v: number) => string
  /** Whole numbers only on the value axis (counts). */
  integer?: boolean
  /** Value at the end of each bar (single, unstacked series only). */
  valueLabels?: boolean
  onSelect?: (row: Row) => void
  /** With more categories than fit: show the first ones, or the latest (time series). */
  scrollFrom?: 'start' | 'end'
}

/** Thickness cap for every bar and column. */
const BAR_MAX = 24
const RADIUS = 4

/**
 * Columns or bars over categories, clustered or stacked. One builder so every bar-type chart
 * shares the same marks: thin bars, 4px rounded data end, 2px surface gap, per-bar tooltip.
 */
export function buildCategoryChart(root: am5.Root, spec: CategoryChartSpec) {
  const { horizontal = false, stacked = false, percent = false, series: specs, format } = spec
  const fields = specs.map((s) => s.field)
  const data = withFormatted(spec.data, fields, format)

  // The top segment of each stack gets the rounded end; inner segments stay square.
  const topField = new Map<unknown, string>()
  if (stacked) {
    for (const row of data) {
      const last = [...specs].reverse().find((s) => Number(row[s.field] ?? 0) > 0)
      if (last) topField.set(row[spec.categoryField], last.field)
    }
  }

  const chart = root.container.children.push(
    am5xy.XYChart.new(root, {
      panX: false,
      panY: false,
      wheelX: 'none',
      wheelY: 'none',
      layout: root.verticalLayout,
      paddingLeft: 0,
      paddingRight: horizontal ? 18 : 4,
      paddingTop: 10,
      paddingBottom: 0,
    }),
  )
  chart.zoomOutButton.set('forceHidden', true)

  const catRenderer = horizontal
    ? am5xy.AxisRendererY.new(root, { inversed: true, minGridDistance: 10, cellStartLocation: 0.14, cellEndLocation: 0.86 })
    : am5xy.AxisRendererX.new(root, { minGridDistance: 20, cellStartLocation: 0.14, cellEndLocation: 0.86 })
  catRenderer.grid.template.set('forceHidden', true)
  catRenderer.labels.template.setAll(
    horizontal ? { fill: am5.color(ink.secondary), fontWeight: '700', maxWidth: 120, oversizedBehavior: 'truncate', paddingRight: 6 } : { maxWidth: 90, oversizedBehavior: 'truncate', paddingTop: 4 },
  )
  const catAxis = am5xy.CategoryAxis.new(root, { categoryField: spec.categoryField, renderer: catRenderer })

  const valRenderer = horizontal ? am5xy.AxisRendererX.new(root, { minGridDistance: 70 }) : am5xy.AxisRendererY.new(root, { minGridDistance: 34 })
  if (percent) {
    valRenderer.labels.template.adapters.add('text', (text, target) => {
      const value = target.dataItem?.get('value' as never) as number | undefined
      return value === undefined || value === null ? text : `${value}%`
    })
  } else {
    formatAxisLabels(valRenderer, spec.axisFormat ?? format)
  }
  // The scale covers all the data, not just the categories scrolled into view, so it never
  // jumps (or collapses to 0) while scrolling.
  const dataMax = Math.max(0, ...data.map((row) => (stacked ? fields.reduce((n, f) => n + Number(row[f] ?? 0), 0) : Math.max(...fields.map((f) => Number(row[f] ?? 0))))))
  const extra = spec.valueLabels ? (horizontal ? 0.3 : 0.14) : 0.04
  const valAxis = am5xy.ValueAxis.new(root, {
    renderer: valRenderer,
    min: 0,
    ...(!percent && dataMax > 0 ? { max: dataMax * (1 + extra) } : {}),
    ...(spec.integer ? { maxPrecision: 0 } : {}),
    ...(percent ? { max: 100, strictMinMax: true, calculateTotals: true } : {}),
    // Room past the longest bar for its value label.
    extraMax: extra,
  })

  if (horizontal) {
    chart.yAxes.push(catAxis)
    chart.xAxes.push(valAxis)
  } else {
    chart.xAxes.push(catAxis)
    chart.yAxes.push(valAxis)
  }
  catAxis.data.setAll(data)
  addScrollbar(root, chart, catAxis, data.length, {
    direction: horizontal ? 'y' : 'x',
    // Wide enough for a date label like "18 Oct" under every column.
    perCategory: horizontal ? Math.max(28, specs.length * 16 + 12) : stacked ? 46 : Math.max(46, specs.length * 20 + 12),
    from: spec.scrollFrom,
  })

  for (const s of specs) {
    const color = am5.color(s.color)
    const series = chart.series.push(
      am5xy.ColumnSeries.new(root, {
        name: s.name,
        xAxis: horizontal ? valAxis : catAxis,
        yAxis: horizontal ? catAxis : valAxis,
        stacked,
        clustered: !stacked,
        fill: color,
        stroke: color,
        ...(horizontal
          ? { valueXField: s.field, categoryYField: spec.categoryField, ...(percent ? { valueXShow: 'valueXTotalPercent' as const } : {}) }
          : { valueYField: s.field, categoryXField: spec.categoryField, ...(percent ? { valueYShow: 'valueYTotalPercent' as const } : {}) }),
      }),
    )
    const share = percent ? ` · {${horizontal ? 'valueXTotalPercent' : 'valueYTotalPercent'}.formatNumber('#.0')}%` : ''
    const category = horizontal ? '{categoryY}' : '{categoryX}'
    series.columns.template.setAll({
      ...(horizontal ? { height: am5.percent(stacked ? 62 : 80), maxHeight: BAR_MAX } : { width: am5.percent(stacked ? 62 : 80), maxWidth: BAR_MAX }),
      // The 2px surface gap between touching bars and stack segments.
      stroke: am5.color(ink.surface),
      strokeWidth: 2,
      strokeOpacity: 1,
      tooltipText: `[bold]{__f_${s.field}}[/]${share}  ${specs.length > 1 ? s.name : ''}\n[fontSize:11px ${ink.muted}]${category}[/]`,
      tooltipY: horizontal ? am5.p50 : 0,
      cursorOverStyle: spec.onSelect ? 'pointer' : 'default',
    })
    // Rounded data end, square at the baseline.
    const corners = horizontal ? (['cornerRadiusTR', 'cornerRadiusBR'] as const) : (['cornerRadiusTL', 'cornerRadiusTR'] as const)
    for (const corner of corners) {
      series.columns.template.adapters.add(corner, (_r, target) => {
        if (!stacked) return RADIUS
        const row = target.dataItem?.dataContext as Row | undefined
        return row && topField.get(row[spec.categoryField]) === s.field ? RADIUS : 0
      })
    }
    series.columns.template.states.create('hover', { fillOpacity: 0.78 })
    if (spec.onSelect) {
      const onSelect = spec.onSelect
      series.columns.template.events.on('click', (ev) => onSelect(ev.target.dataItem?.dataContext as Row))
    }
    if (spec.valueLabels && !stacked && specs.length === 1) {
      series.bullets.push(() =>
        am5.Bullet.new(root, {
          locationX: horizontal ? 1 : 0.5,
          locationY: horizontal ? 0.5 : 1,
          sprite: am5.Label.new(root, {
            text: `{__f_${s.field}}`,
            populateText: true,
            fontSize: 11,
            fill: am5.color(ink.secondary),
            fontWeight: '700',
            ...(horizontal ? { centerY: am5.p50, dx: 6 } : { centerX: am5.p50, centerY: am5.p100, dy: -2 }),
          }),
        }),
      )
    }
    series.data.setAll(data)
    series.appear(500)
  }

  if (specs.length > 1) {
    const legend = chart.children.unshift(am5.Legend.new(root, { x: 0, centerX: 0, marginBottom: 6 }))
    styleLegend(legend)
    legend.data.setAll(chart.series.values)
  }
  chart.appear(500, 50)
  return chart
}

/** A stable key for rebuilding: data and options, without functions. */
export const specKey = (spec: object) => JSON.stringify(spec, (_k, v) => (typeof v === 'function' ? undefined : v))
