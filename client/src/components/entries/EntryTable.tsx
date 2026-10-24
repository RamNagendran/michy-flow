import { useMemo, useState } from 'react'
import { DatePicker, Input, Select, Table, Tag, Tooltip } from 'antd'
import { ExperimentOutlined, SearchOutlined, ShopOutlined, ShoppingCartOutlined, WarningFilled } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { itemName, WASTAGE_ALERT_PCT } from '../../data/catalog'
import { useEntries } from '../../hooks/queries/entries'
import type { Company } from '../../types/auth'
import type { EntryRow, EntryStatus, EntryType, Grade } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatPercent, formatQty, formatRateIn } from '../../utils/format'
import { seriesColors } from '../../styles/theme'
import { GradeTag, SourceTag, StatusTag } from '../ui'
import { GRADES } from '../../data/grades'
import { statusMeta } from '../../utils/entryStatus'
import EntryDrawer, { type EntryRef } from './EntryDrawer'

const typeMeta: Record<EntryType, { label: string; fg: string; icon: React.ReactNode }> = {
  purchase: { label: 'Purchase', fg: '#2F6FEB', icon: <ShoppingCartOutlined /> },
  production: { label: 'Production', fg: '#3a3f47', icon: <ExperimentOutlined /> },
  sale: { label: 'Sale', fg: '#D82E54', icon: <ShopOutlined /> },
}

const Item = ({ id }: { id: string }) => (
  <span className="pill" style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#3a3f47' }}>
    <span className="legend-dot" style={{ background: seriesColors[id as keyof typeof seriesColors] ?? '#8a919e' }} />
    {itemName(id)}
  </span>
)

function columnsFor(types: EntryType[], showCompany: boolean): ColumnsType<EntryRow> {
  const only = types.length === 1 ? types[0] : null
  const cols: ColumnsType<EntryRow> = [
    {
      title: 'Entry',
      key: 'ref',
      render: (_, r) => (
        <div>
          <span className="id-link">{r.ref_no}</span>
          <div style={{ fontSize: 12.5, display: 'flex', gap: 6 }}>
            {!only && (
              <span style={{ color: typeMeta[r.type].fg, fontWeight: 700 }}>
                {typeMeta[r.type].icon} {typeMeta[r.type].label} ·
              </span>
            )}
            <span className="faint">{formatDate(r.entry_date)}</span>
          </div>
        </div>
      ),
    },
  ]
  if (showCompany) cols.push({ title: 'Company', key: 'company', render: (_, r) => <b>{r.company_name}</b> })
  if (only !== 'production') {
    cols.push({
      title: only === 'sale' ? 'Buyer' : only === 'purchase' ? 'Supplier' : 'Supplier / buyer',
      key: 'party',
      render: (_, r) =>
        r.party_name ? (
          <div>
            <div style={{ fontWeight: 700 }}>{r.party_name}</div>
            {r.invoice_no && <div className="faint" style={{ fontSize: 12.5 }}>Bill {r.invoice_no}</div>}
          </div>
        ) : (
          <span className="faint">—</span>
        ),
    })
  }
  cols.push(
    { title: only === 'production' ? 'Raw material' : 'Item', key: 'item', render: (_, r) => <Item id={r.item} /> },
    { title: 'Grade', key: 'grade', align: 'center', render: (_, r) => <GradeTag grade={r.grade} type={r.type} /> },
    {
      title: only === 'production' ? 'Input' : 'Quantity',
      key: 'qty',
      align: 'right',
      render: (_, r) => <span className="num strong">{formatQty(r.qty, r.unit)}</span>,
    },
  )
  if (only === 'production' || !only) {
    cols.push({
      title: 'Output · wastage',
      key: 'out',
      align: 'right',
      render: (_, r) =>
        r.output_kg === null ? (
          <span className="faint">—</span>
        ) : (
          <div className="num">
            <div style={{ fontWeight: 700 }}>{formatKg(r.output_kg)}</div>
            <div style={{ fontSize: 12.5, color: (r.wastage_pct ?? 0) > WASTAGE_ALERT_PCT ? '#D4380D' : '#8a919e', fontWeight: 700 }}>
              {(r.wastage_pct ?? 0) > WASTAGE_ALERT_PCT && <WarningFilled />} {formatPercent(r.wastage_pct ?? 0)} wastage
            </div>
          </div>
        ),
    })
  }
  if (only !== 'production') {
    cols.push({
      title: 'Value',
      key: 'value',
      align: 'right',
      render: (_, r) =>
        r.amount === null ? (
          <span className="faint">—</span>
        ) : (
          <div className="num">
            <div style={{ fontWeight: 800 }}>{formatINR(r.amount)}</div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {formatRateIn(r.rate ?? 0, r.unit)}
            </div>
          </div>
        ),
    })
  }
  cols.push({
    title: 'Status',
    key: 'status',
    fixed: 'right',
    render: (_, r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <StatusTag status={r.status} />
        <span className="faint" style={{ fontSize: 12 }}>
          {r.type !== 'production' && <SourceTag source={r.source} />} {r.created_by_name && `by ${r.created_by_name}`}
        </span>
      </div>
    ),
  })
  return cols
}

