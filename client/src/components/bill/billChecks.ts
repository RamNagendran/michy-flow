import dayjs from 'dayjs'
import type { BillDocument, ParsedBill } from '../../types/documents'
import type { Party } from '../../types/entries'
import type { Unit } from '../../data/catalog'
import { billUnitWord, formatINR, formatQty, formatRateIn, unitWord } from '../../utils/format'

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
  /** Our company and its saved GST number. */
  company?: { name: string; gstin: string | null }
  /** GST numbers on the bill for each side, as the server worked them out. */
  gstOnBill: Pick<BillDocument, 'company_gstin_on_bill' | 'party_gstin_on_bill'>
}

/** Our GST number and the supplier's / buyer's must both be on the bill and match the saved ones. */
function gstChecks(v: Values): Check[] {
  const who = v.isPurchase ? 'Supplier' : 'Buyer'
  const ours = v.gstOnBill.company_gstin_on_bill
  const theirs = v.gstOnBill.party_gstin_on_bill
  const checks: Check[] = []
  if (v.company) {
    const saved = v.company.gstin
    checks.push({
      key: 'gst_company',
      ok: !!saved && ours === saved,
      title: `Our GST number matches (${v.company.name})`,
      detail: !saved
        ? `Add the GST number for ${v.company.name} in Settings → Companies first.`
        : !ours
          ? `Registered ${saved} · not found on the bill. Type it below from the bill.`
          : ours === saved
            ? saved
            : `Registered ${saved} · on the bill ${ours}. If the bill was read wrong, correct it below.`,
    })
  }
  if (v.party) {
    const saved = v.party.gstin
    checks.push({
      key: 'gst_party',
      ok: !!saved && theirs === saved,
      title: `${who}'s GST number matches (${v.party.name})`,
      detail: !saved
        ? `Add the GST number for ${v.party.name} in Suppliers & buyers first.`
        : !theirs
          ? `Registered ${saved} · not found on the bill. Type it below from the bill.`
          : theirs === saved
            ? saved
            : `Registered ${saved} · on the bill ${theirs}. Check the ${who.toLowerCase()}, or correct the number below if it was read wrong.`,
    })
  }
  return checks
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005)

/** Plain-code checks on what the person is about to save, against what the bill says. */
export function billChecks(bill: ParsedBill, v: Values): Check[] {
  const checks: Check[] = gstChecks(v)
  const amount = v.qty * v.rate
  const who = v.isPurchase ? 'supplier' : 'buyer'

  if (bill.taxable_amount) {
    checks.push({
      key: 'math',
      ok: close(amount, bill.taxable_amount.value),
      title: 'Quantity × rate matches the bill amount',
      detail: `${formatQty(v.qty, v.unit)} × ${formatRateIn(v.rate, v.unit)} = ${formatINR(amount, true)} · bill shows ${formatINR(bill.taxable_amount.value, true)}`,
    })
  }
  if (bill.taxable_amount && bill.total) {
    const expected = bill.taxable_amount.value + (bill.tax_amount?.value ?? 0)
    checks.push({
      key: 'total',
      ok: close(expected, bill.total.value),
      title: 'Amount + tax matches the bill total',
      detail: `${formatINR(bill.taxable_amount.value)} + ${formatINR(bill.tax_amount?.value ?? 0, true)} tax = ${formatINR(expected)} · total on bill ${formatINR(bill.total.value)}`,
    })
  }
  if (bill.unit) {
    // A bill in litres for an item kept in kg (or the other way) means the wrong item is chosen.
    checks.push({
      key: 'unit',
      ok: bill.unit === v.unit,
      title: 'Unit matches the item',
      detail: bill.unit === v.unit ? `Bill is in ${billUnitWord(bill.unit_on_bill)}` : `The bill is in ${billUnitWord(bill.unit_on_bill)}, but this item is kept in ${unitWord(v.unit)}. Please check the item.`,
    })
  }
  // Names on bills vary ("Sri Balaji Tyres" vs "SRI BALAJI TYRES PVT LTD"), so a different name is
  // pointed out but does not block saving; only choosing nobody does.
  const billName = bill.party_name?.value?.trim()
  const sameName = !!v.party && !!billName && v.party.name.trim().toLowerCase() === billName.toLowerCase()
  checks.push({
    key: 'party',
    ok: !!v.party,
    title: `${v.isPurchase ? 'Supplier' : 'Buyer'} chosen`,
    detail: !v.party
      ? billName
        ? `The bill says "${billName}" — choose that ${who}, or ask a Manager to add it`
        : `Choose the ${who}`
      : billName && !sameName
        ? `${v.party.name} · the bill says "${billName}"`
        : v.party.name,
  })
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
    checks.push({ key: 'qr', ok: true, title: 'e-Invoice QR code read', detail: 'Bill number, date and total are taken from the QR code on the bill' })
  }
  return checks
}
