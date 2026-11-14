import { useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Table, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { Help, HintButton } from '../../components/ui'
import { itemName } from '../../data/catalog'
import { useRecordStockCheck } from '../../hooks/queries/wastage'
import { errorMessage } from '../../services/apiError'
import type { CompanyStock } from '../../types/entries'
import type { CountSection } from '../../types/reports'
import { formatQty, qtyInputProps } from '../../utils/format'

const SECTIONS: { key: CountSection; label: string }[] = [
  { key: 'raw', label: 'Grade A raw material' },
  { key: 'output', label: 'Grade A products' },
  { key: 'resale', label: 'Grade B raw material' },
]

interface Row {
  key: string
  section: CountSection
  item: string
  unit: 'kg' | 'L'
  book: number
}

/** Text cut short with "…" when it does not fit; the full text shows on hover. */
const Clip = ({ text, strong }: { text: string; strong?: boolean }) => (
  <Tooltip title={text} placement="topLeft">
    <span className={strong ? 'strong' : 'faint'}>{text}</span>
  </Tooltip>
)

const ColumnTitle = ({ title, hint }: { title: string; hint: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    {title} <Help text={hint} />
  </span>
)

/** The Super Admin's physical count. Leave a line empty to skip it; differences adjust the book stock. */
export default function StockCheckModal({ companyId, stock, open, onClose }: { companyId: number; stock: CompanyStock | undefined; open: boolean; onClose: () => void }) {
  const save = useRecordStockCheck()
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const navigate = useNavigate()
  // Goods of entries still with the Manager may have moved already; counting now would count them twice.
  const waiting = stock?.entries_waiting ?? 0
  const [note, setNote] = useState('')
  const rows: Row[] = SECTIONS.flatMap(({ key }) =>
    (stock?.[key] ?? []).filter((l) => l.provisional.balance || l.provisional.in_qty).map((l) => ({ key: `${key}:${l.item}`, section: key, item: l.item, unit: l.unit, book: l.provisional.balance })),
  )
  const lines = rows.filter((r) => counts[r.key] !== undefined && counts[r.key] !== null).map((r) => ({ section: r.section, item: r.item, counted_qty: counts[r.key]! }))
  const submit = () =>
    save.mutate(
      { companyId, body: { note: note.trim(), lines } },
      {
        onSuccess: () => {
          setCounts({})
          setNote('')
          onClose()
        },
      },
    )

  return (
    <Modal
      open={open}
      width={760}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Count the stock
          <HintButton title="How a stock count works">
            <p>Go to the yard and weigh or count each item. Enter what you found in Counted. Leave a line empty to skip it.</p>
            <p>Book is the stock the app has now, from all purchases, production and sales the Manager has approved, and earlier counts.</p>
            <p>Difference = Book − Counted. Short means less was found than the app shows; extra means more was found.</p>
            <p>When you save, the stock of each counted item becomes what you counted. Skipped items do not change.</p>
            <p>Grade A raw material found missing is also added to this month's wastage. It is already out of stock, so approving the month does not take it out again. Do not change the month's wastage for it.</p>
            <p>You can count only for today, and only when no entry is waiting for the Manager. Their goods may have moved already while the app does not show them yet.</p>
            <p>The count is final. It cannot be changed or deleted later; to correct it, count again. It is saved in the Stock checks list and the audit trail, and the next count date moves on from today.</p>
          </HintButton>
        </span>
      }
     okText={`Save ${lines.length || ''} counted line${lines.length === 1 ? '' : 's'}`} okButtonProps={{ disabled: !lines.length || waiting > 0 }} onOk={submit} onCancel={onClose} confirmLoading={save.isPending}>
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      {waiting > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={`${waiting} entr${waiting === 1 ? 'y is' : 'ies are'} waiting for the Manager`}
          description="Get them approved or rejected first, then count the stock."
          action={
            <Button size="small" onClick={() => navigate('/review')}>
              Open approvals
            </Button>
          }
        />
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <span className="muted" style={{ whiteSpace: 'nowrap' }}>
          Counted today · <b>{dayjs().format('DD MMM YYYY')}</b>
        </span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Note (optional), e.g. Counted with the store keeper" />
      </div>
      <Table<Row>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={rows}
        scroll={{ y: 360 }}
        locale={{ emptyText: 'Nothing in stock to count' }}
        columns={[
          { title: 'Stock', width: 150, ellipsis: { showTitle: false }, render: (_, r) => <Clip text={SECTIONS.find((s) => s.key === r.section)?.label ?? ''} /> },
          { title: 'Item', width: 150, ellipsis: { showTitle: false }, render: (_, r) => <Clip text={itemName(r.item)} strong /> },
          { title: <ColumnTitle title="Book" hint="Stock the app shows now, from entries the Manager has approved." />, width: 130, align: 'right', render: (_, r) => <span className="num">{formatQty(r.book, r.unit)}</span> },
          {
            title: <ColumnTitle title="Counted" hint="What you actually found in the yard. Leave empty to skip." />,
            width: 170,
            render: (_, r) => <InputNumber<number> size="small" style={{ width: '100%' }} value={counts[r.key] ?? null} onChange={(v) => setCounts((c) => ({ ...c, [r.key]: v }))} placeholder="skip" {...qtyInputProps(r.unit)} />,
          },
          {
            title: <ColumnTitle title="Difference" hint="Book − Counted. Short: less found than the app shows. Extra: more found." />,
            align: 'right',
            render: (_, r) => {
              const v = counts[r.key]
              if (v === undefined || v === null) return <span className="faint">—</span>
              const diff = r.book - v
              return (
                <span className="num strong" style={{ color: diff > 0 ? '#D4380D' : diff < 0 ? '#1F9D6B' : undefined }}>
                  {diff > 0 ? `−${formatQty(diff, r.unit)} short` : diff < 0 ? `+${formatQty(-diff, r.unit)} extra` : 'matches'}
                </span>
              )
            },
          },
        ]}
      />
    </Modal>
  )
}
