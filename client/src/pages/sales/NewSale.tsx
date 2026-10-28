import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { PageHeader, SectionTitle } from '../../components/ui'
import DocumentIntake, { type IntakeStep } from '../../components/DocumentIntake'
import ManualTradeForm from '../../components/entries/ManualTradeForm'
import SavedEntry from '../../components/entries/SavedEntry'
import { useCreateEntry } from '../../hooks/queries/entries'
import { useStocks } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import SaleableStock from '../../components/SaleableStock'

export default function NewSale() {
  const navigate = useNavigate()
  const [step, setStep] = useState<IntakeStep>('choose')
  const create = useCreateEntry('sale')
  const access = useAccess()
  const stockCompanies = access.companiesWith('enter_sales').filter((c) => access.canReadStock(c.id))
  const stocks = useStocks(step === 'choose' ? stockCompanies : [])

  return (
    <div className="page">
      {step !== 'done' && (
        <PageHeader
          eyebrow="Sales"
          title={step === 'review' ? 'Check the invoice details' : 'Record a sale'}
          subtitle={
            step === 'review'
              ? 'Compare each value with the invoice on the left before saving.'
              : 'Add a sale of rubber, steel or other output. It goes to the Manager for approval. Stock changes when the Manager approves.'
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
            body: { entry_date: d.date, buyer_id: d.partyId, grade: d.grade, product: d.item, qty: d.qty, rate: d.rate, invoice_no: d.invoiceNo, document_id: d.documentId, bill_company_gstin: d.billCompanyGstin, bill_party_gstin: d.billPartyGstin },
          })
        }
        renderManual={(onSaved, back, saving) => <ManualTradeForm kind="sale" saving={saving} onSaved={onSaved} back={back} />}
        renderDone={(entry, again) => <SavedEntry entry={entry} again={again} />}
      />
      {step === 'choose' && stockCompanies.length > 0 && (
        <>
          <SectionTitle title="Stock you can sell" hint="right now" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {stockCompanies.map((c) => (
              <div key={c.id} className="surface" style={{ padding: 18 }}>
                <SaleableStock company={c} stock={stocks.byCompany.get(c.id)} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
