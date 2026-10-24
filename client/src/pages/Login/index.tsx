import { Link, useLocation, useNavigate, type Location } from 'react-router-dom'
import { Alert, Button, Form, Input } from 'antd'
import { LockOutlined, MailOutlined } from '@ant-design/icons'
import AuthLayout from '../../components/AuthLayout'
import { useLogin } from '../../hooks/queries/auth'
import { errorMessage } from '../../services/apiError'
import type { LoginRequest } from '../../types/auth'
import { homePath } from '../../utils/navigation'

export default function Login() {
  const login = useLogin()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: Location } | null)?.from?.pathname

  const onFinish = (values: LoginRequest) =>
    login.mutate(values, {
      onSuccess: ({ user }) => navigate(user.must_change_password ? '/change-password' : (from ?? homePath(user)), { replace: true }),
    })

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in with your work email to continue.">
      {login.isError && <Alert type="error" showIcon title={errorMessage(login.error)} style={{ marginBottom: 20 }} />}
      <Form<LoginRequest> layout="vertical" size="large" requiredMark={false} onFinish={onFinish} disabled={login.isPending}>
        <Form.Item label="Work email" name="email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
          <Input prefix={<MailOutlined className="faint" />} placeholder="name@michy.in" autoComplete="email" autoFocus />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Enter your password' }]}>
          <Input.Password prefix={<LockOutlined className="faint" />} placeholder="Enter your password" autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={login.isPending} style={{ height: 50, fontSize: 16, marginTop: 4 }}>
          Sign in
        </Button>
      </Form>
      <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
        New to Michy Flow? <Link to="/signup" style={{ fontWeight: 700 }}>Create an account</Link>
      </p>
    </AuthLayout>
  )
}
