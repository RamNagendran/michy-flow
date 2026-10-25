import * as am5 from '@amcharts/amcharts5'
import type * as am5xy from '@amcharts/amcharts5/xy'
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated'
import { ink } from './tokens'

const FONT = "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

/** Quiet chrome shared by every chart: small muted labels, hairline grid, light tooltips. */
function compactTheme(root: am5.Root) {
  const theme = am5.Theme.new(root)
  theme.rule('Label').setAll({ fontFamily: FONT, fontSize: 11.5, fill: am5.color(ink.muted), fontWeight: '600' })
  theme.rule('Grid').setAll({ stroke: am5.color(ink.grid), strokeOpacity: 1, strokeWidth: 1 })
  theme.rule('Tooltip').setAll({ getFillFromSprite: false, getLabelFillFromSprite: false, autoTextColor: false, paddingTop: 6, paddingBottom: 6, paddingLeft: 9, paddingRight: 9 })
  theme.rule('PointedRectangle', ['tooltip', 'background']).setAll({
    fill: am5.color(ink.surface),
    fillOpacity: 1,
    stroke: am5.color(ink.border),
    strokeOpacity: 1,
    cornerRadius: 8,
    shadowColor: am5.color(0x101828),
    shadowBlur: 12,
    shadowOffsetY: 4,
    shadowOpacity: 0.12,
  })
  theme.rule('Label', ['tooltip']).setAll({ fill: am5.color(ink.primary), fontSize: 12, fontWeight: '600' })
  return theme
}

/** A chart root in `el`. Tooltips may spill outside the small chart box so they are never clipped. */
export function createRoot(el: HTMLElement) {
  const root = am5.Root.new(el, { tooltipContainerBounds: { top: 40, right: 160, bottom: 40, left: 160 } })
  root.setThemes([am5themes_Animated.new(root), compactTheme(root)])
  root.interfaceColors.setAll({ grid: am5.color(ink.grid), text: am5.color(ink.secondary), background: am5.color(ink.surface) })
  root.numberFormatter.set('numberFormat', '#,###.##')
  // Every chart is built through here, so this removes the amCharts logo everywhere.
  // Cleared too, because amCharts calls show() on it again whenever a chart resizes.
  root._logo?.dispose()
  root._logo = undefined
  return root
}

/** Adds `__f_<field>` (display text) to each row, so tooltips and labels show the app's own formats. */
export function withFormatted<T extends object>(rows: T[], fields: string[], format: (v: number) => string) {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
    for (const f of fields) {
      const v = (row as Record<string, unknown>)[f]
      out[`__f_${f}`] = v === null || v === undefined ? '—' : format(Number(v))
    }
    return out
  })
}

/** Marks a label that belongs to an axis range (target, band), so axis formatting leaves its text alone. */
export const RANGE_LABEL = { range: true }

/** Value-axis labels in the app's own number format. */
export function formatAxisLabels(renderer: am5xy.AxisRenderer, format: (v: number) => string) {
  renderer.labels.template.adapters.add('text', (text, target) => {
    if (target.get('userData') === RANGE_LABEL) return text
    const value = target.dataItem?.get('value' as never) as number | undefined
    return value === undefined || value === null ? text : format(value)
  })
}

/** Legend in the shared compact style: small rounded swatches, secondary ink, never the series colour as text. */
export function styleLegend(legend: am5.Legend) {
  legend.markers.template.setAll({ width: 10, height: 10 })
  legend.markerRectangles.template.setAll({ cornerRadiusTL: 3, cornerRadiusTR: 3, cornerRadiusBL: 3, cornerRadiusBR: 3 })
  legend.labels.template.setAll({ fontSize: 12, fill: am5.color(ink.secondary), fontWeight: '700' })
  legend.itemContainers.template.setAll({ paddingTop: 2, paddingBottom: 2, paddingLeft: 0, paddingRight: 8 })
  return legend
}

export { am5 }
