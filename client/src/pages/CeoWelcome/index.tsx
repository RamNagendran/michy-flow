import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { AppstoreOutlined, LogoutOutlined, RightOutlined } from '@ant-design/icons'
import { useAccess } from '../../hooks/useAccess'
import { useAuth } from '../../hooks/useAuth'
import { useIsMobile } from '../../hooks/useIsMobile'
import { CompanyBadge } from '../../components/CompanyCards'
import { MichyMark } from '../../components/ui'
import { totalOf } from '../../utils/stock'
import { useStocks } from '../../hooks/queries/stock'
import type { CompanySelection } from '../../statemanager/slices/uiSlice'
import { formatKg } from '../../utils/format'
import { companyRoleLabel } from '../../utils/permissions'
import { accessRoleLabel, firstName } from '../../utils/user'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function PickCard({ badge, name, detail, onClick }: { badge: React.ReactNode; name: string; detail: string; onClick: () => void }) {
  return (
    <div className="surface loc-card pick-card fade-in" onClick={onClick}>
      {badge}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="strong pick-card-name">{name}</div>
        <div className="faint pick-card-detail">
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
  const mobile = useIsMobile()
  const stocks = useStocks(access.companies.filter((c) => c.permissions.includes('view_stock')).map((c) => c.company))
  if (access.companies.length < 2) return <Navigate to="/" replace />

  const open = (c: CompanySelection) => {
    access.setActive(c)
    navigate('/')
  }

  return (
    <div className="welcome">
      <header className="welcome-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MichyMark size={mobile ? 32 : 44} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontWeight: 800, letterSpacing: '0.14em', fontSize: 17 }}>
              <span style={{ color: '#D82E54' }}>MICHY</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>Group of Companies</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Icons only on a phone, so both fit next to the logo. */}
          <Button size={mobile ? 'middle' : 'large'} icon={<AppstoreOutlined />} onClick={() => navigate('/')} aria-label="Go to dashboard">
            {!mobile && 'Go to dashboard'}
          </Button>
          <Button size={mobile ? 'middle' : 'large'} icon={<LogoutOutlined />} onClick={() => logout()} aria-label="Sign out">
            {!mobile && 'Sign out'}
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
              You have access to {access.companies.length} companies. Choose one to open its dashboard. You can switch at any time
              from the top of the screen.
            </p>
          </div>
        </div>

        <section className="welcome-section">
          <div className="grid grid-3">
            {access.companies.map(({ company, role }) => {
              const raw = stocks.byCompany.get(company.id)?.raw
              return (
                <PickCard
                  key={company.id}
                  badge={<CompanyBadge code={company.code} size={mobile ? 36 : undefined} />}
                  name={company.name}
                  detail={[
                    !user?.global_role && role ? companyRoleLabel[role] : company.city,
                    raw && `${formatKg(totalOf(raw))} raw material in stock`,
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
