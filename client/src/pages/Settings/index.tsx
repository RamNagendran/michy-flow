import { useSearchParams } from 'react-router-dom'
import { Tabs } from 'antd'
import { PageHeader } from '../../components/ui'
import { useAccess } from '../../hooks/useAccess'
import AuditTab from './AuditTab'
import CompaniesTab from './CompaniesTab'
import { ProductsTab } from './MasterListsTab'
import RolesTab from './RolesTab'
import UsersTab from './UsersTab'

export default function Settings() {
  const { canSystem } = useAccess()
  const [params, setParams] = useSearchParams()

  const items = [
    canSystem('manage_users') && { key: 'users', label: 'People & access', children: <UsersTab /> },
    canSystem('manage_companies') && { key: 'companies', label: 'Companies', children: <CompaniesTab /> },
    { key: 'roles', label: 'What each role can do', children: <RolesTab /> },
    canSystem('view_audit') && { key: 'audit', label: 'Audit log', children: <AuditTab /> },
    canSystem('manage_config') && { key: 'products', label: 'Company types & items', children: <ProductsTab /> },
  ].filter((i) => !!i)
  const active = items.some((i) => i.key === params.get('tab')) ? params.get('tab')! : items[0].key

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Add companies and people, and choose what each person can do. Suppliers and buyers are in Daily work." />
      <div className="surface" style={{ padding: '4px 24px 24px' }}>
        <Tabs activeKey={active} onChange={(tab) => setParams({ tab }, { replace: true })} items={items} destroyOnHidden />
      </div>
    </div>
  )
}
