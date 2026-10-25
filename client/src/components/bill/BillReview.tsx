import { useMemo, useState } from 'react'
import { Alert, Button, Collapse, DatePicker, Input, InputNumber, Progress, Select, Tag, Tooltip } from 'antd'
import { CheckOutlined, DeleteOutlined, ExclamationOutlined, LockFilled, QrcodeOutlined, SafetyCertificateFilled } from '@ant-design/icons'
import dayjs from 'dayjs'
import { itemName, unitOf } from '../../data/catalog'
import { defaultSaleGrade, itemAllowed, itemsFor, stockSection } from '../../data/grades'
import { useParties } from '../../hooks/queries/parties'
import { useStocks } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import type { BillDocument, EntryDraft } from '../../types/documents'
import type { Grade } from '../../types/entries'
import GradePicker from '../entries/GradePicker'
import { formatINR, qtyInputProps } from '../../utils/format'
import { today } from '../../utils/period'
import BillPreview from './BillPreview'
import { billChecks } from './billChecks'
import { XField } from './ReviewField'

type VerifyKey = 'party' | 'qty' | 'rate'
// Checks that stop saving. The others are warnings the person can accept.
const BLOCKING = new Set(['math', 'total', 'party', 'stock', 'unit'])

interface Props {
  doc: BillDocument
  saving: boolean
  onConfirm: (draft: EntryDraft) => void
  onDiscard: () => void
}

