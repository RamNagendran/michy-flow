import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, DatePicker, Input, InputNumber, Segmented, Steps } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleFilled, CheckOutlined, WarningFilled } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { PageHeader } from '../../components/ui'
import { CompanyBadge } from '../../components/CompanyCards'
import SavedEntry from '../../components/entries/SavedEntry'
import { companyItems, itemName, processOf, SHIFT_HOURS, toKg, WASTAGE_ALERT_PCT, type OutputId } from '../../data/catalog'
import { useCreateEntry } from '../../hooks/queries/entries'
import { useStocks } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { useNotify } from '../../hooks/useNotify'
import { seriesColors } from '../../styles/theme'
import type { EntryDetail } from '../../types/entries'
import { formatDate, formatKg, formatPercent, formatQty, kgInputProps, qtyInputProps } from '../../utils/format'
import { balanceOf } from '../../utils/production'
import MassBalance from './MassBalance'
import ShiftCrew from './ShiftCrew'

type Outputs = Partial<Record<OutputId, number | null>>

const color = (id: string) => seriesColors[id as keyof typeof seriesColors] ?? '#8a919e'

const Choice = ({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) => (
  <div className="choice" style={{ padding: 18, borderColor: selected ? '#D82E54' : undefined, background: selected ? '#fffafb' : undefined }} onClick={onClick}>
    {selected && <CheckCircleFilled style={{ position: 'absolute', top: 14, right: 14, color: '#D82E54', fontSize: 18 }} />}
    {children}
  </div>
)

/**
 * Record one production run. The operator weighs what came out (oil in litres) and anything put
 * back into stock; the stock deduction, output weight and missing weight are worked out here and
 * again on the server (the reverse calculation).
 */
export default function NewProduction() {
  const navigate = useNavigate()
  const notify = useNotify()
  const { companiesWith, active } = useAccess()
  // Only companies where this person may record production; material comes from that company's stock.
  const companies = useMemo(() => companiesWith('enter_production'), [companiesWith])
  const create = useCreateEntry('production')
  const [step, setStep] = useState(0)
  const [companyId, setCompanyId] = useState<number | undefined>(() => companies.find((c) => c.id === active)?.id ?? (companies.length === 1 ? companies[0].id : undefined))
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [shift, setShift] = useState<number>(1)
  const [material, setMaterial] = useState<string>()
  const [takenKg, setTakenKg] = useState<number | null>(null)
  const [returnedKg, setReturnedKg] = useState<number | null>(null)
  const [out, setOut] = useState<Outputs>({})
  const [notes, setNotes] = useState('')
  const [crew, setCrew] = useState<number[]>([])
  const [hours, setHours] = useState<number | null>(null)
  const [saved, setSaved] = useState<EntryDetail | null>(null)

  const company = companies.find((c) => c.id === companyId)
  // The company's own inputs and outputs (its inventory configuration) and its type's name.
  const process = company ? { ...companyItems(company), name: processOf(company.category).name } : undefined
  const density = company?.oil_density
  const stocks = useStocks(company ? [company] : [])
  const stock = company ? stocks.byCompany.get(company.id) : undefined
  const rawLines = stock?.raw.filter((l) => process?.inputs.some((i) => i.id === l.item) && (l.provisional.balance > 0 || l.item === material)) ?? []
  const available = rawLines.find((l) => l.item === material)?.provisional.balance ?? 0
  const taken = takenKg ?? 0
  const returned = returnedKg ?? 0
  const outputKg = (process?.outputs ?? []).reduce((s, o) => s + toKg(o.id, out[o.id as OutputId] ?? 0, density), 0)
  const b = balanceOf(taken, returned, outputKg)
  const anyOutput = (process?.outputs ?? []).some((o) => (out[o.id as OutputId] ?? 0) > 0)
  const overStock = taken > available
  const allReturned = taken > 0 && returned >= taken
  const overProcessed = b.missingKg < -0.0005
  const canNext = [!!company, !!material && taken > 0 && !overStock && !allReturned, anyOutput && !overProcessed, true][step]

  const go = (n: number) => {
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const reset = () => {
    setMaterial(undefined)
    setTakenKg(null)
    setReturnedKg(null)
    setOut({})
    setCrew([])
    setHours(null)
  }

  const save = () =>
    create.mutate(
      {
        companyId: company!.id,
        body: {
          entry_date: date.format('YYYY-MM-DD'),
          material: material!,
          input_kg: taken,
          returned_kg: returned,
          shift,
          crew_ids: crew,
          running_hours: hours,
          notes,
          outputs: process!.outputs.map((o) => ({ product: o.id, qty: out[o.id as OutputId] ?? 0 })),
        },
      },
      { onSuccess: setSaved, onError: (err) => notify.error(err, 'Could not save') },
    )

  if (saved) {
    return (
      <div className="page">
        <SavedEntry
          entry={saved}
          again={() => {
            setSaved(null)
            setStep(0)
            reset()
            setNotes('')
          }}
        />
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <PageHeader
        eyebrow="Production"
        title="Record production"
        subtitle="Enter what was taken from stock and what came out. The processed weight, stock deduction and missing weight are worked out for you."
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/production')}>
            Back to production
          </Button>
        }
      />

      <div className="surface" style={{ padding: '16px 24px', marginBottom: 20 }}>
        <Steps
          current={step}
          size="small"
          items={[
            { title: 'Company, date & shift', content: company?.name },
            { title: 'Raw material', content: material && taken ? formatKg(taken) : undefined },
            { title: 'What came out', content: outputKg ? formatKg(outputKg) : undefined },
            { title: 'Check & save' },
          ]}
        />
      </div>

      <div className="surface fade-in" key={step} style={{ padding: 28 }}>
        {step === 0 && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Which company?</h3>
            <div className="grid grid-3" style={{ marginTop: 16 }}>
              {companies.map((c) => (
                <Choice
                  key={c.id}
                  selected={companyId === c.id}
                  onClick={() => {
                    setCompanyId(c.id)
                    reset()
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <CompanyBadge code={c.code} />
                  </div>
                  <h3 style={{ fontSize: 16 }}>{c.name}</h3>
                  <p style={{ fontSize: 13 }}>
                    {processOf(c.category).name}
                    {c.city ? ` · ${c.city}` : ''}
                  </p>
                  <p className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {processOf(c.category).summary}
                  </p>
                </Choice>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 24, flexWrap: 'wrap' }}>
              <div style={{ width: 280 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Production date</div>
                <DatePicker value={date} onChange={(d) => d && setDate(d)} format="DD MMM YYYY" size="large" style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Shift</div>
                <Segmented size="large" value={shift} onChange={setShift} options={[1, 2, 3].map((s) => ({ value: s, label: `Shift ${s}` }))} />
              </div>
            </div>
            <ShiftCrew companyId={companyId} crew={crew} onCrew={setCrew} hours={hours} onHours={setHours} />
          </>
        )}

        {step === 1 && company && process && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>What raw material went in?</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              {process.name}: {process.inputs.map((i) => i.name.toLowerCase()).join(', ')}. Taken from {company.name}'s Grade A stock (production is always Grade A).
            </p>
            {stock && !rawLines.length && <Alert type="warning" showIcon title="There is no Grade A raw material in stock here yet. Record the purchase as Grade A (for production) first." />}
            <div className="grid grid-3" style={{ marginTop: 18 }}>
              {rawLines.map((l) => (
                <Choice key={l.item} selected={material === l.item} onClick={() => setMaterial(l.item)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
                    <span className="legend-dot" style={{ background: color(l.item) }} />
                    {itemName(l.item)}
                  </div>
                  <div className="num strong" style={{ fontSize: 20, marginTop: 8 }}>
                    {formatKg(l.provisional.balance)}
                  </div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    available ({formatKg(l.confirmed.balance)} finalised)
                  </div>
                </Choice>
              ))}
            </div>
            {material && (
              <div className="grid grid-2 fade-in" style={{ marginTop: 26, maxWidth: 660, gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Taken from stock</div>
                  <InputNumber<number> size="large" value={takenKg} onChange={setTakenKg} style={{ width: '100%' }} placeholder="e.g. 5,000" status={overStock ? 'error' : undefined} {...kgInputProps} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Returned to stock (optional)</div>
                  <InputNumber<number> size="large" value={returnedKg} onChange={setReturnedKg} style={{ width: '100%' }} placeholder="0" status={allReturned ? 'error' : undefined} {...kgInputProps} />
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                    Not processed after all and put back
                  </div>
                </div>
              </div>
            )}
            {overStock && (
              <Alert type="error" showIcon style={{ marginTop: 16 }} title={`Only ${formatKg(available)} of Grade A ${itemName(material!).toLowerCase()} is in stock.`} description="Only Grade A raw material goes into production. Check the weight, record the missing purchase, or ask the Admin to move a Grade B purchase to Grade A." />
            )}
            {allReturned && <Alert type="error" showIcon style={{ marginTop: 16 }} title="Everything was returned to stock, so nothing was processed." />}
          </>
        )}

        {step === 2 && material && process && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>What came out?</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              From {formatKg(b.processedKg)} of {itemName(material).toLowerCase()} processed. Leave an output empty if there was none.
            </p>
            <div className="grid grid-3" style={{ marginTop: 18 }}>
              {process.outputs.map((o) => (
                <div key={o.id} style={{ border: '1.5px solid #e8eaee', borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15 }}>
                    <span className="legend-dot" style={{ background: color(o.id) }} />
                    {o.name}
                  </div>
                  <InputNumber<number> size="large" value={out[o.id as OutputId] ?? null} onChange={(v) => setOut((s) => ({ ...s, [o.id]: v }))} style={{ width: '100%', marginTop: 10 }} placeholder="0" {...qtyInputProps(o.unit)} />
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {o.unit === 'L' ? `≈ ${formatKg(toKg(o.id, out[o.id as OutputId] ?? 0, density))} by weight at ${density} kg/L` : o.stocked ? 'Goes into stock' : 'Recorded, not stocked'}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 22 }}>
              <MassBalance b={b} />
            </div>
            {overProcessed && <Alert type="error" showIcon style={{ marginTop: 14 }} title="The outputs weigh more than what was processed." description={`${formatKg(outputKg)} came out but only ${formatKg(b.processedKg)} was processed. Check the weights (oil counts ${formatKg(toKg('oil', 1000, density))} per 1,000 L).`} />}
            {!overProcessed && anyOutput && b.flagged && (
              <Alert type="warning" showIcon icon={<WarningFilled />} style={{ marginTop: 14 }} title={`Missing ${formatPercent(b.missingPct)} — above ${WASTAGE_ALERT_PCT}%, flagged as waste`} description="You can still save; the Admin is alerted and a debit note will be needed." />
            )}
          </>
        )}

        {step === 3 && company && material && process && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Check and save</h3>
            <div className="grid grid-2" style={{ marginTop: 16, gap: 20 }}>
              <div style={{ background: '#f7f8fa', borderRadius: 14, padding: '6px 18px' }}>
                {(
                  [
                    ['Company', `${company.name} · ${process.name}`],
                    ['Date · shift', `${formatDate(date.format('YYYY-MM-DD'))} · Shift ${shift}`],
                    ...(crew.length ? [['Crew', `${crew.length} operator${crew.length > 1 ? 's' : ''}`]] : []),
                    ...(hours ? [['Running hours', `${hours} h · ${formatPercent((hours / SHIFT_HOURS) * 100, 0)} of the shift`]] : []),
                    ['Raw material', `${formatKg(taken)} of ${itemName(material)}`],
                    ...(returned ? [['Returned to stock', formatKg(returned)]] : []),
                    ['Processed', formatKg(b.processedKg)],
                    ...process.outputs.filter((o) => out[o.id as OutputId]).map((o) => [o.name, formatQty(out[o.id as OutputId] ?? 0, o.unit)]),
                    ['Missing (wastage)', `${formatKg(b.missingKg)} (${formatPercent(b.missingPct)})`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div className="summary-line" key={k}>
                    <span className="muted">{k}</span>
                    <b className="num" style={{ color: k.startsWith('Missing') && b.flagged ? '#D4380D' : undefined }}>
                      {v}
                    </b>
                  </div>
                ))}
              </div>
              <div>
                <Alert type="info" showIcon title="Counts in stock as soon as you save" description="It becomes final once the Admin approves it and Finance verifies it." />
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Notes (optional)</div>
                  <Input.TextArea rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Reactor 2 down for an hour" />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <Button size="large" icon={<ArrowLeftOutlined />} disabled={step === 0} onClick={() => go(step - 1)}>
          Back
        </Button>
        {step < 3 ? (
          <Button size="large" type="primary" disabled={!canNext} onClick={() => go(step + 1)} style={{ minWidth: 180 }}>
            Continue <ArrowRightOutlined />
          </Button>
        ) : (
          <Button size="large" type="primary" icon={<CheckOutlined />} loading={create.isPending} onClick={save} style={{ minWidth: 200 }}>
            Save for approval
          </Button>
        )}
      </div>
    </div>
  )
}
