import { theme as antdTheme, type ThemeConfig } from 'antd'

export const brand = {
  primary: '#D82E54',
  primaryDark: '#B8213F',
  primarySoft: '#FDEEF2',
  ink: '#191919',
  text: '#1F2329',
  textSecondary: '#5B6270',
  textTertiary: '#8A919E',
  border: '#E8EAEE',
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  green: '#1F9D6B',
  greenSoft: '#E8F6EF',
  amber: '#D98A0B',
  amberSoft: '#FFF6E6',
  red: '#D4380D',
  blue: '#2F6FEB',
  blueSoft: '#EDF3FF',
}

/**
 * Colours for each raw material / output product, used consistently in every chart and tag.
 * Each group is validated for colour-blind separation (dataviz validate_palette.js).
 */
export const seriesColors = {
  truck: '#2F6FEB',
  car: '#0F9D8A',
  twowheeler: '#B8860B',
  otr: '#7A5AF8',
  tractor: '#5E8C31',
  scrap_steel: '#6B7280',
  oil: '#C2410C',
  carbon: '#27272A',
  waste_water: '#0EA5E9',
  waste: '#A1A1AA',
  rubber: '#D82E54',
  steel: '#4A7FC1',
  other: '#B8860B',
  purchase: '#4A7FC1',
  sales: '#D82E54',
  margin: '#0E9384',
}

export const theme: ThemeConfig = {
  token: {
    colorPrimary: brand.primary,
    colorInfo: brand.blue,
    colorSuccess: brand.green,
    colorWarning: brand.amber,
    colorError: brand.red,
    colorText: brand.text,
    colorTextSecondary: brand.textSecondary,
    colorTextTertiary: brand.textTertiary,
    colorBorder: '#DDE0E6',
    colorBorderSecondary: brand.border,
    colorBgLayout: brand.bg,
    fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 14,
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 6,
    controlHeight: 40,
    controlHeightLG: 46,
    controlHeightSM: 30,
    boxShadowTertiary: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
  },
  components: {
    Layout: { siderBg: brand.ink, headerBg: '#FFFFFF', bodyBg: brand.bg, headerHeight: 68, headerPadding: '0 28px' },
    Menu: {
      darkItemBg: brand.ink,
      darkSubMenuItemBg: brand.ink,
      darkItemSelectedBg: 'rgba(216, 46, 84, 0.16)',
      darkItemSelectedColor: '#FFFFFF',
      darkItemColor: 'rgba(255,255,255,0.66)',
      darkItemHoverColor: '#FFFFFF',
      darkItemHoverBg: 'rgba(255,255,255,0.06)',
      itemHeight: 44,
      itemBorderRadius: 10,
      itemMarginInline: 12,
      iconSize: 17,
      collapsedIconSize: 18,
    },
    Card: { headerFontSize: 16, paddingLG: 22 },
    Table: {
      headerBg: '#F8F9FB',
      headerColor: brand.textSecondary,
      headerSplitColor: 'transparent',
      rowHoverBg: '#FBF6F8',
      cellPaddingBlock: 14,
      cellPaddingInline: 14,
    },
    Button: { fontWeight: 600, primaryShadow: '0 4px 12px rgba(216, 46, 84, 0.22)' },
    Tabs: { titleFontSize: 15, horizontalItemPadding: '12px 4px' },
    Segmented: { itemSelectedColor: brand.ink, trackBg: '#EEF0F3' },
    Steps: { iconSize: 34 },
    Form: { labelFontSize: 14, verticalLabelPadding: '0 0 6px', itemMarginBottom: 20 },
    Tag: { defaultBg: '#F2F3F5' },
    Statistic: { contentFontSize: 26 },
  },
}

/**
 * Dark variant of the same tokens. Not switchable yet: the page CSS in global.css is light-only,
 * so wire a theme toggle only once those styles use CSS variables for both modes.
 */
export const darkTheme: ThemeConfig = {
  ...theme,
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...theme.token,
    colorText: undefined,
    colorTextSecondary: undefined,
    colorTextTertiary: undefined,
    colorBorder: undefined,
    colorBorderSecondary: undefined,
    colorBgLayout: undefined,
  },
  components: {
    ...theme.components,
    Layout: { ...theme.components?.Layout, headerBg: '#141414', bodyBg: '#0f0f10' },
    Table: { ...theme.components?.Table, headerBg: undefined, headerColor: undefined, rowHoverBg: undefined },
  },
}
