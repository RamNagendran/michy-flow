import EntryListPage from '../../components/entries/EntryListPage'
import { itemName, unitOf } from '../../data/catalog'
import { formatKg, formatPercent, formatQty, formatTonnes } from '../../utils/format'

export default function ProductionList() {
  return (
    <EntryListPage
      type="production"
      title="Production"
      subtitle="What each company processed and what came out. Stock reduces by the weight processed. If more than 2% is missing, the Admin is alerted."
      newPath="/production/new"
      newLabel="Record production"
      enter="enter_production"
      kpis={(t) => {
        const p = t.production
        // The two biggest products by weight in the period, in their own units.
        const top = [...p.by_item].filter((i) => i.item !== 'waste').sort((a, b) => b.qty - a.qty).slice(0, 2)
        return [
          { label: 'Processed', value: formatTonnes(p.processed_kg), sub: `${p.count} runs${p.returned_kg ? ` · ${formatKg(p.returned_kg)} returned` : ''}` },
          ...top.map((i) => ({ label: `${itemName(i.item)} produced`, value: unitOf(i.item) === 'L' ? formatQty(i.qty, 'L') : formatTonnes(i.qty), sub: formatQty(i.qty, unitOf(i.item)) })),
          ...Array.from({ length: 2 - top.length }, (_, n) => ({ label: n ? 'Second product' : 'Products', value: '—', sub: 'nothing produced' })),
          {
            label: 'Missing (wastage)',
            value: formatPercent(p.processed_kg ? (p.wastage_kg / p.processed_kg) * 100 : 0),
            sub: `${formatKg(p.wastage_kg)} · ${p.flagged_count} over 2%`,
          },
        ]
      }}
    />
  )
}
