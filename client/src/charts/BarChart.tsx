import { buildCategoryChart, specKey, type CategoryChartSpec } from './core/categoryChart'
import { useAmChart } from './core/useAmChart'

export type BarChartProps = Omit<CategoryChartSpec, 'horizontal' | 'stacked' | 'percent'> & { height?: number }

/**
 * Horizontal bars, best for ranking and for long category names (products, suppliers).
 * Each bar gets ~28px; more than fit → an amCharts scrollbar beside the bars.
 */
export default function BarChart({ height = 220, valueLabels = true, ...rest }: BarChartProps) {
  const spec = { ...rest, valueLabels, horizontal: true }
  const ref = useAmChart((root) => buildCategoryChart(root, spec), specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
