import { useMemo } from 'react'
import EntryTable from '../../components/entries/EntryTable'
import { PageHeader } from '../../components/ui'
import { useAccess } from '../../hooks/useAccess'
import { SCREEN_ACCESS } from '../../utils/permissions'

const ALL = ['purchase', 'production', 'sale'] as const

export default function Records() {
  // Only companies where this person may see records, even in the "all companies" view.
  const { scope, can } = useAccess()
  const companies = useMemo(() => scope.filter((c) => SCREEN_ACCESS.records.some((p) => can(p, c.id))), [scope, can])
  return (
    <div className="page">
      <PageHeader title="All records" subtitle="All purchases, production and sales in one place, with status and history." />
      <div className="surface table-card">
        <EntryTable types={[...ALL]} companies={companies} pageSize={20} />
      </div>
    </div>
  )
}
