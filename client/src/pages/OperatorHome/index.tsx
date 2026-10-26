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
import type { EntryType } from '../../types/entries'
import { firstName } from '../../utils/user'
import OperatorCharts from './OperatorCharts'
import SaleableStock from '../../components/SaleableStock'

const tiles: { to: string; type: EntryType; perm: CompanyPermission; title: string; text: string; icon: React.ReactNode; bg: string }[] = [
  { to: '/purchases/new', type: 'purchase', perm: 'enter_purchase', title: 'Record a purchase', text: 'Upload the bill or type it in', icon: <ShoppingCartOutlined />, bg: 'linear-gradient(135deg, #D82E54 0%, #B8213F 100%)' },
  { to: '/production/new', type: 'production', perm: 'enter_production', title: 'Record production', text: 'What went in, what came out', icon: <ExperimentOutlined />, bg: 'linear-gradient(135deg, #2a2a31 0%, #191919 100%)' },
  { to: '/sales/new', type: 'sale', perm: 'enter_sales', title: 'Record a sale', text: 'Rubber, steel or other output', icon: <ShopOutlined />, bg: 'linear-gradient(135deg, #2F6FEB 0%, #1f55c4 100%)' },
]

/** Home for operators: only the tasks ticked for them and their own entries of those kinds. */
export default function OperatorHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const access = useAccess()
  const myTiles = tiles.filter((t) => access.canAnywhere(t.perm))
  // The server only returns entry kinds the person may enter; asking for just those keeps it obvious.
  const myTypes = myTiles.map((t) => t.type)
  const stockCompanies = access.scope.filter((c) => access.can('view_stock', c.id))
  const stocks = useStocks(stockCompanies)
  // Sales operators need to know what is there to sell before they record a sale.
  const saleCompanies = access.scope.filter((c) => access.can('enter_sales', c.id) && access.canReadStock(c.id))
  const saleStocks = useStocks(saleCompanies)
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
          <Empty description="No work is given to you yet. Please ask your Super Admin." />
        </div>
      )}

      {saleCompanies.length > 0 && (
        <>
          <SectionTitle title="Stock you can sell" hint="right now" />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {saleCompanies.map((c) => (
              <div key={c.id} className="surface" style={{ padding: 18 }}>
                <SaleableStock company={c} stock={saleStocks.byCompany.get(c.id)} />
              </div>
            ))}
          </div>
        </>
      )}

      {myTypes.length > 0 && <OperatorCharts types={myTypes} companyIds={ids} />}

      {(held.data?.total ?? 0) > 0 && (
        <>
          <SectionTitle title="Finance has questions" hint="Open an entry to read the comment and reply" />
          <div className="surface table-card" style={{ borderColor: '#f5c8d3' }}>
            <EntryTable types={myTypes} companies={access.scope} statuses={['on_hold']} compact />
          </div>
        </>
      )}

      <div className="grid" style={{ gridTemplateColumns: stockCompanies.length ? '1.4fr 1fr' : '1fr', marginTop: 8 }}>
        {myTypes.length > 0 && (
          <div>
            <SectionTitle title="My entries" hint="newest first" />
            <div className="surface table-card">
              <EntryTable types={myTypes} companies={access.scope} pageSize={8} compact />
            </div>
          </div>
        )}
        {stockCompanies.length > 0 && (
          <div>
            <SectionTitle title="My companies" hint="stock right now" />
            <div style={{ display: 'grid', gap: 16 }}>
              {stockCompanies.map((c) => (
                <CompanyCard key={c.id} company={c} raw={stocks.byCompany.get(c.id)?.raw} output={stocks.byCompany.get(c.id)?.output} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
