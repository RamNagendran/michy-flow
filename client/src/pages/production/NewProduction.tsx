import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, DatePicker, Input, InputNumber, Segmented, Steps } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleFilled, CheckOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { PageHeader } from '../../components/ui'
import MaterialSplit from '../../components/entries/MaterialSplit'
import SavedEntry from '../../components/entries/SavedEntry'
import { companyItems, itemName, kgPerLitre, processOf, SHIFT_HOURS, toKg, type OutputId, itemColor } from '../../data/catalog'
import { useCreateEntry } from '../../hooks/queries/entries'
import { useStocks } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { useNotify } from '../../hooks/useNotify'
import type { EntryDetail, WastageType } from '../../types/entries'
import { formatDate, formatKg, formatKgFine, formatPercent, formatQty, kgInputProps, qtyInputProps } from '../../utils/format'
import { rawMaterialUsed, splitMaterials, splitProblem, WASTAGE_TYPES, wastageTypeLabel } from '../../utils/production'
import MassBalance from './MassBalance'
import ShiftCrew from './ShiftCrew'

type Outputs = Partial<Record<OutputId, number | null>>

const color = (id: string) => itemColor(id)

const Choice = ({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) => (
  <div className="choice" style={{ padding: 18, borderColor: selected ? '#D82E54' : undefined, background: selected ? '#fffafb' : undefined }} onClick={onClick}>
    {selected && <CheckCircleFilled style={{ position: 'absolute', top: 14, right: 14, color: '#D82E54', fontSize: 18 }} />}
    {children}
  </div>
)

/**
 * Record one production run. In-charges do not know exactly how much raw material went in, so
 * they enter what came out (oil in litres) and any wastage (gas, liquid or solid) in kg. Stock
 * goes down by products + wastage; the wastage is never part of the products. That is shared
 * equally over the raw materials used, and the in-charge may change the split. Worked out again
 * on the server.
 */
/** A fresh form whenever the header's company changes. */
export default function NewProductionPage() {
  const { active } = useAccess()
  return <NewProduction key={active ?? 0} />
}

function NewProduction() {
  const navigate = useNavigate()
  const notify = useNotify()
  const { companiesWith, scope } = useAccess()
  // The header's company, when this person may record production there; material comes from its stock.
  const companies = useMemo(() => companiesWith('enter_production'), [companiesWith])
  const create = useCreateEntry('production')
  const [step, setStep] = useState(0)
  const companyId = companies[0]?.id
  const [date, setDate] = useState<Dayjs>(dayjs())
  const [shift, setShift] = useState<number>(1)
  // The raw materials used, and the kg the in-charge typed for some of them (the rest share what is left).
  const [materials, setMaterials] = useState<string[]>([])
  const [typed, setTyped] = useState<Record<string, number | null>>({})
  // Wastage on the run, if any: its type and weight.
  const [wastageType, setWastageType] = useState<WastageType>('gas')
  const [wastageInput, setWastageInput] = useState<number | null>(null)
  const [out, setOut] = useState<Outputs>({})
  const [notes, setNotes] = useState('')
  const [crew, setCrew] = useState<number[]>([])
  const [hours, setHours] = useState<number | null>(null)
  const [saved, setSaved] = useState<EntryDetail | null>(null)

  const company = companies[0]
  // The company's own inputs and outputs (its inventory configuration) and its type's name.
  const process = company ? { ...companyItems(company), name: processOf(company.category).name } : undefined
  const factors = company?.kg_per_litre
  const stocks = useStocks(company ? [company] : [])
  const stock = company ? stocks.byCompany.get(company.id) : undefined
  const rawLines = stock?.raw.filter((l) => process?.inputs.some((i) => i.id === l.item) && (l.provisional.balance > 0 || materials.includes(l.item))) ?? []
  const available = (id: string) => rawLines.find((l) => l.item === id)?.provisional.balance ?? 0
  const outputKg = (process?.outputs ?? []).reduce((s, o) => s + toKg(o.id, out[o.id as OutputId] ?? 0, factors), 0)
  const anyOutput = (process?.outputs ?? []).some((o) => (out[o.id as OutputId] ?? 0) > 0)
  const wastageKg = wastageInput ?? 0
  const usedKg = rawMaterialUsed(outputKg, wastageKg)
  // Stock goes down by products + wastage, less anything put back.
  const stockOutKg = usedKg
  const split = splitMaterials(stockOutKg, materials, typed)
  const problem = materials.length ? splitProblem(stockOutKg, split, available) : null
  const canNext = [!!company, anyOutput, materials.length > 0 && !problem, true][step]
  // A new total or a new set of materials is shared equally again.
  const changeOut = (fn: () => void) => {
    fn()
    setTyped({})
  }
  const toggleMaterial = (id: string) => changeOut(() => setMaterials((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id])))

  const go = (n: number) => {
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const reset = () => {
    setMaterials([])
    setTyped({})
    setWastageType('gas')
    setWastageInput(null)
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
          materials: materials.map((m) => ({ material: m, kg: split[m] })),
          wastage_kg: wastageKg > 0 ? wastageKg : null,
          wastage_type: wastageKg > 0 ? wastageType : null,
          returned_kg: 0,
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
        subtitle="First enter what came out and any wastage. Products + wastage is the raw material used. That much is taken out of stock when the Manager approves."
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
            { title: 'Date & shift', content: company?.name },
            { title: 'What came out', content: outputKg ? formatKg(outputKg + wastageKg) : undefined },
            { title: 'Raw material', content: materials.length && step > 2 ? formatKgFine(stockOutKg) : undefined },
            { title: 'Check & save' },
          ]}
        />
      </div>

      <div className="surface fade-in" key={step} style={{ padding: 28 }}>
        {step === 0 && !company && <Alert type="warning" showIcon title={`You cannot record production for ${scope[0]?.name ?? 'this company'}.`} description="Switch the company at the top of the screen." />}
        {step === 0 && company && (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ width: 280 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Production date</div>
                <DatePicker value={date} onChange={(d) => d && setDate(d)} format="DD MMM YYYY" size="large" style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Shift</div>
                <Segmented size="large" value={shift} onChange={setShift} options={[1, 2, 3].map((s) => ({ value: s, label: `Shift ${s}` }))} />
              </div>
            </div>
            <ShiftCrew companyId={companyId} shift={shift} crew={crew} onCrew={setCrew} hours={hours} onHours={setHours} />
          </>
        )}

        {step === 1 && company && process && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>What came out?</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Weigh each product and any wastage. Leave it empty if there was none.
            </p>
            <div className="grid grid-3" style={{ marginTop: 18 }}>
              {process.outputs.map((o) => (
                <div key={o.id} style={{ border: '1.5px solid #e8eaee', borderRadius: 14, padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15 }}>
                    <span className="legend-dot" style={{ background: color(o.id) }} />
                    {o.name}
                  </div>
                  <InputNumber<number> size="large" value={out[o.id as OutputId] ?? null} onChange={(v) => changeOut(() => setOut((s) => ({ ...s, [o.id]: v })))} style={{ width: '100%', marginTop: 10 }} placeholder="0" {...qtyInputProps(o.unit)} />
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {o.unit === 'L' ? `≈ ${formatKg(toKg(o.id, out[o.id as OutputId] ?? 0, factors))} by weight at ${kgPerLitre(o.id, factors)} kg per litre` : o.stocked ? 'Goes into stock' : 'Recorded, not stocked'}
                  </div>
                </div>
              ))}
              <div style={{ border: '1.5px solid #e8eaee', borderRadius: 14, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15 }}>
                  <span className="legend-dot" style={{ background: '#D82E54' }} />
                  Wastage <span className="opt-mark">(optional)</span>
                </div>
                <Segmented<WastageType> block value={wastageType} onChange={setWastageType} options={WASTAGE_TYPES.map((w) => ({ value: w, label: wastageTypeLabel[w] }))} style={{ marginTop: 10 }} />
                <InputNumber<number> size="large" value={wastageInput} onChange={(v) => changeOut(() => setWastageInput(v))} style={{ width: '100%', marginTop: 8 }} placeholder="0" {...kgInputProps} />
                <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                  Lost as {wastageTypeLabel[wastageType].toLowerCase()}. Not part of the products.
                </div>
              </div>
            </div>
            {anyOutput && (
              <div style={{ marginTop: 22 }}>
                <MassBalance outputKg={outputKg} wastageKg={wastageKg} wastageType={wastageKg ? wastageType : null} />
              </div>
            )}
          </>
        )}

        {step === 2 && company && process && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Which raw materials were used?</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Choose one or more. Taken from {company.name}'s Grade A stock.
            </p>
            {stock && !rawLines.length && <Alert type="warning" showIcon title="No Grade A raw material in stock here yet. First enter the purchase as Grade A." />}
            <div className="grid grid-3" style={{ marginTop: 18 }}>
              {rawLines.map((l) => (
                <Choice key={l.item} selected={materials.includes(l.item)} onClick={() => toggleMaterial(l.item)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
                    <span className="legend-dot" style={{ background: color(l.item) }} />
                    {itemName(l.item)}
                  </div>
                  <div className="num strong" style={{ fontSize: 20, marginTop: 8 }}>
                    {formatKg(l.provisional.balance)}
                  </div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    in stock
                  </div>
                </Choice>
              ))}
            </div>

            <div style={{ marginTop: 26 }}>
              <MassBalance outputKg={outputKg} wastageKg={wastageKg} wastageType={wastageKg ? wastageType : null} />
            </div>

            <div style={{ marginTop: 16, background: '#f7f8fa', borderRadius: 12, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span className="muted">Stock goes down by</span>
              <b className="num">
                {formatKgFine(stockOutKg)}
              </b>
            </div>

            {materials.length > 1 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ fontWeight: 700 }}>How much of each?</div>
                <div className="faint" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>
                  Shared equally. Change any one if needed; the others take the rest.
                </div>
                <MaterialSplit total={stockOutKg} split={split} typed={typed} onTyped={setTyped} available={available} />
              </div>
            )}

            {problem && (
              <Alert type="error" showIcon style={{ marginTop: 16 }} title={problem} description={problem.startsWith('Only') ? 'Check the weights, enter the missing purchase, or ask the Manager to get a Grade B purchase changed to Grade A.' : undefined} />
            )}
          </>
        )}

        {step === 3 && company && materials.length > 0 && process && (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Check and save</h3>
            <div className="grid grid-2" style={{ marginTop: 16, gap: 20 }}>
              <div style={{ background: '#f7f8fa', borderRadius: 14, padding: '6px 18px' }}>
                {(
                  [
                    ['Company', `${company.name} · ${process.name}`],
                    ['Date · shift', `${formatDate(date.format('YYYY-MM-DD'))} · Shift ${shift}`],
                    ...(crew.length ? [['Operators', String(crew.length)]] : []),
                    ...(hours ? [['Running hours', `${hours} h · ${formatPercent((hours / SHIFT_HOURS) * 100, 0)} of the shift`]] : []),
                    ...process.outputs.filter((o) => out[o.id as OutputId]).map((o) => [o.name, formatQty(out[o.id as OutputId] ?? 0, o.unit)]),
                    ['Products total', formatKgFine(outputKg)],
                    ...(wastageKg ? [[`Wastage · ${wastageTypeLabel[wastageType]}`, formatKgFine(wastageKg)], ['Raw material used', formatKgFine(usedKg)]] : []),
                    ...materials.map((m) => [`Taken out · ${itemName(m)}`, formatKg(split[m])]),
                    ...(materials.length > 1 ? [['Taken out of stock', formatKgFine(stockOutKg)]] : []),
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div className="summary-line" key={k}>
                    <span className="muted">{k}</span>
                    <b className="num">
                      {v}
                    </b>
                  </div>
                ))}
              </div>
              <div>
                <Alert type="info" showIcon title={`${formatKgFine(stockOutKg)} of ${materials.length > 1 ? 'raw material' : itemName(materials[0]).toLowerCase()} will be taken out of stock`} description="It goes to the Manager first. Stock changes when the Manager approves. It becomes final after Finance approves." />
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
