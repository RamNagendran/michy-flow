import dayjs from 'dayjs'
import type { ParsedBill } from '../../types/documents'
import type { Party } from '../../types/entries'
import type { Unit } from '../../data/catalog'
import { formatINR, formatQty } from '../../utils/format'

export interface Check {
  key: string
  ok: boolean
  title: string
  detail: string
}

interface Values {
  party?: Party
  /** In `unit`, the unit of the chosen item. */
  qty: number
  unit: Unit
  rate: number
  date: string
  available: number | null
  isPurchase: boolean
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005)

/** Plain-code checks on what the person is about to save, against what the bill says. */
export function billChecks(bill: ParsedBill, v: Values): Check[] {
  const checks: Check[] = []
  const amount = v.qty * v.rate
  const who = v.isPurchase ? 'supplier' : 'buyer'

  if (bill.taxable_amount) {
    checks.push({
      key: 'math',
      ok: close(amount, bill.taxable_amount.value),
      title: 'Quantity × rate matches the bill amount',
      detail: `${formatQty(v.qty, v.unit)} × ₹${v.rate.toFixed(2)} = ${formatINR(amount, true)} · bill shows ${formatINR(bill.taxable_amount.value, true)}`,
    })
  }
  if (bill.taxable_amount && bill.total) {
    const expected = bill.taxable_amount.value + (bill.tax_amount?.value ?? 0)
    checks.push({
      key: 'total',
      ok: close(expected, bill.total.value),
      title: 'Amount + GST matches the bill total',
      detail: `${formatINR(bill.taxable_amount.value)} + ${formatINR(bill.tax_amount?.value ?? 0, true)} GST = ${formatINR(expected)} · total on bill ${formatINR(bill.total.value)}`,
    })
  }
  if (bill.unit) {
    // A bill in litres for an item kept in kg (or the other way) means the wrong item is chosen.
    checks.push({
      key: 'unit',
      ok: bill.unit === v.unit,
      title: 'Unit matches the item',
      detail: bill.unit === v.unit ? `Bill is in ${bill.unit_on_bill}` : `The bill is in ${bill.unit_on_bill}, but this item is kept in ${v.unit} — check the item`,
    })
  }
  const billGstin = bill.party_gstin?.value
  checks.push({
    key: 'party',
    ok: !!v.party && (!billGstin || !v.party.gstin || v.party.gstin === billGstin),
    title: `${v.isPurchase ? 'Supplier' : 'Buyer'} matches the GST number`,
    detail: !v.party
      ? billGstin
        ? `No ${who} with GSTIN ${billGstin} in this company's list — choose one, or ask a Manager to add it`
        : `Choose the ${who}`
      : billGstin && v.party.gstin && v.party.gstin !== billGstin
        ? `The bill says ${billGstin}, but ${v.party.name} is ${v.party.gstin}`
        : billGstin
          ? `${billGstin} → ${v.party.name}`
          : `${v.party.name} (no GSTIN on the bill to compare)`,
  })
  if (bill.addressed_to_us !== null) {
    checks.push({
      key: 'ours',
      ok: bill.addressed_to_us,
      title: v.isPurchase ? 'Bill is made out to this company' : 'Invoice is from this company',
      detail: bill.addressed_to_us ? "This company's GSTIN is on the bill" : "This company's GSTIN is not on the bill — is it the right bill?",
    })
  }
  const daysOld = dayjs().diff(dayjs(v.date), 'day')
  checks.push({
    key: 'date',
    ok: daysOld >= 0 && daysOld <= 60,
    title: 'Bill date looks right',
    detail: daysOld < 0 ? 'The date is in the future.' : daysOld > 60 ? `This bill is ${daysOld} days old.` : dayjs(v.date).format('D MMM YYYY'),
  })
  if (!v.isPurchase && v.available !== null) {
    checks.push({ key: 'stock', ok: v.qty <= v.available, title: 'Enough stock to sell', detail: `${formatQty(v.available, v.unit)} available` })
  }
  if (bill.einvoice) {
    checks.push({ key: 'qr', ok: true, title: 'e-Invoice QR code read', detail: 'GSTIN, invoice number, date and total taken from the signed QR code' })
  }
  return checks
}