/** Compare what was read from the uploaded bill with the bill itself, correct it, then save. */
export default function BillReview({ doc, saving, onConfirm, onDiscard }: Props) {
  const p = doc.parsed
  const isPurchase = doc.kind === 'purchase'
  const access = useAccess()
  const company = access.accessFor(doc.company_id)?.company
  const partyList = useParties(doc.company_id, isPurchase ? 'supplier' : 'buyer')
  const parties = useMemo(() => (partyList.data ?? []).filter((x) => x.is_active), [partyList.data])
  const stocks = useStocks(company && access.canReadStock(company.id) ? [company] : [])

  const [partyId, setPartyId] = useState<number | undefined>(doc.party_id ?? undefined)
  const [invoiceNo, setInvoiceNo] = useState(p.invoice_no?.value ?? '')
  const [date, setDate] = useState(p.invoice_date?.value ?? today())
  const configured = company ?? { category: 'crumb' as const }
  // Purchases default to raw material for production; a sales bill for raw material is a re-sell.
  const [grade, setGradeRaw] = useState<Grade>(isPurchase ? 'A' : (p.grade ?? defaultSaleGrade(p.item?.value)))
  // What was read is kept only if this company deals in it.
  const [item, setItem] = useState<string | undefined>(() => (itemAllowed(doc.kind, grade, configured, p.item?.value) ? p.item?.value : undefined))
  const setGrade = (g: Grade) => {
    setGradeRaw(g)
    if (!itemAllowed(doc.kind, g, configured, item)) setItem(undefined)
  }
  const [qty, setQty] = useState(p.qty?.value ?? 0)
  const [rate, setRate] = useState(p.rate?.value ?? 0)
  const itemUnit = item ? unitOf(item) : (p.unit ?? 'kg')
  const [verified, setVerified] = useState<Record<VerifyKey, boolean>>({ party: false, qty: false, rate: false })
  const tick = (k: VerifyKey) => ({ checked: verified[k], onChange: (v: boolean) => setVerified((s) => ({ ...s, [k]: v })) })

  const party = parties.find((x) => x.id === partyId)
  const line = company && item ? stocks.byCompany.get(company.id)?.[stockSection(doc.kind, grade)].find((l) => l.item === item) : undefined
  const available = line?.provisional.balance ?? null
  const checks = billChecks(p, { party, qty, unit: itemUnit, rate, date, available, isPurchase })
  const blocking = checks.filter((c) => !c.ok && BLOCKING.has(c.key))
  const warnings = checks.filter((c) => !c.ok && !BLOCKING.has(c.key))
  const verifiedCount = Object.values(verified).filter(Boolean).length
  const complete = !!partyId && !!invoiceNo.trim() && !!item && qty > 0 && rate >= 0
  const ready = complete && blocking.length === 0 && verifiedCount === 3 && !doc.duplicate_of
  const progress = Math.round(((checks.length - blocking.length) / checks.length) * 50 + (verifiedCount / 3) * 50)
  // The bill was in tonnes or kilolitres and has been converted.
  const converted = p.unit_on_bill === 'MT' || p.unit_on_bill === 'KL'
  const unitWord = itemUnit === 'L' ? 'litre' : 'kg'

  return (
    <div className="grid fade-in" style={{ gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
      <div style={{ position: 'sticky', top: 92 }}>
        <BillPreview doc={doc} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="surface" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="strong" style={{ fontSize: 16 }}>
                We read this bill for you
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Compare each value with the bill on the left. Amber values need a closer look.
              </div>
            </div>
            <Progress type="circle" percent={progress} size={48} strokeColor={ready ? '#1f9d6b' : '#D82E54'} format={() => <span style={{ fontSize: 12, fontWeight: 800 }}>{progress}%</span>} />
          </div>
          {doc.duplicate_of && <Alert type="error" showIcon style={{ marginTop: 14 }} title={`This bill is already entered as ${doc.duplicate_of}`} description="Open that entry instead of entering it again." />}
          {p.warnings.map((w) => (
            <Alert key={w} type="warning" showIcon style={{ marginTop: 10 }} title={w} />
          ))}
          <Alert
            style={{ marginTop: 14, borderRadius: 10 }}
            type="info"
            showIcon
            icon={<LockFilled />}
            title={<span style={{ fontWeight: 700 }}>Nothing is saved until you confirm.</span>}
            description="Once saved it counts in stock straight away, and becomes final after the Admin approves it and Finance verifies it."
          />
        </div>

        <div className="surface" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div className="strong" style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
              <SafetyCertificateFilled style={{ color: blocking.length ? '#d98a0b' : '#1f9d6b' }} /> Automatic checks
            </div>
            <Tag color={blocking.length ? 'warning' : 'success'} style={{ fontWeight: 700, marginInlineEnd: 0 }}>
              {blocking.length ? `${blocking.length} to fix` : warnings.length ? `${warnings.length} to look at` : `All ${checks.length} passed`}
            </Tag>
          </div>
          {[...blocking, ...warnings, ...checks.filter((c) => c.ok)].map((c) => (
            <div key={c.key} className="check-row">
              <span className={`check-icon ${c.ok ? 'ok' : 'warn'}`}>{c.ok ? <CheckOutlined /> : <ExclamationOutlined />}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ok ? '#1f2329' : '#8a5300', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.key === 'qr' && <QrcodeOutlined />}
                  {c.title}
                </div>
                <div className="muted num" style={{ fontSize: 12.5 }}>
                  {c.detail}
                </div>
              </div>
            </div>
          ))}
          {p.total && p.taxable_amount && !checks.find((c) => c.key === 'math')?.ok && (
            <Button size="small" type="primary" ghost style={{ marginTop: 8 }} onClick={() => qty && setRate(+(p.taxable_amount!.value / qty).toFixed(4))}>
              Work out the rate from the bill amount
            </Button>
          )}
        </div>

        <div className="surface" style={{ padding: 20 }}>
          <div className="strong" style={{ fontSize: 15, marginBottom: 12 }}>
            1. Who and when · {company?.name}
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <XField
              label={isPurchase ? 'Supplier' : 'Buyer'}
              read={p.party_name}
              note={p.party_name ? `On the bill: ${p.party_name.value}` : 'Not found on the bill'}
              verify={tick('party')}
            >
              <Select value={partyId} onChange={setPartyId} style={{ width: '100%' }} loading={partyList.isLoading} options={parties.map((x) => ({ value: x.id, label: x.name }))} placeholder="Choose" showSearch={{ optionFilterProp: 'label' }} />
            </XField>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <XField label="Bill / invoice number" read={p.invoice_no}>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={50} />
              </XField>
              <XField label="Bill date" read={p.invoice_date}>
                <DatePicker value={dayjs(date)} onChange={(d) => d && setDate(d.format('YYYY-MM-DD'))} format="DD MMM YYYY" style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </XField>
            </div>
          </div>
        </div>

        <div className="surface" style={{ padding: 20 }}>
          <div className="strong" style={{ fontSize: 15, marginBottom: 12 }}>
            2. What and how much
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Grade</div>
              <GradePicker kind={doc.kind} value={grade} onChange={setGrade} />
            </div>
            <XField label={isPurchase ? (grade === 'C' ? 'Item' : 'Raw material') : grade === 'A' ? 'Product sold' : 'Item sold'} read={p.item} note={p.item_text ? `Bill says: "${p.item_text}"` : undefined}>
              <Select<string>
                value={item}
                onChange={setItem}
                style={{ width: '100%' }}
                placeholder="Choose"
                options={itemsFor(doc.kind, grade, configured).map((m) => ({ value: m.id as string, label: m.name }))}
              />
            </XField>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <XField label={`Quantity (${itemUnit})`} read={p.qty} note={converted && p.qty_on_bill ? `Bill says ${p.qty_on_bill.value} ${p.unit_on_bill} → converted to ${p.unit}` : undefined} verify={tick('qty')}>
                <InputNumber<number> value={qty} onChange={(v) => setQty(v ?? 0)} style={{ width: '100%' }} {...qtyInputProps(itemUnit)} />
              </XField>
              <XField label={`Rate per ${unitWord}`} read={p.rate} note={converted && p.rate_on_bill ? `Bill says ₹${p.rate_on_bill.value.toLocaleString('en-IN')} per ${p.unit_on_bill}` : undefined} verify={tick('rate')}>
                <InputNumber value={rate} onChange={(v) => setRate(v ?? 0)} style={{ width: '100%' }} prefix="₹" suffix={`/${itemUnit}`} min={0} step={0.1} precision={4} />
              </XField>
            </div>
            <div className="summary-line" style={{ background: '#f7f8fa', borderRadius: 10, padding: '10px 14px' }}>
              <span className="muted">Amount{item ? ` · ${itemName(item)}` : ''}</span>
              <b className="num">{formatINR(qty * rate, true)}</b>
            </div>
          </div>
        </div>

        {doc.lines.length > 0 && (
          <Collapse
            size="small"
            items={[
              {
                key: 'text',
                label: `All text read from the bill (${doc.lines.length} lines)`,
                children: <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0, maxHeight: 280, overflow: 'auto' }}>{doc.lines.join('\n')}</pre>,
              },
            ]}
          />
        )}
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          gridColumn: '1 / -1',
          margin: '0 -32px -48px',
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(8px)',
          borderTop: '1px solid #e8eaee',
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 30,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {blocking.length ? `${blocking.length} check${blocking.length > 1 ? 's' : ''} to fix · ` : ''}
          {verifiedCount} of 3 key values checked by you
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button size="large" icon={<DeleteOutlined />} onClick={onDiscard}>
            Discard
          </Button>
          <Tooltip title={ready ? '' : 'Fill every value, fix the checks and tick the 3 key values'}>
            <Button
              type="primary"
              size="large"
              icon={<CheckOutlined />}
              disabled={!ready}
              loading={saving}
              style={{ minWidth: 220 }}
              onClick={() => onConfirm({ companyId: doc.company_id, partyId: partyId!, grade, invoiceNo: invoiceNo.trim(), date, item: item!, qty, rate, documentId: doc.id })}
            >
              Save for approval
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
