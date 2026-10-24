import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Tabs } from 'antd'
import { PageHeader } from '../../components/ui'
import EntryTable from '../../components/entries/EntryTable'
import { useEntries } from '../../hooks/queries/entries'
import { useAccess } from '../../hooks/useAccess'
import type { Company, CompanyPermission } from '../../types/auth'
import type { EntryStatus } from '../../types/entries'

const ALL_TYPES = ['purchase', 'production', 'sale'] as const

interface Queue {
  key: string
  label: string
  hint: string
  statuses: EntryStatus[]
  escalated?: boolean
  /** Companies where this person works this queue. */
  companies: Company[]
}

function QueueLabel({ queue }: { queue: Queue }) {
  const count = useEntries({ status: queue.statuses, company_id: queue.companies.map((c) => c.id), escalated: queue.escalated, page_size: 1 }, queue.companies.length > 0)
  return (
    <span>
      {queue.label} <Badge count={count.data?.total ?? 0} color={queue.key === 'hold' || queue.key === 'escalated' ? '#D4380D' : '#d98a0b'} style={{ marginLeft: 4 }} />
    </span>
  )
}

/** Everything waiting on someone. Admins approve, Finance verifies; everyone sees what is on hold. */
export default function Review() {
  const { scope, can } = useAccess()
  const [params, setParams] = useSearchParams()
  const where = (p: CompanyPermission) => scope.filter((c) => can(p, c.id))

  const queues = useMemo<Queue[]>(() => {
    const approver = scope.filter((c) => can('approve_entry', c.id))
    const verifier = scope.filter((c) => can('verify_entry', c.id))
    const list: Queue[] = []
    if (approver.length) list.push({ key: 'admin', label: 'Waiting for Admin', hint: 'New entries to check and approve, or reject', statuses: ['pending'], companies: approver })
    if (verifier.length) list.push({ key: 'finance', label: 'Waiting for Finance', hint: 'Approved by the Admin; verify or put on hold', statuses: ['approved'], companies: verifier })
    list.push({ key: 'escalated', label: 'Escalated to operations', hint: 'Finance found a data mismatch; fix the entry or resolve it with a note', statuses: ['pending', 'approved', 'on_hold'], escalated: true, companies: scope })
    list.push({ key: 'hold', label: 'On hold', hint: 'Finance found a problem; see the comments', statuses: ['on_hold'], companies: scope })
    list.push({ key: 'open', label: 'Everything in review', hint: 'Not final yet', statuses: ['pending', 'approved', 'on_hold'], companies: scope })
    return list
  }, [scope, can])

  const active = queues.find((q) => q.key === params.get('tab'))?.key ?? queues[0].key
  const subtitle = where('approve_entry').length
    ? 'Check what operators entered, approve it for Finance, or reject it with a reason.'
    : where('verify_entry').length
      ? 'Verify approved entries to finalise stock, or put them on hold with a comment.'
      : 'Your entries that are not final yet. Click one to see comments from the Admin or Finance.'

  return (
    <div className="page">
      <PageHeader title="Approvals" subtitle={subtitle} />
      <div className="surface table-card">
        <div style={{ padding: '4px 20px 0' }}>
          <Tabs
            activeKey={active}
            onChange={(tab) => setParams({ tab }, { replace: true })}
            destroyOnHidden
            items={queues.map((q) => ({
              key: q.key,
              label: <QueueLabel queue={q} />,
              children: (
                <>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
                    {q.hint}
                  </div>
                  <EntryTable types={[...ALL_TYPES]} companies={q.companies} statuses={q.statuses} escalated={q.escalated} />
                </>
              ),
            }))}
          />
        </div>
      </div>
    </div>
  )
}
