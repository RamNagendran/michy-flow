import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { PageHeader } from '../../components/ui'
import DocumentIntake, { type IntakeStep } from '../../components/DocumentIntake'
import ManualTradeForm from '../../components/entries/ManualTradeForm'
import SavedEntry from '../../components/entries/SavedEntry'
import { useCreateEntry } from '../../hooks/queries/entries'

export default function NewPurchase() {
  const navigate = useNavigate()
  const [step, setStep] = useState<IntakeStep>('choose')
  const create = useCreateEntry('purchase')

  return (
    <div className="page">
      {step !== 'done' && (
        <PageHeader
          eyebrow="Purchases"
          title={step === 'review' ? 'Check the bill details' : 'Record a purchase'}
          subtitle={
            step === 'review'
              ? 'Compare each value with the bill on the left. Values we are unsure of are marked in amber.'
              : 'Add a raw-material purchase. It goes to the Manager for approval. Stock changes when the Manager approves.'
          }
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/purchases')}>
              Back to purchases
            </Button>
          }
        />
      )}
      <DocumentIntake
        kind="purchase"
        onStepChange={setStep}
        onDiscard={() => navigate('/purchases')}
        save={(d) =>
          create.mutateAsync({
            companyId: d.companyId,
            body: { entry_date: d.date, supplier_id: d.partyId, grade: d.grade, material: d.item, qty: d.qty, rate: d.rate, invoice_no: d.invoiceNo, document_id: d.documentId, bill_company_gstin: d.billCompanyGstin, bill_party_gstin: d.billPartyGstin, debit_note_ids: d.debitNoteIds ?? [], vehicle_nos: d.vehicleNos ?? [] },
          })
        }
        renderManual={(onSaved, back, saving) => <ManualTradeForm kind="purchase" saving={saving} onSaved={onSaved} back={back} />}
        renderDone={(entry, again) => <SavedEntry entry={entry} again={again} />}
      />
    </div>
  )
}
