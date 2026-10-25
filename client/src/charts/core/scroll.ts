import * as am5 from '@amcharts/amcharts5'
import type * as am5xy from '@amcharts/amcharts5/xy'
import { ink } from './tokens'

interface Options {
  /** 'x' scrolls sideways (columns, lines); 'y' scrolls up and down (horizontal bars, heatmap rows). */
  direction: 'x' | 'y'
  /** Pixels each category needs to stay readable. */
  perCategory: number
  /** Which end is shown first: the start, or the latest periods at the end. */
  from?: 'start' | 'end'
}

/**
 * When the categories don't fit the chart, show only as many as fit and add amCharts' own
 * scrollbar to move through the rest. Axes stay fixed in place.
 */
export function addScrollbar(root: am5.Root, chart: am5xy.XYChart, axis: am5xy.CategoryAxis<am5xy.AxisRenderer>, count: number, { direction, perCategory, from = 'start' }: Options) {
  const room = direction === 'x' ? root.dom.clientWidth - 80 : root.dom.clientHeight - 70
  const fit = Math.max(3, Math.floor(room / perCategory))
  if (count <= fit) return

  const scrollbar = am5.Scrollbar.new(root, { orientation: direction === 'x' ? 'horizontal' : 'vertical', ...(direction === 'x' ? { height: 10, marginTop: 6 } : { width: 10, marginLeft: 6 }) })
  chart.set(direction === 'x' ? 'scrollbarX' : 'scrollbarY', scrollbar)
  // Under the x-axis labels / beside the bars, rather than amCharts' default spot on top.
  if (direction === 'x') chart.bottomAxesContainer.children.push(scrollbar)
  else chart.rightAxesContainer.children.push(scrollbar)

  scrollbar.get('background')?.setAll({ fill: am5.color(ink.grid), fillOpacity: 1 })
  scrollbar.thumb.setAll({ fill: am5.color(ink.muted), fillOpacity: 0.45, cornerRadiusTL: 5, cornerRadiusTR: 5, cornerRadiusBL: 5, cornerRadiusBR: 5 })
  scrollbar.thumb.states.create('hover', { fillOpacity: 0.7 })
  scrollbar.startGrip.set('scale', 0.65)
  scrollbar.endGrip.set('scale', 0.65)

  const [start, end] = from === 'end' ? [count - fit, count] : [0, fit]
  axis.setAll({ start: start / count, end: end / count })
}
