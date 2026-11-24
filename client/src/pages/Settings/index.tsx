import { useSearchParams } from 'react-router-dom'
import { Select, Tabs } from 'antd'
import { PageHeader } from '../../components/ui'
import { useAccess } from '../../hooks/useAccess'
import { useIsMobile } from '../../hooks/useIsMobile'
import CompaniesTab from './CompaniesTab'
import { ProductsTab } from './MasterListsTab'
import UsersTab from './UsersTab'

export default function Settings() {
  const { canSystem } = useAccess()
  const [params, setParams] = useSearchParams()
  const mobile = useIsMobile()

  const items = [
    canSystem('manage_users') && { key: 'users', label: 'People & access', children: <UsersTab /> },
    canSystem('manage_companies') && { key: 'companies', label: 'Companies', children: <CompaniesTab /> },
    canSystem('manage_config') && { key: 'products', label: 'Company types & items', children: <ProductsTab /> },
  ].filter((i) => !!i)
  const active = items.some((i) => i.key === params.get('tab')) ? params.get('tab')! : items[0].key

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Add companies and people, and choose what each person can do. Suppliers and buyers are in Daily work." />
      {mobile ? (
        // On a phone the sections are a dropdown, so none hide off screen.
        <>
          <Select size="large" style={{ width: '100%', marginBottom: 12 }} value={active} onChange={(tab) => setParams({ tab }, { replace: true })} options={items.map((i) => ({ value: i.key, label: i.label }))} aria-label="Settings section" />
          <div className="surface settings-card">{items.find((i) => i.key === active)!.children}</div>
        </>
      ) : (
        <div className="surface settings-card">
          <Tabs activeKey={active} onChange={(tab) => setParams({ tab }, { replace: true })} items={items} destroyOnHidden />
        </div>
      )}
    </div>
  )
}
