import type { Dayjs } from 'dayjs'
import type { ImportFields } from '../types/entries'

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'CNY', 'JPY', 'SGD', 'AUD', 'CAD', 'CHF', 'MYR', 'THB', 'SAR', 'KRW', 'LKR']

/** The form values these fields fill, inside a parent antd Form. */
export interface ImportValues {
  currency?: string
  foreignRate?: number
  fxRate?: number
  customsDuty?: number | null
  beNo?: string
  beDate?: Dayjs | null
}

/** ₹ per unit from the foreign price and the exchange rate, as the server works it out. */
export const rupeeRate = (v: ImportValues) => (v.foreignRate && v.fxRate ? Math.round(v.foreignRate * v.fxRate * 10000) / 10000 : 0)

export const toImportFields = (v: ImportValues): Omit<ImportFields, 'origin'> => ({
  currency: v.currency!,
  foreign_rate: v.foreignRate!,
  fx_rate: v.fxRate!,
  customs_duty: v.customsDuty ?? null,
  be_no: v.beNo!.trim(),
  be_date: v.beDate ? v.beDate.format('YYYY-MM-DD') : null,
})