interface Props {
  types: EntryType[]
  companies: Company[]
  /** Fixed status filter (e.g. a review queue). Hides the status picker. */
  statuses?: EntryStatus[]
  pageSize?: number
  compact?: boolean
  /** Only one supplier's or buyer's entries. */
  partyId?: number
  /** Only this item. */
  item?: string
  /** Only entries Finance escalated to the operations team. */
  escalated?: boolean
}

/** Entries from the server with search, filters and paging. Click a row for the full entry. */
export default function EntryTable({ types, companies, statuses, pageSize = 15, compact, partyId, item, escalated }: Props) {
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<EntryStatus>()
  const [grade, setGrade] = useState<Grade>()
  const [companyId, setCompanyId] = useState<number>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [open, setOpen] = useState<EntryRef | null>(null)

  const query = useMemo(
    () => ({
      type: types,
      company_id: companyId ? [companyId] : companies.map((c) => c.id),
      status: statuses ?? (status ? [status] : undefined),
      grade: grade ? [grade] : undefined,
      party_id: partyId,
      item,
      escalated,
      q: q.trim() || undefined,
      date_from: range?.[0]?.format('YYYY-MM-DD'),
      date_to: range?.[1]?.format('YYYY-MM-DD'),
      page,
      page_size: pageSize,
    }),
    [types, companies, companyId, statuses, status, grade, q, range, page, pageSize, partyId, item, escalated],
  )
  const entries = useEntries(query, companies.length > 0)
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }

  return (
    <>
      {!compact && (
        <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input prefix={<SearchOutlined className="faint" />} placeholder="Search reference, bill no. or party" style={{ width: 280 }} allowClear value={q} onChange={(e) => reset(setQ)(e.target.value)} />
          {companies.length > 1 && (
            <Select allowClear placeholder="All companies" style={{ width: 200 }} value={companyId} onChange={reset(setCompanyId)} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          {!statuses && (
            <Select
              allowClear
              placeholder="Any status"
              style={{ width: 190 }}
              value={status}
              onChange={reset(setStatus)}
              options={(Object.keys(statusMeta) as EntryStatus[]).map((s) => ({ value: s, label: statusMeta[s].label }))}
            />
          )}
          {!types.every((t) => t === 'production') && (
            <Select allowClear placeholder="Any grade" style={{ width: 200 }} value={grade} onChange={reset(setGrade)} options={GRADES.map((g) => ({ value: g.id, label: `${g.name} · ${g.short}` }))} />
          )}
          <DatePicker.RangePicker format="DD MMM YYYY" value={range} onChange={reset(setRange)} />
          <div style={{ flex: 1 }} />
          <Tag style={{ marginInlineEnd: 0 }}>{entries.data?.total ?? 0} entries</Tag>
        </div>
      )}
      <Table<EntryRow>
        scroll={{ x: 'max-content' }}
        rowKey={(r) => `${r.type}-${r.id}`}
        loading={entries.isFetching}
        columns={columnsFor(types, companies.length > 1)}
        dataSource={entries.data?.items}
        pagination={{ current: page, pageSize, total: entries.data?.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: compact }}
        onRow={(r) => ({ onClick: () => setOpen({ companyId: r.company_id, type: r.type, id: r.id }), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Tooltip title="Entries appear here as soon as they are saved">Nothing here yet</Tooltip> }}
      />
      <EntryDrawer entryRef={open} onClose={() => setOpen(null)} />
    </>
  )
}
