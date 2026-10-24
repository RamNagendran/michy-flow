import { useNavigate } from 'react-router-dom'
import { Empty } from 'antd'
import { ArrowRightOutlined, ExperimentOutlined, ShopOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useEntries } from '../../hooks/queries/entries'
import { useStocks } from '../../hooks/queries/stock'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { PageHeader, SectionTitle } from '../../components/ui'
import { CompanyCard } from '../../components/CompanyCards'
import EntryTable from '../../components/entries/EntryTable'
import type { CompanyPermission } from '../../types/auth'
import { firstName } from '../../utils/user'

const ALL = ['purchase', 'production', 'sale'] as const

const tiles: { to: string; perm: CompanyPermission; title: string; text: string; icon: React.ReactNode; bg: string }[] = [
  { to: '/purchases/new', perm: 'enter_purchase', title: 'Record a purchase', text: 'Upload the bill or type it in', icon: <ShoppingCartOutlined />, bg: 'linear-gradient(135deg, #D82E54 0%, #B8213F 100%)' },
  { to: '/production/new', perm: 'enter_production', title: 'Record production', text: 'What went in, what came out', icon: <ExperimentOutlined />, bg: 'linear-gradient(135deg, #2a2a31 0%, #191919 100%)' },
  { to: '/sales/new', perm: 'enter_sales', title: 'Record a sale', text: 'Rubber, steel or other output', icon: <ShopOutlined />, bg: 'linear-gradient(135deg, #2F6FEB 0%, #1f55c4 100%)' },
]

/** Home for operators: only the tasks ticked for them, their own entries, and their companies. */
export default function OperatorHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const access = useAccess()
  const stocks = useStocks(access.scope)
  const myTiles = tiles.filter((t) => access.canAnywhere(t.perm))
  const ids = access.scope.map((c) => c.id)
  // The server only returns this operator's own entries.
  const held = useEntries({ status: ['on_hold'], company_id: ids, page_size: 1 })
  const hour = dayjs().hour()

  return (
    <div className="page">
      <PageHeader
        eyebrow={dayjs().format('dddd, D MMMM YYYY')}
        title={`${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${firstName(user)}`}
        subtitle={`What would you like to do? You're working on ${access.scope.map((c) => c.name).join(', ')}.`}
      />

      {myTiles.length ? (
        <div className={`grid grid-${myTiles.length}`}>
          {myTiles.map((t) => (
            <div key={t.to} className="task-tile fade-in" style={{ background: t.bg }} onClick={() => navigate(t.to)}>
              <div className="tile-icon">{t.icon}</div>
              <div>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </div>
              <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
                Start <ArrowRightOutlined />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="surface" style={{ padding: 24 }}>
          <Empty description="No entry tasks are ticked for you. Ask your Super Admin if that is wrong." />
        </div>
      )}

      {(held.data?.total ?? 0) > 0 && (
        <>
          <SectionTitle title="Finance has questions" hint="Open an entry to read the comment and reply" />
          <div className="surface table-card" style={{ borderColor: '#f5c8d3' }}>
            <EntryTable types={[...ALL]} companies={access.scope} statuses={['on_hold']} compact />
          </div>
        </>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', marginTop: 8 }}>
        <div>
          <SectionTitle title="My entries" hint="newest first" />
          <div className="surface table-card">
            <EntryTable types={[...ALL]} companies={access.scope} pageSize={8} compact />
          </div>
        </div>
        <div>
          <SectionTitle title="My companies" hint="stock right now" />
          <div style={{ display: 'grid', gap: 16 }}>
            {access.scope.map((c) => (
              <CompanyCard key={c.id} company={c} raw={stocks.byCompany.get(c.id)?.raw} output={stocks.byCompany.get(c.id)?.output} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
