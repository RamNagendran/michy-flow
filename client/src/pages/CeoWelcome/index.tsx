import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { AppstoreOutlined, FunctionOutlined, LogoutOutlined, RightOutlined } from '@ant-design/icons'
import logo from '../../assets/michy-logo.png'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { CompanyBadge } from '../../components/CompanyCards'
import { totalOf } from '../../utils/stock'
import { useStocks } from '../../hooks/queries/stock'
import type { CompanySelection } from '../../statemanager/slices/uiSlice'
import { formatTonnes } from '../../utils/format'
import { companyRoleLabel } from '../../utils/permissions'
import { accessRoleLabel, firstName } from '../../utils/user'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function PickCard({ badge, name, detail, onClick }: { badge: React.ReactNode; name: string; detail: string; onClick: () => void }) {
  return (
    <div className="surface loc-card fade-in" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {badge}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="strong" style={{ fontSize: 16 }}>
          {name}
        </div>
        <div className="faint" style={{ fontSize: 13 }}>
          {detail}
        </div>
      </div>
      <RightOutlined className="faint" />
    </div>
  )
}

/** Home screen for anyone who can see several companies: pick the entity to work on. */
export default function CeoWelcome() {
  const { user, logout } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  const stocks = useStocks(access.companies.map((c) => c.company))
  if (access.companies.length < 2) return <Navigate to="/" replace />

  const open = (c: CompanySelection) => {
    access.setActive(c)
    navigate('/')
  }

  return (
    <div className="welcome">
      <header className="welcome-top">
        <img src={logo} alt="Michy Rubbers" style={{ height: 44 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <Button size="large" icon={<AppstoreOutlined />} onClick={() => navigate('/')}>
            Go to dashboard
          </Button>
          <Button size="large" icon={<LogoutOutlined />} onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="welcome-body">
        <div className="welcome-hero fade-in">
          <div>
            <div className="eyebrow">
              {user?.account.name} · {accessRoleLabel(user, access.companies[0]) || 'Choose a company'}
            </div>
            <h1>
              {greeting()}, {firstName(user)}
            </h1>
            <p>
              You have access to {access.companies.length} companies. Choose one to open its dashboard, or look at all of them together. You can switch at any time
              from the top of the screen.
            </p>
          </div>
        </div>

        <section className="welcome-section">
          <div className="grid grid-3">
            <PickCard
              badge={
                <div className="loc-badge total" style={{ background: '#D82E54' }}>
                  <FunctionOutlined />
                </div>
              }
              name="All companies"
              detail={`${access.companies.length} companies added together`}
              onClick={() => open('all')}
            />
            {access.companies.map(({ company, role }) => {
              const raw = stocks.byCompany.get(company.id)?.raw
              return (
                <PickCard
                  key={company.id}
                  badge={<CompanyBadge code={company.code} />}
                  name={company.name}
                  detail={[
                    !user?.global_role && role ? companyRoleLabel[role] : company.city,
                    raw && `${formatTonnes(totalOf(raw))} raw material in stock`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  onClick={() => open(company.id)}
                />
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
