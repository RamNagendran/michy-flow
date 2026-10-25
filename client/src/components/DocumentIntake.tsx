import { useMemo, useState, type ReactNode } from 'react'
import { Alert, Button, Select, Spin, Steps, Upload } from 'antd'
import { ArrowLeftOutlined, CameraOutlined, CheckCircleFilled, CloudUploadOutlined, EditOutlined, FilePdfOutlined } from '@ant-design/icons'
import BillReview from './bill/BillReview'
import { useUploadBill } from '../hooks/queries/documents'
import { useAccess } from '../hooks/useAccess'
import { useNotify } from '../hooks/useNotify'
import { errorMessage } from '../services/apiError'
import type { BillDocument, EntryDraft } from '../types/documents'
import type { EntryDetail } from '../types/entries'

export type IntakeStep = 'choose' | 'upload' | 'reading' | 'review' | 'manual' | 'done'

const MAX_MB = 10
const ACCEPT = '.pdf,.jpg,.jpeg,.png'

function Reading({ file }: { file: File }) {
  const scan = !file.name.toLowerCase().endsWith('.pdf')
  return (
    <div className="surface fade-in" style={{ padding: 48, textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
      <Spin size="large" />
      <h2 style={{ fontSize: 22, fontWeight: 800, margin: '22px 0 6px' }}>Reading your bill…</h2>
      <p className="muted" style={{ margin: 0 }}>
        {scan ? 'Reading the text from the photo. This can take up to half a minute.' : 'Reading the PDF. This usually takes a few seconds.'} You'll check everything before it is saved.
      </p>
      <div className="faint" style={{ fontSize: 13, marginTop: 16 }}>
        {file.name}
      </div>
    </div>
  )
}

interface Props {
  kind: 'purchase' | 'sale'
  /** Sends the entry to the server; the intake moves on only once it is saved. */
  save: (draft: EntryDraft) => Promise<EntryDetail>
  renderManual: (onSaved: (d: EntryDraft) => void, back: () => void, saving: boolean) => ReactNode
  renderDone: (saved: EntryDetail, again: () => void) => ReactNode
  onStepChange?: (s: IntakeStep) => void
  onDiscard: () => void
}

/** Add a purchase or sale: upload the bill and check what was read, or type it in. */
export default function DocumentIntake({ kind, save, renderManual, renderDone, onStepChange, onDiscard }: Props) {
  const notify = useNotify()
  const { companiesWith, active } = useAccess()
  const companies = useMemo(() => companiesWith(kind === 'purchase' ? 'enter_purchase' : 'enter_sales'), [companiesWith, kind])
  const [companyId, setCompanyId] = useState<number | undefined>(() => companies.find((c) => c.id === active)?.id ?? (companies.length === 1 ? companies[0].id : undefined))
  const [step, setStepRaw] = useState<IntakeStep>('choose')
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<BillDocument | null>(null)
  const [saved, setSaved] = useState<EntryDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const upload = useUploadBill(kind)
  const label = kind === 'purchase' ? 'purchase bill' : 'sales invoice'

  const setStep = (s: IntakeStep) => {
    setStepRaw(s)
    onStepChange?.(s)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const read = (f: File) => {
    if (!companyId) return
    if (f.size > MAX_MB * 1024 * 1024) {
      notify.error(new Error(`The file is larger than ${MAX_MB} MB`), 'Cannot upload')
      return
    }
    setFile(f)
    setStep('reading')
    upload.mutate(
      { companyId, file: f },
      {
        onSuccess: (d) => {
          setDoc(d)
          setStep('review')
        },
        onError: () => setStep('upload'),
      },
    )
  }

  const submit = async (draft: EntryDraft) => {
    setSaving(true)
    try {
      setSaved(await save(draft))
      setStep('done')
    } catch (err) {
      notify.error(err, 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const current = step === 'choose' || step === 'upload' || step === 'manual' ? 0 : step === 'reading' || step === 'review' ? 1 : 2

  return (
    <div>
      {step !== 'done' && (
        <div className="surface" style={{ padding: '16px 24px', marginBottom: 20 }}>
          <Steps
            current={current}
            size="small"
            items={[
              { title: step === 'manual' ? 'Type in details' : `Add the ${label}` },
              { title: 'Check what we read', content: 'Nothing saved yet' },
              { title: 'Saved', content: 'Sent for approval' },
            ]}
          />
        </div>
      )}

      {step === 'choose' && (
        <div className="grid grid-2 fade-in" style={{ gap: 20 }}>
          <div className="choice" onClick={() => setStep('upload')}>
            <span className="pill" style={{ position: 'absolute', top: 20, right: 20, background: '#e8f6ef', color: '#1f9d6b' }}>
              Recommended · fastest
            </span>
            <div className="choice-icon" style={{ background: '#fdeef2', color: '#D82E54' }}>
              <CloudUploadOutlined />
            </div>
            <h3>Upload the {label}</h3>
            <p>Upload a PDF or a clear photo. We read the {kind === 'purchase' ? 'supplier' : 'buyer'}, bill number, date, quantity, rate and totals, check the maths, and you confirm.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <span className="pill">
                <FilePdfOutlined /> PDF
              </span>
              <span className="pill">
                <CameraOutlined /> Photo / scan
              </span>
              <span className="pill">e-Invoice QR</span>
            </div>
          </div>
          <div className="choice" onClick={() => setStep('manual')}>
            <div className="choice-icon" style={{ background: '#eef4fb', color: '#2F6FEB' }}>
              <EditOutlined />
            </div>
            <h3>Type in the details</h3>
            <p>No bill yet, or a handwritten slip? Fill a short form. The total is worked out for you as you type.</p>
          </div>
        </div>
      )}

      {step === 'upload' && (
        <div className="fade-in" style={{ maxWidth: 820, margin: '0 auto' }}>
          {upload.isError && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={errorMessage(upload.error)} />}
          {companies.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Which company is this bill for?</div>
              <Select size="large" style={{ width: '100%' }} value={companyId} onChange={setCompanyId} placeholder="Choose the company" options={companies.map((c) => ({ value: c.id, label: c.name }))} />
            </div>
          )}
          <div className="dropzone">
            <Upload.Dragger
              accept={ACCEPT}
              disabled={!companyId}
              showUploadList={false}
              beforeUpload={(f) => {
                read(f)
                return false
              }}
              style={{ padding: '44px 20px' }}
            >
              <div style={{ fontSize: 44, color: '#D82E54' }}>
                <CloudUploadOutlined />
              </div>
              <div style={{ fontSize: 19, fontWeight: 800, marginTop: 10, color: '#191919' }}>{companyId ? `Drop the ${label} here` : 'Choose the company first'}</div>
              <div className="muted" style={{ marginTop: 6, fontSize: 14.5 }}>
                or <a style={{ fontWeight: 700 }}>choose a file</a> · PDF, JPG or PNG up to {MAX_MB} MB
              </div>
            </Upload.Dragger>
          </div>
          <div style={{ marginTop: 18 }}>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => setStep('choose')}>
              Back
            </Button>
          </div>
          <div className="grid grid-3" style={{ marginTop: 20 }}>
            {[
              ['Works with most bills', 'PDF text, photos and scans, and the e-invoice QR code.'],
              ['Checks the maths', 'Quantity × rate, tax and totals are re-calculated every time.'],
              ['You stay in control', 'Nothing is saved until you confirm it.'],
            ].map(([t, d]) => (
              <div key={t} style={{ display: 'flex', gap: 10 }}>
                <CheckCircleFilled style={{ color: '#1f9d6b', marginTop: 3 }} />
                <div>
                  <div style={{ fontWeight: 800 }}>{t}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {d}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'reading' && file && <Reading file={file} />}
      {step === 'review' && doc && <BillReview doc={doc} saving={saving} onConfirm={submit} onDiscard={onDiscard} />}
      {step === 'manual' && renderManual(submit, () => setStep('choose'), saving)}
      {step === 'done' && saved && renderDone(saved, () => setStep('choose'))}
    </div>
  )
}
