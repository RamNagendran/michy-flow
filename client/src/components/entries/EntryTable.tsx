import { useMemo, useState } from 'react'
import { DatePicker, Input, Pagination, Select, Table, Tag, Tooltip } from 'antd'
import { SearchOutlined, WarningFilled } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { WASTAGE_ALERT_PCT } from '../../data/catalog'
import { useEntries } from '../../hooks/queries/entries'
import { useIsMobile } from '../../hooks/useIsMobile'
import { FilterButton, FilterChips, FilterField, FilterSheet, type FilterChip } from '../FilterSheet'
import type { Company } from '../../types/auth'
import type { EntryRow, EntryStatus, EntryType, EscalatedTo, Grade } from '../../types/entries'
import { formatDate, formatINR, formatKg, formatPercent, formatQty, formatRateIn } from '../../utils/format'
import { GradeTag, SourceTag, StatusTag } from '../ui'
import { GRADES } from '../../data/grades'
import { statusMeta } from '../../utils/entryStatus'
import EntryCards, { Item } from './EntryCards'
import { typeMeta } from './typeMeta'
import EntryDrawer, { type EntryRef } from './EntryDrawer'

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
            {r.open_debit_notes > 0 && (
              <Tooltip title="This supplier has open debit notes from earlier bills. Open the entry to read them.">
                <Tag color="orange" icon={<WarningFilled />} style={{ marginTop: 4 }}>
                  {r.open_debit_notes === 1 ? 'Debit note open' : `${r.open_debit_notes} debit notes open`}
                </Tag>
              </Tooltip>
            )}
          </div>
        ) : (
          <span className="faint">—</span>
        ),
    })
  }
  cols.push(
    { title: only === 'production' ? 'Raw material' : 'Item', key: 'item', render: (_, r) => <Item id={r.item} /> },
    { title: 'Grade', key: 'grade', align: 'center', render: (_, r) => <GradeTag grade={r.grade} /> },
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
  /** Only entries with (true) or without (false) an open escalation. */
  escalated?: boolean
  /** Only entries escalated to this side. */
  escalatedTo?: EscalatedTo
}

/** Entries from the server with search, filters and paging. Click a row for the full entry. On a phone, a card per entry. */
export default function EntryTable({ types, companies, statuses, pageSize = 15, compact, partyId, item, escalated, escalatedTo }: Props) {
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<EntryStatus>()
  const [grade, setGrade] = useState<Grade>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [open, setOpen] = useState<EntryRef | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const mobile = useIsMobile()

  const query = useMemo(
    () => ({
      type: types,
      company_id: companies.map((c) => c.id),
      status: statuses ?? (status ? [status] : undefined),
      grade: grade ? [grade] : undefined,
      party_id: partyId,
      item,
      escalated,
      escalated_to: escalatedTo,
      q: q.trim() || undefined,
      date_from: range?.[0]?.format('YYYY-MM-DD'),
      date_to: range?.[1]?.format('YYYY-MM-DD'),
      page,
      page_size: pageSize,
    }),
    [types, companies, statuses, status, grade, q, range, page, pageSize, partyId, item, escalated, escalatedTo],
  )
  const entries = useEntries(query, companies.length > 0)
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const openRow = (r: EntryRow) => setOpen({ companyId: r.company_id, type: r.type, id: r.id })

  const showStatus = !statuses
  const showGrade = !types.every((t) => t === 'production')
  const statusOptions = (Object.keys(statusMeta) as EntryStatus[]).map((s) => ({ value: s, label: statusMeta[s].label }))
  const gradeOptions = GRADES.map((g) => ({ value: g.id, label: g.name }))
  const search = (
    <Input prefix={<SearchOutlined className="faint" />} placeholder="Search reference, bill no. or party" style={mobile ? { flex: 1, minWidth: 0 } : { width: 280 }} allowClear value={q} onChange={(e) => reset(setQ)(e.target.value)} />
  )
  const count = <Tag style={{ marginInlineEnd: 0 }}>{entries.data?.total ?? 0} entries</Tag>
  // On a phone: filters in use as chips; the pickers themselves are in the sheet.
  const chips: FilterChip[] = [
    showStatus && status && { key: 'status', label: statusMeta[status].label, clear: () => reset(setStatus)(undefined) },
    showGrade && grade && { key: 'grade', label: GRADES.find((g) => g.id === grade)?.name ?? grade, clear: () => reset(setGrade)(undefined) },
    range?.[0] && range[1] && { key: 'dates', label: `${range[0].format('D MMM')} – ${range[1].format('D MMM YYYY')}`, clear: () => reset(setRange)(null) },
  ].filter((c) => !!c)
  const clearFilters = () => {
    setStatus(undefined)
    setGrade(undefined)
    setRange(null)
    setPage(1)
  }

  return (
    <>
      {!compact && !mobile && (
        <div style={{ display: 'flex', gap: 10, padding: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {search}
          {showStatus && <Select allowClear placeholder="Any status" style={{ width: 190 }} value={status} onChange={reset(setStatus)} options={statusOptions} />}
          {showGrade && <Select allowClear placeholder="Any grade" style={{ width: 200 }} value={grade} onChange={reset(setGrade)} options={gradeOptions} />}
          <DatePicker.RangePicker format="DD MMM YYYY" value={range} onChange={reset(setRange)} />
          <div style={{ flex: 1 }} />
          {count}
        </div>
      )}
      {!compact && mobile && (
        <div className="m-list-filters">
          <div className="m-filter-row">
            {search}
            <FilterButton label="Status & dates" count={chips.length} onClick={() => setSheetOpen(true)} />
          </div>
          <FilterChips chips={chips} extra={count} />
          <FilterSheet title="Status & dates" open={sheetOpen} onClose={() => setSheetOpen(false)} onReset={clearFilters} canReset={chips.length > 0}>
            {showStatus && (
              <FilterField label="Status">
                <Select allowClear placeholder="Any status" style={{ width: '100%' }} value={status} onChange={reset(setStatus)} options={statusOptions} />
              </FilterField>
            )}
            {showGrade && (
              <FilterField label="Grade">
                <Select allowClear placeholder="Any grade" style={{ width: '100%' }} value={grade} onChange={reset(setGrade)} options={gradeOptions} />
              </FilterField>
            )}
            <FilterField label="Dates">
              <DatePicker.RangePicker format="DD MMM YYYY" value={range} onChange={reset(setRange)} style={{ width: '100%' }} />
            </FilterField>
          </FilterSheet>
        </div>
      )}
      {mobile ? (
        <>
          <EntryCards rows={entries.data?.items} loading={entries.isFetching} showType={types.length > 1} showCompany={companies.length > 1} onOpen={openRow} />
          {(entries.data?.total ?? 0) > pageSize && (
            <Pagination simple align="center" current={page} pageSize={pageSize} total={entries.data?.total} onChange={setPage} style={{ padding: '4px 0 16px' }} />
          )}
        </>
      ) : (
        <Table<EntryRow>
          scroll={{ x: 'max-content' }}
          rowKey={(r) => `${r.type}-${r.id}`}
          loading={entries.isFetching}
          columns={columnsFor(types, companies.length > 1)}
          dataSource={entries.data?.items}
          pagination={{ current: page, pageSize, total: entries.data?.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: compact }}
          onRow={(r) => ({ onClick: () => openRow(r), style: { cursor: 'pointer' } })}
          locale={{ emptyText: <Tooltip title="Saved entries will show here">Nothing here yet</Tooltip> }}
        />
      )}
      <EntryDrawer entryRef={open} onClose={() => setOpen(null)} />
    </>
  )
}
