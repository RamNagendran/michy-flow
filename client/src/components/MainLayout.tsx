import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Badge, Button, ConfigProvider, Dropdown, Layout, Popover, Tooltip, type MenuProps, type ThemeConfig } from 'antd'
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
import { roleColor, SCREEN_ACCESS } from '../utils/permissions'
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

/** Smaller controls just for the header bar, so it stays on one calm line. */
const HEADER_THEME: ThemeConfig = { token: { controlHeight: 32, fontSize: 13 }, components: { Segmented: { trackPadding: 2 } } }

const URGENT = new Set(['hold', 'escalated', 'wastage'])

const PERIOD_PAGES = ['/finance', '/stock', '/companies', '/reports', '/pricing', '/wastage', '/purchases', '/sales', '/production']

export default function MainLayout() {
  const { user, logout } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const sees = (screen: keyof typeof SCREEN_ACCESS) => access.canAnywhere(...SCREEN_ACCESS[screen])
  const seesDashboard = sees('dashboard')
  // Search opens the widest list this person may see.
  const searchScreen = (['records', 'purchases', 'sales', 'production'] as const).find((s) => sees(s))
  const queue = useQueueCounts()
  const role = user?.global_role ?? access.activeAccess?.role ?? access.companies[0]?.role ?? null

  const title = titles.find(([p]) => pathname.startsWith(p))?.[1] ?? (seesDashboard ? 'Dashboard' : 'Home')
  const showPeriod = seesDashboard && !pathname.endsWith('/new') && (pathname === '/' || PERIOD_PAGES.some((p) => pathname.startsWith(p)))

  const items = [
    { key: 'admin', n: queue.admin, text: 'waiting for your approval', tab: 'admin' },
    { key: 'finance', n: queue.finance, text: 'waiting for your verification', tab: 'finance' },
    { key: 'hold', n: queue.hold, text: 'on hold with questions from Finance', tab: 'hold' },
    { key: 'escalated', n: queue.escalated, text: 'escalated by Finance to operations', tab: 'escalated' },
    { key: 'wastage', n: queue.wastage, text: 'have wastage above 2% and need a debit note', tab: 'wastage' },
  ].filter((i) => i.n > 0)
  const notifications = (
    <div style={{ width: 340 }}>
      <div style={{ fontWeight: 800, fontSize: 15, padding: '4px 4px 10px' }}>Notifications</div>
      {items.length ? (
        items.map((i) => (
          <div key={i.key} className="qa-row" onClick={() => navigate(i.key === 'wastage' ? '/wastage' : sees('review') ? `/review?tab=${i.tab}` : '/')}>
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

  const roleText = `${accessRoleLabel(user, access.activeAccess ?? access.companies[0])} · ${access.activeAccess?.company.name ?? user?.account.name ?? ''}`

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
            <div className="faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <BankOutlined /> {roleText}
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
        <ConfigProvider theme={HEADER_THEME}>
          <Header className="topbar">
            <div className="topbar-group topbar-left">
              <div className="topbar-title">{title}</div>
              <CompanySwitcher />
              {showPeriod && <PeriodPicker />}
            </div>
            <div className="topbar-group topbar-right">
              {access.canAnywhere(...SCREEN_ACCESS.enterAny) && (
                <Dropdown menu={newEntry} placement="bottomRight">
                  <Button type="primary" icon={<PlusOutlined />}>
                    New entry
                  </Button>
                </Dropdown>
              )}
              {searchScreen && (
                <Tooltip title="Search records">
                  <Button shape="circle" icon={<FileSearchOutlined />} onClick={() => navigate(`/${searchScreen}`)} />
                </Tooltip>
              )}
              <Popover content={notifications} trigger="click" placement="bottomRight">
                <Badge count={queue.total} size="small" offset={[-2, 2]}>
                  <Button shape="circle" icon={<BellOutlined />} />
                </Badge>
              </Popover>
              {/* Just the avatar; name, role and company show on hover and in the menu. */}
              <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
                <button type="button" className="user-avatar" aria-label="Account menu">
                  <Avatar size={32} style={{ background: role ? roleColor[role] : undefined, fontWeight: 700, fontSize: 13 }}>
                    {initials(user)}
                  </Avatar>
                </button>
              </Dropdown>
            </div>
          </Header>
        </ConfigProvider>
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
