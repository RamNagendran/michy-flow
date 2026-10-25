import { buildCategoryChart, specKey, type CategoryChartSpec } from './core/categoryChart'
import { useAmChart } from './core/useAmChart'

export type StackedBarChartProps = Omit<CategoryChartSpec, 'horizontal' | 'stacked' | 'valueLabels'> & { height?: number }

/** Horizontal bars split into parts. Good for a few rows with long names, or shares (`percent`). */
export default function StackedBarChart({ height = 160, ...rest }: StackedBarChartProps) {
  const spec = { ...rest, stacked: true, horizontal: true }
  const ref = useAmChart((root) => buildCategoryChart(root, spec), specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
