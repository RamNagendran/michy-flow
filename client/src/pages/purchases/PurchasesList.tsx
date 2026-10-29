import EntryListPage from '../../components/entries/EntryListPage'
import type { GradeTotal } from '../../types/entries'
import { formatINRShort, formatKg } from '../../utils/format'

// Goods that really arrived: Grade C is a paper record only.
const physical = (grades: GradeTotal[]) => grades.filter((g) => g.grade !== 'C').reduce((s, g) => s + g.qty_kg, 0)

export default function PurchasesList() {
  return (
    <EntryListPage
      type="purchase"
      title="Purchases"
      subtitle="All purchase bills. Grade A: tyres for the plant. Grade B: tyres to sell again. Grade C: bill only, no goods. Stock changes when the Manager approves. Bills become final after Finance approves."
      newPath="/purchases/new"
      newLabel="Record a purchase"
      enter="enter_purchase"
      kpis={(t) => [
        { label: 'Bills', value: String(t.purchases.count), sub: 'not counting rejected' },
        { label: 'Raw material received', value: formatKg(physical(t.purchases.by_grade)), sub: 'Grade A and B' },
        { label: 'Spent', value: formatINRShort(t.purchases.amount), sub: `${formatINRShort(t.purchases.verified_amount)} verified` },
        { label: 'Waiting for review', value: String(t.queue.pending + t.queue.approved + t.queue.change_requested), sub: 'all entry types, any date' },
      ]}
    />
  )
}
