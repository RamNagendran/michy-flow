import EntryListPage from '../../components/entries/EntryListPage'
import { itemName } from '../../data/catalog'
import { formatINRShort, formatQty } from '../../utils/format'

export default function SalesList() {
  return (
    <EntryListPage
      type="sale"
      title="Sales"
      subtitle="Grade A sales of what the plant makes, Grade B re-sold raw material, and Grade C invoice-only sales. Oil is sold by the litre. Finalised once Finance verifies them."
      newPath="/sales/new"
      newLabel="Record a sale"
      enter="enter_sales"
      kpis={(t) => {
        // The three items that brought in the most in the period.
        const top = [...t.sales.by_item].sort((a, b) => b.amount - a.amount).slice(0, 3)
        return [
          { label: 'Sales', value: formatINRShort(t.sales.amount), sub: `${t.sales.count} invoices · ${formatINRShort(t.sales.verified_amount)} verified` },
          ...top.map((i) => ({ label: `${itemName(i.item)} sold`, value: formatINRShort(i.amount), sub: formatQty(i.qty, i.unit) })),
          ...Array.from({ length: 3 - top.length }, () => ({ label: 'No other sales', value: '—', sub: 'nothing sold' })),
        ]
      }}
    />
  )
}
