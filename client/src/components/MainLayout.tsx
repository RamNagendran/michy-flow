import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Badge, Button, Dropdown, Layout, Popover, Tooltip, type MenuProps } from 'antd'
import {
  BankOutlined,
  BellOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  FileTextFilled,
  KeyOutlined,
  LogoutOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { useAuth } from '../hooks/useAuth'
import { useAccess } from '../hooks/useAccess'
import { useQueueCounts } from '../hooks/useQueueCounts'
import { useRealtimeStatus } from '../hooks/useRealtime'
import { roleColor, SCREEN_ACCESS } from '../utils/permissions'
import { isOperatorOnly } from '../utils/navigation'
import { accessRoleLabel, initials } from '../utils/user'
import CompanySwitcher from './CompanySwitcher'
import NoCompanies from './NoCompanies'
import PeriodPicker from './PeriodPicker'
import SidebarNavigation from './SidebarNavigation'

const { Header, Content } = Layout

const titles: [string, string][] = [
  ['/purchases/new', 'New purchase'],
  ['/purchases', 'Purchases'],
  ['/production/new', 'Record production'],
  ['/production', 'Production'],
  ['/stock', 'Stock'],
  ['/companies', 'Company'],
  ['/sales/new', 'New sale'],
  ['/sales', 'Sales'],
  ['/finance', 'Finance'],
  ['/reports', 'Reports'],
  ['/pricing', 'Purchase prices'],
  ['/wastage', 'Wastage control'],
  ['/records', 'All records'],
  ['/settings', 'Settings'],
  ['/review', 'Approvals'],
  ['/parties', 'Suppliers & buyers'],
]

const URGENT = new Set(['hold', 'escalated', 'wastage'])

const PERIOD_PAGES = ['/finance', '/stock', '/companies', '/reports', '/pricing', '/wastage', '/purchases', '/sales', '/production']

export default function MainLayout() {
  const { user, logout } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const operatorOnly = isOperatorOnly(access.companies)
  const queue = useQueueCounts()
  const live = useRealtimeStatus()
  const role = user?.global_role ?? access.activeAccess?.role ?? access.companies[0]?.role ?? null

  const title = titles.find(([p]) => pathname.startsWith(p))?.[1] ?? (operatorOnly ? 'Home' : 'Dashboard')
  const showPeriod = !operatorOnly && !pathname.endsWith('/new') && (pathname === '/' || PERIOD_PAGES.some((p) => pathname.startsWith(p)))

  const items = [
    { key: 'admin', n: queue.admin, text: 'waiting for your approval', tab: 'admin' },
    { key: 'finance', n: queue.finance, text: 'waiting for your verification', tab: 'finance' },
    { key: 'hold', n: queue.hold, text: 'on hold with questions from Finance', tab: 'hold' },
    { key: 'escalated', n: queue.escalated, text: 'escalated by Finance to operations', tab: 'escalated' },
    { key: 'wastage', n: queue.wastage, text: 'over the 2% wastage limit, waiting for a debit note', tab: 'wastage' },
  ].filter((i) => i.n > 0)
  const notifications = (
    <div style={{ width: 340 }}>
      <div style={{ fontWeight: 800, fontSize: 15, padding: '4px 4px 10px' }}>Notifications</div>
      {items.length ? (
        items.map((i) => (
          <div key={i.key} className="qa-row" onClick={() => navigate(i.key === 'wastage' ? '/wastage' : `/review?tab=${i.tab}`)}>
            <span className="kpi-icon" style={{ background: URGENT.has(i.key) ? '#fdeef2' : '#f4efff', color: URGENT.has(i.key) ? '#D4380D' : '#6941c6' }}>
              <FileTextFilled />
            </span>
            <div style={{ flex: 1 }} className="strong">
              {i.n} {i.n === 1 ? 'entry' : 'entries'} {i.text}
            </div>
          </div>
        ))
      ) : (
        <div className="faint" style={{ padding: '8px 4px 4px', fontSize: 13.5 }}>
          Nothing needs your attention right now.
        </div>
      )}
    </div>
  )

  const userMenu: MenuProps = {
    items: [
      {
        key: 'who',
        type: 'group',
        label: (
          <div style={{ lineHeight: 1.35, padding: '2px 0' }}>
            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{user?.full_name}</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {user?.email}
            </div>
          </div>
        ),
      },
      { type: 'divider' },
      { key: 'password', icon: <KeyOutlined />, label: 'Change password' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', danger: true },
    ],
    onClick: ({ key }) => {
      if (key === 'password') navigate('/change-password')
      if (key === 'logout') logout()
    },
  }

  const newEntry: MenuProps = {
    items: [
      access.canAnywhere('enter_purchase') && { key: '/purchases/new', icon: <ShoppingCartOutlined />, label: 'Record a purchase' },
      access.canAnywhere('enter_production') && { key: '/production/new', icon: <ExperimentOutlined />, label: 'Record production' },
      access.canAnywhere('enter_sales') && { key: '/sales/new', icon: <ShopOutlined />, label: 'Record a sale' },
    ].filter((i) => !!i),
    onClick: ({ key }) => navigate(key),
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <SidebarNavigation />

      <Layout>
        <Header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div className="topbar-title">{title}</div>
            <CompanySwitcher />
            {showPeriod && <PeriodPicker />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {access.canAnywhere(...SCREEN_ACCESS.enterAny) && (
              <Dropdown menu={newEntry} placement="bottomRight">
                <Button type="primary" icon={<PlusOutlined />} size="large">
                  New entry
                </Button>
              </Dropdown>
            )}
            <Tooltip title={live === 'live' ? 'Live: changes by others appear straight away' : 'Reconnecting… screens refresh when the connection is back'}>
              <span className="pill" style={{ background: live === 'live' ? '#e8f6ef' : '#fff6e6', color: live === 'live' ? '#1f9d6b' : '#b26b00' }}>
                <span className="legend-dot" style={{ background: live === 'live' ? '#1f9d6b' : '#d98a0b' }} />
                {live === 'live' ? 'Live' : 'Reconnecting'}
              </span>
            </Tooltip>
            <Tooltip title="Search records">
              <Button shape="circle" size="large" icon={<FileSearchOutlined />} onClick={() => navigate(access.canAnywhere(...SCREEN_ACCESS.records) ? '/records' : '/purchases')} />
            </Tooltip>
            <Popover content={notifications} trigger="click" placement="bottomRight">
              <Badge count={queue.total} size="small" offset={[-4, 4]}>
                <Button shape="circle" size="large" icon={<BellOutlined />} />
              </Badge>
            </Popover>
            <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
              <div className="user-chip">
                <Avatar style={{ background: role ? roleColor[role] : undefined, fontWeight: 700 }}>{initials(user)}</Avatar>
                <div style={{ lineHeight: 1.25 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{user?.full_name}</div>
                  <div className="faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <BankOutlined /> {accessRoleLabel(user, access.activeAccess ?? access.companies[0])} · {access.activeAccess?.company.name ?? user?.account.name}
                  </div>
                </div>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content>
          {/* Keyed on the path so each page eases in; opacity and transform only, so it stays cheap. */}
          <div key={pathname} className="page-enter">
            {access.companies.length === 0 && !pathname.startsWith('/settings') ? <NoCompanies /> : <Outlet />}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
