import { buildCategoryChart, specKey, type CategoryChartSpec } from './core/categoryChart'
import { useAmChart } from './core/useAmChart'

export type StackedColumnChartProps = Omit<CategoryChartSpec, 'horizontal' | 'stacked' | 'valueLabels'> & { height?: number }

/**
 * Vertical columns split into parts (part-to-whole per category or period).
 * `percent` stacks to 100% to compare shares instead of totals.
 */
export default function StackedColumnChart({ height = 220, ...rest }: StackedColumnChartProps) {
  const spec = { ...rest, stacked: true }
  const ref = useAmChart((root) => buildCategoryChart(root, spec), specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
