import EntryListPage from '../../components/entries/EntryListPage'
import type { GradeTotal } from '../../types/entries'
import { formatINRShort, formatKg, formatTonnes } from '../../utils/format'

// Goods that really arrived: Grade C is a paper record only.
const physical = (grades: GradeTotal[]) => grades.filter((g) => g.grade !== 'C').reduce((s, g) => s + g.qty_kg, 0)

export default function PurchasesList() {
  return (
    <EntryListPage
      type="purchase"
      title="Purchases"
      subtitle="Every purchase bill: Grade A raw material for production, Grade B raw material to re-sell, and Grade C invoice-only records. New bills count in stock straight away and are finalised once Finance verifies them."
      newPath="/purchases/new"
      newLabel="Record a purchase"
      enter="enter_purchase"
      kpis={(t) => [
        { label: 'Bills', value: String(t.purchases.count), sub: 'not counting rejected' },
        { label: 'Raw material received', value: formatTonnes(physical(t.purchases.by_grade)), sub: `${formatKg(physical(t.purchases.by_grade))} · Grade A and B` },
        { label: 'Spent', value: formatINRShort(t.purchases.amount), sub: `${formatINRShort(t.purchases.verified_amount)} verified` },
        { label: 'Waiting for review', value: String(t.queue.pending + t.queue.approved + t.queue.on_hold), sub: 'all entry types, any date' },
      ]}
    />
  )
}
