import { Select } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import { useAccess } from '../hooks/useAccess'
import { companyRoleLabel } from '../utils/permissions'

/** Header picker for the company every screen shows. Hidden when the person has only one. */
export default function CompanySwitcher() {
  const { companies, active, setActive, isGlobal } = useAccess()
  if (companies.length < 2) return null

  const options = [
    { value: 'all' as const, label: `All companies (${companies.length})`, search: 'all companies' },
    ...companies.map((c) => ({
      value: c.company.id,
      label: (
        <span>
          {c.company.name}
          {!isGlobal && c.role && <span className="faint"> · {companyRoleLabel[c.role]}</span>}
        </span>
      ),
      search: `${c.company.name} ${c.company.code}`,
    })),
  ]

  return (
    <Select<number | 'all'>
      value={active ?? 'all'}
      onChange={setActive}
      options={options}
      prefix={<ApartmentOutlined className="faint" />}
      popupMatchSelectWidth={false}
      showSearch={{ optionFilterProp: 'search' }}
      style={{ minWidth: 180, maxWidth: 260 }}
      aria-label="Company"
    />
  )
}
