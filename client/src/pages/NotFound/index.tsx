import { useNavigate } from 'react-router-dom'
import { Button, Result } from 'antd'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <Result
        status="404"
        title="Page not found"
        subTitle="The page you're looking for doesn't exist or has moved."
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            Back to home
          </Button>
        }
      />
    </div>
  )
}
