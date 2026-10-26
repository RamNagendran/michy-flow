import { useState } from 'react'
import { Alert, DatePicker, Input, InputNumber, Modal, Table } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { itemName } from '../../data/catalog'
import { useRecordStockCheck } from '../../hooks/queries/wastage'
import { errorMessage } from '../../services/apiError'
import type { CompanyStock } from '../../types/entries'
import type { CountSection } from '../../types/reports'
import { formatQty, qtyInputProps } from '../../utils/format'

const SECTIONS: { key: CountSection; label: string }[] = [
  { key: 'raw', label: 'Grade A raw material' },
  { key: 'output', label: 'Grade A products' },
  { key: 'resale', label: 'Grade B re-sell' },
]

interface Row {
  key: string
  section: CountSection
  item: string
  unit: 'kg' | 'L'
  book: number
}

/** The Admin's physical count. Leave a line empty to skip it; differences adjust the book stock. */
export default function StockCheckModal({ companyId, stock, open, onClose }: { companyId: number; stock: CompanyStock | undefined; open: boolean; onClose: () => void }) {
  const save = useRecordStockCheck()
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [day, setDay] = useState<Dayjs>(dayjs())
  const [note, setNote] = useState('')
  const rows: Row[] = SECTIONS.flatMap(({ key }) =>
    (stock?.[key] ?? []).filter((l) => l.provisional.balance || l.provisional.in_qty).map((l) => ({ key: `${key}:${l.item}`, section: key, item: l.item, unit: l.unit, book: l.provisional.balance })),
  )
  const lines = rows.filter((r) => counts[r.key] !== undefined && counts[r.key] !== null).map((r) => ({ section: r.section, item: r.item, counted_qty: counts[r.key]! }))
  const submit = () =>
    save.mutate(
      { companyId, body: { counted_on: day.format('YYYY-MM-DD'), note: note.trim(), lines } },
      {
        onSuccess: () => {
          setCounts({})
          setNote('')
          onClose()
        },
      },
    )

  return (
    <Modal open={open} width={760} title="Count the stock" okText={`Save ${lines.length || ''} counted line${lines.length === 1 ? '' : 's'}`} okButtonProps={{ disabled: !lines.length }} onOk={submit} onCancel={onClose} confirmLoading={save.isPending}>
      <Alert type="info" showIcon style={{ marginBottom: 14 }} title="Enter the stock you counted. The app saves the difference and corrects the stock." />
      {save.isError && <Alert type="error" showIcon title={errorMessage(save.error)} style={{ marginBottom: 12 }} />}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <DatePicker value={day} onChange={(d) => d && setDay(d)} format="DD MMM YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
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
          { title: 'Stock', render: (_, r) => <span className="faint">{SECTIONS.find((s) => s.key === r.section)?.label}</span> },
          { title: 'Item', render: (_, r) => <b>{itemName(r.item)}</b> },
          { title: 'Book', align: 'right', render: (_, r) => <span className="num">{formatQty(r.book, r.unit)}</span> },
          {
            title: 'Counted',
            width: 170,
            render: (_, r) => <InputNumber<number> size="small" style={{ width: '100%' }} value={counts[r.key] ?? null} onChange={(v) => setCounts((c) => ({ ...c, [r.key]: v }))} placeholder="skip" {...qtyInputProps(r.unit)} />,
          },
          {
            title: 'Difference',
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
