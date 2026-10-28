import { useNavigate } from 'react-router-dom'
import { useAccess } from '../../hooks/useAccess'
import { itemName } from '../../data/catalog'
import type { EntryDetail } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatKgFine, formatQty, formatRateIn } from '../../utils/format'
import SavedResult from '../SavedResult'
import { statusMeta } from '../../utils/entryStatus'

const listPath = { purchase: '/purchases', sale: '/sales', production: '/production' }
const what = { purchase: 'Purchase', sale: 'Sale', production: 'Production' }

/** The "saved" screen after any new entry, showing where it is in the approval flow. */
export default function SavedEntry({ entry, again }: { entry: EntryDetail; again: () => void }) {
  const navigate = useNavigate()
  const access = useAccess()
  const lines: [string, string][] =
    entry.type === 'production'
      ? [
          ...entry.outputs.map((o) => [`${itemName(o.product)} produced`, formatQty(o.qty, o.unit)] as [string, string]),
          ['Products total', formatKg(entry.output_kg ?? 0)],
          [`Wastage (${(entry.wastage_pct ?? 0).toFixed(0)}%)`, formatKgFine(entry.wastage_kg ?? 0)],
          ...(entry.returned_kg ? ([['Returned to stock', formatKg(entry.returned_kg)]] as [string, string][]) : []),
          ['Taken out of stock', `${formatKg(entry.processed_kg ?? entry.qty)} · ${itemName(entry.item)}`],
        ]
      : [
          [entry.type === 'sale' ? 'Buyer' : 'Supplier', entry.party_name ?? '—'],
          ['Bill', `${entry.invoice_no} · ${formatDate(entry.entry_date)}`],
          ['Quantity × rate', `${formatQty(entry.qty, entry.unit)} × ${formatRateIn(entry.rate ?? 0, entry.unit)}`],
          ['Value', formatINR(entry.amount ?? 0)],
        ]
  const next = 'The Manager checks it next. Then Finance gives the final approval.'
  return (
    <SavedResult
      title={`${what[entry.type]} saved`}
      subtitle={
        <>
          Status: <b>{statusMeta[entry.status].label}</b>. {next}
        </>
      }
      refId={entry.ref_no}
      lines={lines}
      effects={[
        <>Goes into stock when the Manager approves it</>,
        <>Becomes final when Finance approves it</>,
        ...(entry.wastage_flagged ? [<>Wastage is above 2%. The Manager is told.</>] : []),
      ]}
      actions={[
        { label: `Record another`, onClick: again, primary: true },
        ...(access.can('view_stock', entry.company_id) ? [{ label: 'View company', onClick: () => navigate(`/companies/${entry.company_id}`) }] : []),
        { label: `All ${what[entry.type].toLowerCase()}${entry.type === 'production' ? '' : 's'}`, onClick: () => navigate(listPath[entry.type]) },
      ]}
    />
  )
}
