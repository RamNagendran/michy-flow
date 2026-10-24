import { useNavigate } from 'react-router-dom'
import { Button, Result } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import { useAccess } from '../hooks/useAccess'

/** Shown in place of every screen until the person has at least one company to work on. */
export default function NoCompanies() {
  const { canSystem } = useAccess()
  const navigate = useNavigate()
  const admin = canSystem('manage_companies')
  return (
    <div className="page">
      <Result
        icon={<ApartmentOutlined style={{ color: '#D82E54' }} />}
        title={admin ? 'Add your first company' : 'You have not been given a company yet'}
        subTitle={
          admin
            ? 'Purchases, production, stock and sales are all kept per company. Add the companies in your group, then add the people who work in them.'
            : 'Ask your Super Admin to add you to a company. You will see it here as soon as they do — sign out and back in if it does not appear.'
        }
        extra={
          admin && (
            <Button type="primary" size="large" onClick={() => navigate('/settings?tab=companies')}>
              Add a company
            </Button>
          )
        }
      />
    </div>
  )
}
