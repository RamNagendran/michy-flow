import { useNavigate } from 'react-router-dom'
import { itemName } from '../../data/catalog'
import type { EntryDetail } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatQty, formatRateIn } from '../../utils/format'
import SavedResult from '../SavedResult'
import { statusMeta } from '../../utils/entryStatus'

const listPath = { purchase: '/purchases', sale: '/sales', production: '/production' }
const what = { purchase: 'Purchase', sale: 'Sale', production: 'Production' }

/** The "saved" screen after any new entry, showing where it is in the approval flow. */
export default function SavedEntry({ entry, again }: { entry: EntryDetail; again: () => void }) {
  const navigate = useNavigate()
  const lines: [string, string][] =
    entry.type === 'production'
      ? [
          ['Raw material processed', `${formatKg(entry.processed_kg ?? entry.qty)} · ${itemName(entry.item)}`],
          ...(entry.returned_kg ? ([['Returned to stock', formatKg(entry.returned_kg)]] as [string, string][]) : []),
          ...entry.outputs.map((o) => [`${itemName(o.product)} produced`, formatQty(o.qty, o.unit)] as [string, string]),
          ['Missing (wastage)', `${formatKg(entry.wastage_kg ?? 0)} (${(entry.wastage_pct ?? 0).toFixed(1)}%)`],
        ]
      : [
          [entry.type === 'sale' ? 'Buyer' : 'Supplier', entry.party_name ?? '—'],
          ['Bill', `${entry.invoice_no} · ${formatDate(entry.entry_date)}`],
          ['Quantity × rate', `${formatQty(entry.qty, entry.unit)} × ${formatRateIn(entry.rate ?? 0, entry.unit)}`],
          ['Value (before GST)', formatINR(entry.amount ?? 0)],
        ]
  const next =
    entry.status === 'approved'
      ? 'You can approve entries yourself, so it went straight to Finance for verification.'
      : 'The company Admin checks it next, then Finance verifies it.'
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
        <>Counted in stock straight away</>,
        <>Becomes final when Finance verifies it</>,
        ...(entry.wastage_flagged ? [<>Wastage is above 2% — the Admin is alerted</>] : []),
      ]}
      actions={[
        { label: `Record another`, onClick: again, primary: true },
        { label: 'View company', onClick: () => navigate(`/companies/${entry.company_id}`) },
        { label: `All ${what[entry.type].toLowerCase()}${entry.type === 'production' ? '' : 's'}`, onClick: () => navigate(listPath[entry.type]) },
      ]}
    />
  )
}
