import dayjs from 'dayjs'

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** ₹12,45,000 */
export const formatINR = (value: number, decimals = false) =>
  `₹${(decimals ? inr2 : inr).format(Math.round(value * (decimals ? 100 : 1)) / (decimals ? 100 : 1))}`

/**
 * Units in full words on screen, never short forms: "L" could be read as lakh or litre.
 * Weights are always in kg (never tonnes), which everybody knows.
 */
export const unitWord = (unit: 'kg' | 'L') => (unit === 'L' ? 'litres' : 'kg')
/** Units printed on a scanned bill, in words: MT → tonnes, KL → kilolitres. */
export const billUnitWord = (u: string | null | undefined) => ({ KG: 'kg', MT: 'tonnes', L: 'litres', KL: 'kilolitres (1,000 litres)' })[u ?? ''] ?? u ?? ''
/** "per kg" · "per litre" */
export const perUnit = (unit: 'kg' | 'L') => (unit === 'L' ? 'per litre' : 'per kg')

/** ₹12.45 lakh / ₹1.24 crore for headline numbers */
export const formatINRShort = (value: number) => {
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} crore`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} lakh`
  return `${sign}${formatINR(abs)}`
}

/** 12,400 kg */
export const formatKg = (kg: number) => `${inr.format(Math.round(kg))} kg`

const kgOneDecimal = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
/** 9.8 kg: for small weights like wastage, where rounding to whole kg hides the figure. */
export const formatKgFine = (kg: number) => `${kgOneDecimal.format(kg)} kg`

export const formatNumber = (n: number) => inr.format(Math.round(n))

export const formatPercent = (value: number, digits = 1) => `${value.toFixed(digits)}%`

export const formatDate = (iso: string) => dayjs(iso).format('DD MMM YYYY')
export const formatDateShort = (iso: string) => dayjs(iso).format('DD MMM')

/** For antd InputNumber: shows 12,400 and reads it back as 12400. */
export const kgInputProps = {
  min: 0,
  suffix: 'kg',
  formatter: (v: number | string | undefined) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
  parser: (v: string | undefined) => Number((v ?? '').replace(/,/g, '')),
}

const qtyFormat = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** 12,400 kg · 3,000 litres */
export const formatQty = (qty: number, unit: 'kg' | 'L' = 'kg') => `${qtyFormat.format(Math.round(qty))} ${unitWord(unit)}`

/** ₹14.20 per kg · ₹42.50 per litre */
export const formatRateIn = (rate: number, unit: 'kg' | 'L' = 'kg') => `₹${rate.toFixed(2)} ${perUnit(unit)}`

/** For antd InputNumber in the item's unit. */
export const qtyInputProps = (unit: 'kg' | 'L' = 'kg') => ({ ...kgInputProps, suffix: unitWord(unit) })
