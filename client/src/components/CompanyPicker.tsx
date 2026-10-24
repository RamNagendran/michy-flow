import { Select } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import type { Company } from '../types/auth'

/** Picks one company for reports that only make sense per company. Hidden when there is one. */
export default function CompanyPicker({ companies, value, onChange }: { companies: Company[]; value?: number; onChange: (id: number) => void }) {
  if (companies.length < 2) return null
  return (
    <Select<number>
      value={value}
      onChange={onChange}
      prefix={<ApartmentOutlined className="faint" />}
      style={{ minWidth: 220 }}
      popupMatchSelectWidth={false}
      options={companies.map((c) => ({ value: c.id, label: c.name }))}
      aria-label="Company"
    />
  )
}
