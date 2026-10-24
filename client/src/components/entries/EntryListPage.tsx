import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useAccess } from '../../hooks/useAccess'
import { useCompanyData } from '../../hooks/useCompanyData'
import type { CompanyPermission } from '../../types/auth'
import type { CompanySummary, EntryType } from '../../types/entries'
import { periodLabels } from '../../utils/period'
import { PageHeader } from '../ui'
import EntryTable from './EntryTable'
import GradeSplit from './GradeSplit'
import StatusBoard from './StatusBoard'

export interface Kpi {
  label: string
  value: string
  sub: string
}

interface Props {
  type: EntryType
  title: string
  subtitle: string
  newPath: string
  newLabel: string
  enter: CompanyPermission
  kpis: (total: CompanySummary) => Kpi[]
}

/** Header, period totals, and the entry list: the shape shared by Purchases, Production and Sales. */
export default function EntryListPage({ type, title, subtitle, newPath, newLabel, enter, kpis }: Props): ReactNode {
  const navigate = useNavigate()
  const access = useAccess()
  const { scope, total, period } = useCompanyData()
  const canEnter = scope.some((c) => access.can(enter, c.id))

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        extra={
          canEnter && (
            <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => navigate(newPath)}>
              {newLabel}
            </Button>
          )
        }
      />
      {total && (
        <div className="grid grid-4 stagger" style={{ marginBottom: 20 }}>
          {kpis(total).map((k) => (
            <div key={k.label} className="surface" style={{ padding: '16px 20px' }}>
              <div className="muted" style={{ fontWeight: 700, fontSize: 13 }}>
                {k.label}
              </div>
              <div className="num strong" style={{ fontSize: 22, marginTop: 4 }}>
                {k.value}
              </div>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {k.sub} · {periodLabels[period].toLowerCase()}
              </div>
            </div>
          ))}
        </div>
      )}
      <StatusBoard type={type} companies={scope} />
      {total && type !== 'production' && <GradeSplit kind={type} totals={total[type === 'purchase' ? 'purchases' : 'sales'].by_grade} />}
      <div className="surface table-card">
        <EntryTable types={[type]} companies={scope} />
      </div>
    </div>
  )
}
