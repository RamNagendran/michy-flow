import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Badge, Layout, Menu, type MenuProps } from 'antd'
import {
  AlertOutlined,
  BarChartOutlined,
  DollarOutlined,
  AppstoreOutlined,
  AuditOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  InboxOutlined,
  LineChartOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  TeamOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { useAccess } from '../hooks/useAccess'
import { useQueueCounts } from '../hooks/useQueueCounts'
import { useAppDispatch, useAppSelector } from '../statemanager/hooks'
import { sidebarToggled } from '../statemanager/slices/uiSlice'
import { SCREEN_ACCESS } from '../utils/permissions'
import { MichyMark } from './ui'

type Item = NonNullable<MenuProps['items']>[number]

/** A menu group with only the entries this person may open; nothing at all when none are left. */
const group = (label: string | null, children: (Item | false)[]): Item[] => {
  const kept = children.filter((c): c is Item => !!c)
  return kept.length ? [{ type: 'group', label, children: kept }] : []
}

const withBadge = (label: string, count: number) =>
  count ? (
    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      {label} <Badge count={count} size="small" />
    </span>
  ) : (
    label
  )

/** Shows only the screens the person's permissions open (see SCREEN_ACCESS). */
export default function SidebarNavigation() {
  const access = useAccess()
  const sees = (screen: keyof typeof SCREEN_ACCESS) => access.canAnywhere(...SCREEN_ACCESS[screen])
  const queue = useQueueCounts()
  const showSettings = access.canSystem('manage_users') || access.canSystem('manage_companies')
  const collapsed = useAppSelector((s) => s.ui.sidebarCollapsed)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const selectedKey = useMemo(() => {
    if (pathname === '/') return '/'
    if (pathname.startsWith('/companies')) return '/stock'
    return '/' + pathname.split('/')[1]
  }, [pathname])

  const items: MenuProps['items'] = [
    { key: '/', icon: <AppstoreOutlined />, label: sees('dashboard') ? 'Dashboard' : 'Home' },
    ...group(collapsed ? null : 'Daily work', [
      sees('purchases') && { key: '/purchases', icon: <ShoppingCartOutlined />, label: 'Purchases' },
      sees('production') && { key: '/production', icon: <ExperimentOutlined />, label: 'Production' },
      sees('sales') && { key: '/sales', icon: <ShopOutlined />, label: 'Sales' },
      sees('review') && { key: '/review', icon: <AuditOutlined />, label: withBadge('Approvals', queue.total) },
      sees('parties') && { key: '/parties', icon: <TeamOutlined />, label: 'Suppliers & buyers' },
    ]),
    ...group(collapsed ? null : 'Stock', [sees('stock') && { key: '/stock', icon: <InboxOutlined />, label: 'Stock by company' }]),
    ...group(collapsed ? null : 'Reports', [
      sees('reports') && { key: '/reports', icon: <BarChartOutlined />, label: 'Reports' },
      sees('wastage') && { key: '/wastage', icon: <AlertOutlined />, label: withBadge('Wastage control', queue.wastage) },
      sees('pricing') && { key: '/pricing', icon: <DollarOutlined />, label: 'Purchase prices' },
      sees('finance') && { key: '/finance', icon: <LineChartOutlined />, label: 'Finance' },
      sees('records') && { key: '/records', icon: <DatabaseOutlined />, label: 'All records' },
    ]),
    ...(showSettings ? [{ key: '/settings', icon: <SettingOutlined />, label: 'Settings' }] : []),
  ]

  return (
    <Layout.Sider
      width={256}
      collapsedWidth={80}
      collapsible
      collapsed={collapsed}
      trigger={null}
      style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}
    >
      <div
        className="sider-logo"
        onClick={() => dispatch(sidebarToggled())}
        style={{ cursor: 'pointer', justifyContent: collapsed ? 'center' : undefined, padding: collapsed ? 0 : undefined }}
      >
        <MichyMark size={34} ink="#ffffff" />
        {!collapsed && (
          <div>
            <div className="wordmark">
              <span>MICHY</span> RUBBERS
            </div>
            <div className="tag">Operations</div>
          </div>
        )}
      </div>
      <div className="sider-menu">
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', marginTop: 12 }}
        />
      </div>
      {!collapsed && (
        <div className="sider-footer">
          <div className="sider-help">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 700, marginBottom: 4 }}>
              <QuestionCircleOutlined /> Need help?
            </div>
            Call the Michy support desk or watch the 3-minute guide.
          </div>
        </div>
      )}
    </Layout.Sider>
  )
}
