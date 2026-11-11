import { useMemo, useState } from 'react'
import { DatePicker, Input, Select, Table, Tag, Tooltip } from 'antd'
import { ArrowRightOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import EntryDrawer, { type EntryRef } from '../../components/entries/EntryDrawer'
import { HintButton, PageHeader } from '../../components/ui'
import { useAuditLogs, type AuditArea } from '../../hooks/queries/audit'
import { useCompanies } from '../../hooks/queries/companies'
import { useUsers } from '../../hooks/queries/users'
import type { AuditLog } from '../../types/auth'
import type { EntryType } from '../../types/entries'
import { actionText, AREAS, changeRows, isEntry, otherFacts, recordText } from './auditText'

const PAGE_SIZE = 25

function Details({ log }: { log: AuditLog }) {
  const changes = changeRows(log)
  const facts = changes.length ? [] : otherFacts(log)
  const comment = typeof log.details.comment === 'string' ? log.details.comment : ''
  if (!changes.length && !facts.length && !comment) return <span className="faint">—</span>
  return (
    <div style={{ display: 'grid', gap: 3, fontSize: 13, maxWidth: 460 }}>
      {changes.map((c) => (
        <div key={c.field}>
          <span className="muted">{c.field}: </span>
          {c.from !== undefined && (
            <>
              <span style={{ textDecoration: 'line-through', color: '#9aa1ad' }}>{c.from}</span> <ArrowRightOutlined style={{ fontSize: 10, color: '#9aa1ad' }} />{' '}
            </>
          )}
          <b>{c.to}</b>
        </div>
      ))}
      {facts.map(([k, v]) => (
        <div key={k}>
          <span className="muted">{k}: </span>
          {v}
        </div>
      ))}
      {comment && <div style={{ fontStyle: 'italic' }}>“{comment}”</div>}
    </div>
  )
}

/** Every change anyone made, newest first. Super Admin only; rows cannot be edited or deleted. */
export default function Audit() {
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [area, setArea] = useState<AuditArea>()
  const [actor, setActor] = useState<number>()
  const [company, setCompany] = useState<number>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [open, setOpen] = useState<EntryRef | null>(null)
  const users = useUsers()
  const companies = useCompanies()

  const query = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      area,
      actor_id: actor,
      company_id: company,
      q: q.trim() || undefined,
      date_from: range?.[0]?.format('YYYY-MM-DD'),
      date_to: range?.[1]?.format('YYYY-MM-DD'),
    }),
    [page, area, actor, company, q, range],
  )
  const logs = useAuditLogs(query)
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <div className="page">
      <PageHeader
        title="Audit trail"
        subtitle="Who did what, and when. Every change by every person."
        extra={
          <HintButton title="About the audit trail">
            <p>Every action is saved here by the server: entries created, edited, approved or rejected, comments, debit notes, wastage, stock counts, suppliers and buyers, people and access, companies, items, bills uploaded, sign-ins and wrong passwords.</p>
            <p>For an edit you see the old value (struck out) and the new value.</p>
            <p>Nobody can change or delete these rows, not even the Super Admin. Only the Super Admin can see this page.</p>
            <p>Click a purchase, production or sale row to open that entry.</p>
          </HintButton>
        }
      />
      <div className="surface table-card">
        <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input prefix={<SearchOutlined className="faint" />} placeholder="Search entry no., name, comment" style={{ width: 260 }} allowClear value={q} onChange={(e) => reset(setQ)(e.target.value)} />
          <Select allowClear placeholder="Everything" style={{ width: 230 }} value={area} onChange={reset(setArea)} options={AREAS} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Anyone"
            style={{ width: 190 }}
            value={actor}
            onChange={reset(setActor)}
            options={users.data?.map((u) => ({ value: u.id, label: u.full_name }))}
          />
          <Select allowClear placeholder="All companies" style={{ width: 190 }} value={company} onChange={reset(setCompany)} options={companies.data?.map((c) => ({ value: c.id, label: c.name }))} />
          <DatePicker.RangePicker format="DD MMM YYYY" value={range} onChange={reset(setRange)} />
          <div style={{ flex: 1 }} />
          <Tag style={{ marginInlineEnd: 0 }}>{logs.data?.total ?? 0} actions</Tag>
        </div>
        <Table<AuditLog>
          scroll={{ x: 'max-content' }}
          rowKey="id"
          loading={logs.isFetching}
          dataSource={logs.data?.items}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: logs.data?.total, onChange: setPage, showSizeChanger: false }}
          onRow={(l) => (isEntry(l) ? { onClick: () => setOpen({ companyId: l.company_id!, type: l.entity_type as EntryType, id: l.entity_id! }), style: { cursor: 'pointer' } } : {})}
          locale={{ emptyText: 'Nothing found' }}
          columns={[
            {
              title: 'When',
              dataIndex: 'created_at',
              render: (v: string) => (
                <div className="num" style={{ whiteSpace: 'nowrap' }}>
                  {dayjs(v).format('DD MMM YYYY')}
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {dayjs(v).format('hh:mm:ss a')}
                  </div>
                </div>
              ),
            },
            { title: 'Who', dataIndex: 'actor_name', render: (v: string | null) => (v ? <b>{v}</b> : <span className="faint">Removed person</span>) },
            {
              title: 'What',
              dataIndex: 'action',
              render: (a: string) => {
                const [label, tone] = actionText(a)
                return (
                  <Tag color={tone} style={{ fontWeight: 700 }}>
                    {label}
                  </Tag>
                )
              },
            },
            { title: 'On', render: (_, l) => (isEntry(l) ? <span className="id-link">{recordText(l)}</span> : recordText(l)) },
            { title: 'Company', dataIndex: 'company_name', render: (v: string | null) => v ?? <span className="faint">—</span> },
            { title: 'Details', render: (_, l) => <Details log={l} /> },
            {
              title: 'IP address',
              dataIndex: 'ip_address',
              render: (v: string | null) => (
                <Tooltip title="The network address the action came from">
                  <span className="num faint">{v ?? '—'}</span>
                </Tooltip>
              ),
            },
          ]}
        />
      </div>
      <EntryDrawer entryRef={open} onClose={() => setOpen(null)} />
    </div>
  )
}
