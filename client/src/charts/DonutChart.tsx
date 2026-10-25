import * as am5 from '@amcharts/amcharts5'
import * as am5percent from '@amcharts/amcharts5/percent'
import { specKey } from './core/categoryChart'
import { ink } from './core/tokens'
import { useAmChart } from './core/useAmChart'

export interface Slice {
  label: string
  value: number
  color: string
}

export interface DonutChartProps {
  /** Up to ~6 slices; fold the rest into "Other" before passing them in. */
  slices: Slice[]
  format: (v: number) => string
  /** Big figure in the hole, e.g. the total. */
  centerValue?: string
  centerLabel?: string
  height?: number
}

/**
 * Part-to-whole at a glance. The legend beside it (plain HTML, so long names wrap) carries each
 * slice's value and share, so nothing depends on matching colours or on hovering.
 */
export default function DonutChart({ height = 200, ...spec }: DonutChartProps) {
  const ref = useAmChart((root) => {
    const total = spec.slices.reduce((s, x) => s + x.value, 0)
    const data = spec.slices
      .filter((s) => s.value > 0)
      .map((s) => ({
        category: s.label,
        value: s.value,
        __f: spec.format(s.value),
        __pct: total ? `${((s.value / total) * 100).toFixed(1)}%` : '0%',
        slice: { fill: am5.color(s.color) },
      }))
    const chart = root.container.children.push(
      am5percent.PieChart.new(root, { innerRadius: am5.percent(66), radius: am5.percent(90), paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }),
    )
    const series = chart.series.push(
      am5percent.PieSeries.new(root, { valueField: 'value', categoryField: 'category', alignLabels: false, }),
    )
    series.labels.template.set('forceHidden', true)
    series.ticks.template.set('forceHidden', true)
    series.slices.template.setAll({
      templateField: 'slice',
      stroke: am5.color(ink.surface),
      strokeWidth: 2,
      cornerRadius: 4,
      tooltipText: `[bold]{__f}[/] · {__pct}\n[fontSize:11px ${ink.muted}]{category}[/]`,
      toggleKey: 'none',
    })
    series.slices.template.states.create('hover', { scale: 1.04 })

    if (spec.centerValue) {
      series.children.push(
        am5.Label.new(root, {
          text: `[fontSize:17px fontWeight:800 ${ink.primary}]${spec.centerValue}[/]${spec.centerLabel ? `\n[fontSize:11px ${ink.muted}]${spec.centerLabel}[/]` : ''}`,
          centerX: am5.p50,
          centerY: am5.p50,
          textAlign: 'center',
        }),
      )
    }

    series.data.setAll(data)
    series.appear(500, 50)
  }, specKey(spec))

  const total = spec.slices.reduce((n, x) => n + x.value, 0)
  return (
    <div className="viz-donut" style={{ height }}>
      <div ref={ref} style={{ width: '46%', maxWidth: height, height, flex: 'none' }} />
      <ul className="viz-donut-legend">
        {spec.slices
          .filter((x) => x.value > 0)
          .map((x) => (
            <li key={x.label}>
              <i style={{ background: x.color }} />
              <span className="name">{x.label}</span>
              <span className="meta">
                <b>{spec.format(x.value)}</b> {total ? `· ${Math.round((x.value / total) * 100)}%` : ''}
              </span>
            </li>
          ))}
      </ul>
    </div>
  )
}
