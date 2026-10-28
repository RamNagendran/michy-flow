import { useEffect, useMemo, useRef, useState } from 'react'
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
  PushpinFilled,
  PushpinOutlined,
  SettingOutlined,
  TeamOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { useAccess } from '../hooks/useAccess'
import { useQueueCounts } from '../hooks/useQueueCounts'
import { useAppDispatch, useAppSelector } from '../statemanager/hooks'
import { sidebarPinToggled } from '../statemanager/slices/uiSlice'
import { SCREEN_ACCESS } from '../utils/permissions'
import { MichyMark } from './ui'

type Item = NonNullable<MenuProps['items']>[number]

const FULL = 256
const RAIL = 80
/** Wait a moment before opening, so passing the mouse over the edge does not flash the menu. */
const OPEN_DELAY_MS = 150

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

/**
 * Shows only the screens the person's permissions open (see SCREEN_ACCESS).
 * Icons only by default; hovering opens the full menu over the page, so the page does not move.
 * Pinned, it stays open and takes its own space.
 */
export default function SidebarNavigation() {
  const access = useAccess()
  const sees = (screen: keyof typeof SCREEN_ACCESS) => access.canAnywhere(...SCREEN_ACCESS[screen])
  const queue = useQueueCounts()
  const showSettings = access.canSystem('manage_users') || access.canSystem('manage_companies')
  const pinned = useAppSelector((s) => s.ui.sidebarPinned)
  const [hovered, setHovered] = useState(false)
  const openTimer = useRef<number>(undefined)
  const collapsed = !pinned && !hovered
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => () => window.clearTimeout(openTimer.current), [])
  const open = () => {
    window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => setHovered(true), OPEN_DELAY_MS)
  }
  const close = () => {
    window.clearTimeout(openTimer.current)
    setHovered(false)
  }
  const togglePin = () => {
    dispatch(sidebarPinToggled())
    setHovered(false)
  }
  const pinLabel = pinned ? 'Close menu when not in use' : 'Keep menu open'

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
      sees('wastage') && { key: '/wastage', icon: <AlertOutlined />, label: 'Wastage control' },
      sees('pricing') && { key: '/pricing', icon: <DollarOutlined />, label: 'Purchase prices' },
      sees('finance') && { key: '/finance', icon: <LineChartOutlined />, label: 'Finance' },
      sees('records') && { key: '/records', icon: <DatabaseOutlined />, label: 'All records' },
    ]),
    ...(showSettings ? [{ key: '/settings', icon: <SettingOutlined />, label: 'Settings' }] : []),
  ]

  return (
    // The wrapper holds the page space; the menu itself floats over the page while hovered.
    <div className="sider-slot" style={{ width: pinned ? FULL : RAIL }}>
      <Layout.Sider
        width={FULL}
        collapsedWidth={RAIL}
        collapsible
        collapsed={collapsed}
        trigger={null}
        className={hovered && !pinned ? 'sider-floating' : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={() => setHovered(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}
        style={{ position: 'absolute', top: 0, left: 0, height: '100vh', overflow: 'hidden' }}
      >
        <div className="sider-logo" style={{ justifyContent: collapsed ? 'center' : undefined, padding: collapsed ? 0 : undefined }}>
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
        <div className="sider-footer">
          <button
            type="button"
            className="sider-toggle"
            onClick={togglePin}
            title={pinLabel}
            aria-label={pinLabel}
            aria-pressed={pinned}
            style={{ justifyContent: collapsed ? 'center' : undefined }}
          >
            {pinned ? <PushpinFilled /> : <PushpinOutlined />}
            {!collapsed && <span>{pinLabel}</span>}
          </button>
        </div>
      </Layout.Sider>
    </div>
  )
}
