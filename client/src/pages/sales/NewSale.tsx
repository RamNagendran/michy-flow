import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { PageHeader } from '../../components/ui'
import DocumentIntake, { type IntakeStep } from '../../components/DocumentIntake'
import ManualTradeForm from '../../components/entries/ManualTradeForm'
import SavedEntry from '../../components/entries/SavedEntry'
import { useCreateEntry } from '../../hooks/queries/entries'

export default function NewSale() {
  const navigate = useNavigate()
  const [step, setStep] = useState<IntakeStep>('choose')
  const create = useCreateEntry('sale')

  return (
    <div className="page">
      {step !== 'done' && (
        <PageHeader
          eyebrow="Sales"
          title={step === 'review' ? 'Check the invoice details' : 'Record a sale'}
          subtitle={
            step === 'review'
              ? 'Compare each value with the invoice on the left before saving.'
              : 'Add a sale of rubber, steel or other output. It is taken out of stock at once and goes to the Admin for approval.'
          }
          extra={
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/sales')}>
              Back to sales
            </Button>
          }
        />
      )}
      <DocumentIntake
        kind="sale"
        onStepChange={setStep}
        onDiscard={() => navigate('/sales')}
        save={(d) =>
          create.mutateAsync({
            companyId: d.companyId,
            body: { entry_date: d.date, buyer_id: d.partyId, grade: d.grade, product: d.item, qty: d.qty, rate: d.rate, invoice_no: d.invoiceNo, document_id: d.documentId },
          })
        }
        renderManual={(onSaved, back, saving) => <ManualTradeForm kind="sale" saving={saving} onSaved={onSaved} back={back} />}
        renderDone={(entry, again) => <SavedEntry entry={entry} again={again} />}
      />
    </div>
  )
}
