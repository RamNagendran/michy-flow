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
import { isOperatorOnly } from '../utils/navigation'
import { SCREEN_ACCESS } from '../utils/permissions'
import { MichyMark } from './ui'

export default function SidebarNavigation() {
  const access = useAccess()
  const showFinance = access.canAnywhere(...SCREEN_ACCESS.finance)
  const showRecords = access.canAnywhere(...SCREEN_ACCESS.records)
  const showReports = access.canAnywhere(...SCREEN_ACCESS.reports)
  const showPricing = access.canAnywhere(...SCREEN_ACCESS.pricing)
  const showWastage = access.canAnywhere(...SCREEN_ACCESS.wastage)
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
    { key: '/', icon: <AppstoreOutlined />, label: isOperatorOnly(access.companies) ? 'Home' : 'Dashboard' },
    {
      type: 'group',
      label: collapsed ? null : 'Daily work',
      children: [
        { key: '/purchases', icon: <ShoppingCartOutlined />, label: 'Purchases' },
        { key: '/production', icon: <ExperimentOutlined />, label: 'Production' },
        { key: '/sales', icon: <ShopOutlined />, label: 'Sales' },
        {
          key: '/review',
          icon: <AuditOutlined />,
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Approvals <Badge count={queue.total} size="small" />
            </span>
          ),
        },
        { key: '/parties', icon: <TeamOutlined />, label: 'Suppliers & buyers' },
      ],
    },
    {
      type: 'group',
      label: collapsed ? null : 'Stock',
      children: [{ key: '/stock', icon: <InboxOutlined />, label: 'Stock by company' }],
    },
    ...(showFinance || showRecords || showReports
      ? [
          {
            type: 'group' as const,
            label: collapsed ? null : 'Reports',
            children: [
              ...(showReports ? [{ key: '/reports', icon: <BarChartOutlined />, label: 'Reports' }] : []),
              ...(showWastage
                ? [{ key: '/wastage', icon: <AlertOutlined />, label: queue.wastage ? <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>Wastage control <Badge count={queue.wastage} size="small" /></span> : 'Wastage control' }]
                : []),
              ...(showPricing ? [{ key: '/pricing', icon: <DollarOutlined />, label: 'Purchase prices' }] : []),
              ...(showFinance ? [{ key: '/finance', icon: <LineChartOutlined />, label: 'Finance' }] : []),
              ...(showRecords ? [{ key: '/records', icon: <DatabaseOutlined />, label: 'All records' }] : []),
            ],
          },
        ]
      : []),
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
