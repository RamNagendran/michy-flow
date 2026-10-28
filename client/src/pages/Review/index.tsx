import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Tabs } from 'antd'
import { PageHeader } from '../../components/ui'
import EntryTable from '../../components/entries/EntryTable'
import { useEntries } from '../../hooks/queries/entries'
import { useAccess } from '../../hooks/useAccess'
import type { Company, CompanyPermission } from '../../types/auth'
import type { EntryStatus, EscalatedTo } from '../../types/entries'

const ALL_TYPES = ['purchase', 'production', 'sale'] as const
const URGENT = new Set(['incharge', 'from_finance', 'changes'])

interface Queue {
  key: string
  label: string
  hint: string
  statuses?: EntryStatus[]
  escalated?: boolean
  escalatedTo?: EscalatedTo
  /** Companies where this person works this queue. */
  companies: Company[]
}

function QueueLabel({ queue }: { queue: Queue }) {
  const count = useEntries({ status: queue.statuses, company_id: queue.companies.map((c) => c.id), escalated: queue.escalated, escalated_to: queue.escalatedTo, page_size: 1 }, queue.companies.length > 0)
  return (
    <span>
      {queue.label} <Badge count={count.data?.total ?? 0} color={URGENT.has(queue.key) ? '#D4380D' : '#d98a0b'} style={{ marginLeft: 4 }} />
    </span>
  )
}

/**
 * Everything waiting on someone. In-charge → Manager → Finance; the Manager can ask the Super
 * Admin to change an entry. Each open entry sits in exactly one of the first five tabs.
 */
export default function Review() {
  const { scope, can } = useAccess()
  const [params, setParams] = useSearchParams()
  const where = (p: CompanyPermission) => scope.filter((c) => can(p, c.id))

  const queues = useMemo<Queue[]>(
    () => [
      { key: 'manager', label: 'Waiting for Manager', hint: 'New entries. Approve, escalate to the in-charge, or ask the Super Admin to change.', statuses: ['pending'], escalated: false, companies: scope },
      { key: 'incharge', label: 'Sent back to in-charge', hint: 'The Manager asked the in-charge a question. Talk in the comments, then approve.', escalatedTo: 'incharge', companies: scope },
      { key: 'finance', label: 'Waiting for Finance', hint: 'Approved by the Manager and in stock. Finance approves or escalates to the Manager.', statuses: ['approved'], escalated: false, companies: scope },
      { key: 'from_finance', label: 'Sent back to Manager', hint: 'Finance asked the Manager a question. Reply in the comments. Finance approves when they agree.', escalatedTo: 'manager', companies: scope },
      { key: 'changes', label: 'With Super Admin', hint: 'The Manager asked for a change. The Super Admin changes it or rejects it.', statuses: ['change_requested'], companies: scope },
      { key: 'open', label: 'Everything not final', hint: 'All entries that are not final yet', statuses: ['pending', 'approved', 'change_requested'], companies: scope },
    ],
    [scope],
  )

  // Open on the person's own work.
  const ownQueue = where('edit_entry').length ? 'changes' : where('approve_entry').length ? 'manager' : where('verify_entry').length ? 'finance' : 'open'
  const active = queues.find((q) => q.key === params.get('tab'))?.key ?? ownQueue
  const subtitle = where('edit_entry').length
    ? 'Change or reject the entries the Manager sent you. Every step is saved in the history.'
    : where('approve_entry').length
      ? 'Check what in-charges entered. Approve, escalate to the in-charge, or ask the Super Admin to change it.'
      : where('verify_entry').length
        ? 'Give the final approval, or escalate to the Manager with a comment.'
        : 'Entries that are not final yet. Click one to see the comments.'

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
                  <EntryTable types={[...ALL_TYPES]} companies={q.companies} statuses={q.statuses} escalated={q.escalated} escalatedTo={q.escalatedTo} />
                </>
              ),
            }))}
          />
        </div>
      </div>
    </div>
  )
}
