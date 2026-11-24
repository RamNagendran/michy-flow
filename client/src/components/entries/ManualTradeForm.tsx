import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, DatePicker, Form, Input, InputNumber, Select } from 'antd'
import { ArrowLeftOutlined, CheckCircleFilled, CheckOutlined, CloseCircleFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { itemName, unitOf } from '../../data/catalog'
import { gradeInfo, itemAllowed, itemsFor, stockSection } from '../../data/grades'
import { useParties } from '../../hooks/queries/parties'
import { useStocks } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { formatINR, formatQty, formatRateIn, perUnit, qtyInputProps } from '../../utils/format'
import { isValidGstin, normaliseGstin } from '../../utils/gstin'
import type { EntryDraft } from '../../types/documents'
import type { Grade } from '../../types/entries'
import GradePicker from './GradePicker'
import VehicleNumbersInput from './VehicleNumbersInput'
import { requiredMark } from '../../utils/formMarks'
import SaleableStock from '../SaleableStock'
import SupplierDebitNotes from '../debitNotes/DebitNoteList'

interface Values {
  companyId: number
  partyId: number
  grade: Grade
  item: string
  invoiceNo: string
  date: Dayjs
  qty: number
  rate: number
  vehicleNos?: string[]
  billCompanyGstin: string
  billPartyGstin: string
}

/** A GST number typed from the paper bill: required, in format, and the registered one. */
const gstRule = (registered: string | null | undefined, missing: string) => ({
  required: true,
  validator: async (_: unknown, value?: string) => {
    const typed = normaliseGstin(value ?? '')
    if (!registered) throw new Error(missing)
    if (!typed) throw new Error('Type the GST number from the bill')
    if (!isValidGstin(typed)) throw new Error('This GST number is not in the right format. Please check it.')
    if (typed !== registered) throw new Error('Does not match the registered GST number. Check the bill.')
  },
})

/** Tick when the typed number is the registered one, cross when it is not. Always a suffix, so the cursor stays. */
const gstSuffix = (registered: string | null | undefined, value?: string) => {
  const typed = normaliseGstin(value ?? '')
  return registered && typed === registered ? <CheckCircleFilled style={{ color: '#1f9d6b' }} /> : typed ? <CloseCircleFilled style={{ color: '#D4380D' }} /> : <span />
}

/** Type in a purchase bill or a sales invoice by hand. Only companies the person may enter for. */
export default function ManualTradeForm({ kind, saving, onSaved, back }: { kind: 'purchase' | 'sale'; saving: boolean; onSaved: (d: EntryDraft) => void; back: () => void }) {
  const isPurchase = kind === 'purchase'
  const navigate = useNavigate()
  const access = useAccess()
  const { companiesWith } = access
  const companies = useMemo(() => companiesWith(isPurchase ? 'enter_purchase' : 'enter_sales'), [companiesWith, isPurchase])
  const [form] = Form.useForm<Values>()
  const qty = Form.useWatch('qty', form) ?? 0
  const rate = Form.useWatch('rate', form) ?? 0
  const companyId = Form.useWatch('companyId', form)
  const partyId = Form.useWatch('partyId', form)
  // Purchases: the supplier's open debit notes settled on this bill.
  const [notesOff, setNotesOff] = useState<number[]>([])
  const item = Form.useWatch('item', form)
  const grade: Grade = Form.useWatch('grade', form) ?? 'A'
  const company = companies.find((c) => c.id === companyId)
  const parties = useParties(companyId, isPurchase ? 'supplier' : 'buyer')
  // A purchase-only operator has no access to stock figures; the form then skips the stock preview.
  const showStock = !!company && access.canReadStock(company.id)
  const stocks = useStocks(showStock ? [company] : [])
  const line = company && item ? stocks.byCompany.get(company.id)?.[stockSection(kind, grade)].find((l) => l.item === item) : undefined
  const available = line?.provisional.balance ?? null
  const unit = item ? unitOf(item) : 'kg'
  const options = company ? itemsFor(kind, grade, company) : []
  const over = !isPurchase && available !== null && qty > available
  const initialCompany = companies[0]?.id
  const canAddParty = !!company && access.can('manage_parties', company.id)
  const party = parties.data?.find((p) => p.id === partyId)
  const who = isPurchase ? 'supplier' : 'buyer'
  const billOurs = Form.useWatch('billCompanyGstin', form)
  const billTheirs = Form.useWatch('billPartyGstin', form)
  const oursMissing = access.canSystem('manage_companies') ? `Add the GST number for ${company?.name ?? 'this company'} in Settings → Companies first` : 'Our GST number is not added. Ask the Super Admin to add it.'
  const theirsMissing = !party
    ? `Choose the ${who} first`
    : canAddParty
      ? `Add the GST number for ${party.name} in Suppliers & buyers first`
      : `The GST number for ${party.name} is not added. Ask the Manager to add it.`

  return (
    <div className="grid grid-split fade-in" style={{ gap: 24 }}>
      <Form<Values>
        form={form}
        layout="vertical"
        size="large"
        requiredMark={requiredMark}
        initialValues={{ date: dayjs(), companyId: initialCompany, grade: 'A' }}
        onValuesChange={(changed) => {
          if ('companyId' in changed) form.setFieldValue('partyId', undefined)
          if ('companyId' in changed || 'partyId' in changed) setNotesOff([])
          // A grade carries only some items (e.g. Grade A sales are products), so clear a misfit.
          if (changed.grade || changed.companyId) {
            const c = companies.find((x) => x.id === form.getFieldValue('companyId'))
            if (!c || !itemAllowed(kind, form.getFieldValue('grade'), c, form.getFieldValue('item'))) form.setFieldValue('item', undefined)
          }
        }}
        onFinish={(v) =>
          onSaved({
            partyId: v.partyId,
            grade: v.grade,
            invoiceNo: v.invoiceNo.trim(),
            date: v.date.format('YYYY-MM-DD'),
            item: v.item,
            qty: v.qty,
            rate: v.rate,
            companyId: v.companyId,
            billCompanyGstin: normaliseGstin(v.billCompanyGstin),
            billPartyGstin: normaliseGstin(v.billPartyGstin),
            debitNoteIds: isPurchase ? notesOff : undefined,
            vehicleNos: isPurchase ? (v.vehicleNos ?? []) : undefined,
          })
        }
      >
        <div className="surface form-card">
          <div className="strong" style={{ fontSize: 16, marginBottom: 16 }}>
            {isPurchase ? 'Bill details' : 'Sale details'}
          </div>
          <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
            {/* Always the header's company. */}
            <Form.Item name="companyId" hidden rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item
              label={isPurchase ? 'Supplier' : 'Buyer'}
              name="partyId"
              rules={[{ required: true, message: `Choose the ${isPurchase ? 'supplier' : 'buyer'}` }]}
              extra={
                canAddParty ? (
                  <a onClick={() => navigate('/parties')}>Not in the list? Add a {isPurchase ? 'supplier' : 'buyer'}</a>
                ) : (
                  `Not in the list? The Manager can add new ${isPurchase ? 'suppliers' : 'buyers'}.`
                )
              }
            >
              <Select
                placeholder={company ? 'Choose' : 'Choose the company first'}
                disabled={!company}
                loading={parties.isLoading}
                showSearch={{ optionFilterProp: 'label' }}
                options={parties.data?.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
            <Form.Item label={isPurchase ? 'Bill / reference number' : 'Invoice number'} name="invoiceNo" rules={[{ required: true, whitespace: true, max: 50, message: 'Enter the number on the bill' }]}>
              <Input placeholder={isPurchase ? 'e.g. SBT/26-27/0421' : 'e.g. MR/26-27/0429'} />
            </Form.Item>
            <Form.Item label="Date" name="date" rules={[{ required: true }]}>
              <DatePicker format="DD MMM YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} allowClear={false} />
            </Form.Item>
          </div>
          <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
            <Form.Item
              label="Our GST number on the bill"
              name="billCompanyGstin"
              normalize={(v: string) => v.toUpperCase()}
              dependencies={['companyId']}
              rules={[gstRule(company?.gstin, oursMissing)]}
            >
              <Input maxLength={20} placeholder="Type it from the bill" suffix={gstSuffix(company?.gstin, billOurs)} />
            </Form.Item>
            <Form.Item
              label={`${isPurchase ? 'Supplier' : 'Buyer'}'s GST number on the bill`}
              name="billPartyGstin"
              normalize={(v: string) => v.toUpperCase()}
              dependencies={['partyId']}
              rules={[gstRule(party?.gstin, theirsMissing)]}
            >
              <Input maxLength={20} placeholder="Type it from the bill" suffix={gstSuffix(party?.gstin, billTheirs)} />
            </Form.Item>
          </div>
          {isPurchase && (
            <Form.Item label="Vehicle numbers" name="vehicleNos" extra="The lorry or vehicle numbers the goods came in." rules={[{ required: true, type: 'array', min: 1, message: 'Enter the vehicle number' }]}>
              <VehicleNumbersInput />
            </Form.Item>
          )}
          {isPurchase && <SupplierDebitNotes companyId={company?.id} supplierId={partyId} supplierName={parties.data?.find((p) => p.id === partyId)?.name} selected={notesOff} onSelect={setNotesOff} />}
        </div>

        <div className="surface" style={{ padding: 24, marginTop: 16 }}>
          <div className="strong" style={{ fontSize: 16, marginBottom: 16 }}>
            {isPurchase ? 'Material and price' : 'Product and price'}
          </div>
          <Form.Item label="Grade" name="grade" rules={[{ required: true }]}>
            <GradePicker />
          </Form.Item>
          <Form.Item label={isPurchase ? (grade === 'C' ? 'Item' : 'Raw material') : grade === 'A' ? 'Product' : 'Item sold'} name="item" rules={[{ required: true, message: 'Choose one' }]}>
            <Select placeholder={company ? 'Choose' : 'Choose the company first'} disabled={!company} options={options.map((m) => ({ value: m.id as string, label: `${m.name} — ${m.description}` }))} />
          </Form.Item>
          <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
            <Form.Item
              label="Quantity"
              name="qty"
              rules={[{ required: true, type: 'number', min: 0.001, message: 'Enter the weight in kg' }]}
              validateStatus={over ? 'error' : undefined}
              help={over ? `Only ${formatQty(available!, unit)} available` : undefined}
              extra={unit === 'L' ? 'Volume in litres. For kilolitres, multiply by 1,000.' : 'Weight in kg. For tonnes, multiply by 1,000.'}
            >
              <InputNumber<number> style={{ width: '100%' }} placeholder="e.g. 8,460" {...qtyInputProps(unit)} />
            </Form.Item>
            <Form.Item label={`Rate per ${unit === 'L' ? 'litre' : 'kg'}`} name="rate" rules={[{ required: true, type: 'number', min: 0, message: 'Enter the rate' }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={2} prefix="₹" suffix={perUnit(unit)} placeholder="e.g. 14.20" />
            </Form.Item>
          </div>
        </div>

        <div className="form-actions">
          <Button size="large" icon={<ArrowLeftOutlined />} onClick={back}>
            Back
          </Button>
          <Button size="large" type="primary" htmlType="submit" icon={<CheckOutlined />} disabled={over} loading={saving}>
            Save for approval
          </Button>
        </div>
      </Form>

      <div className="surface form-card" style={{ position: 'sticky', top: 92 }}>
        <div className="strong" style={{ fontSize: 16 }}>
          Summary
        </div>
        <div className="faint" style={{ fontSize: 13, marginBottom: 12 }}>
          Updates as you type
        </div>
        <div className="summary-line">
          <span className="muted">Quantity</span>
          <b className="num">{formatQty(qty, unit)}</b>
        </div>
        <div className="summary-line">
          <span className="muted">Rate</span>
          <b className="num">{formatRateIn(Number(rate), unit)}</b>
        </div>
        <div className="summary-line" style={{ fontSize: 17 }}>
          <span className="strong">{isPurchase ? 'Purchase cost' : 'Sale value'}</span>
          <b className="num strong">{formatINR(qty * rate)}</b>
        </div>
        {(showStock || !company) && (
          <div style={{ background: '#f7f8fa', borderRadius: 12, padding: 14, marginTop: 14 }}>
            <div className="faint" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Stock after saving
            </div>
            {available !== null && item ? (
              <div style={{ marginTop: 6 }}>
                <div className="num strong" style={{ fontSize: 20, color: over ? '#D4380D' : undefined }}>
                  {formatQty(available + (isPurchase ? qty : -qty), unit)}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {itemName(item)} · {gradeInfo(grade).name} at {company!.name} · now {formatQty(available, unit)}
                </div>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                Choose the company and {isPurchase ? 'material' : 'product'} to see the stock.
              </div>
            )}
            <div className="faint" style={{ fontSize: 12, marginTop: 10 }}>
              {grade === 'C' ? 'No goods move. This counts only in the Grade C bill-only stock. ' : ''}Stock changes when the Manager approves. It becomes final after Finance approves.
            </div>
          </div>
        )}
        {!isPurchase && showStock && (
          <div style={{ marginTop: 18 }}>
            <div className="strong" style={{ fontSize: 15 }}>
              Stock you can sell
            </div>
            <div className="faint" style={{ fontSize: 12.5 }}>
              {company!.name} · right now
            </div>
            <SaleableStock bare company={company!} stock={stocks.byCompany.get(company!.id)} selected={{ grade, item }} />
          </div>
        )}
      </div>
    </div>
  )
}
