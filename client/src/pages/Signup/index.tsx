import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Form, Input } from 'antd'
import { BankOutlined, LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import AuthLayout from '../../components/AuthLayout'
import { useSignup } from '../../hooks/queries/auth'
import { errorMessage } from '../../services/apiError'
import type { SignupRequest } from '../../types/auth'

type SignupForm = SignupRequest & { confirm: string }

export default function Signup() {
  const signup = useSignup()
  const navigate = useNavigate()

  const onFinish = ({ account_name, full_name, email, password }: SignupForm) =>
    signup.mutate({ account_name, full_name, email, password }, { onSuccess: () => navigate('/', { replace: true }) })

  return (
    <AuthLayout title="Create your organisation" subtitle="Set up your group of companies. You'll be its Super Admin.">
      {signup.isError && <Alert type="error" showIcon title={errorMessage(signup.error)} style={{ marginBottom: 20 }} />}
      <Form<SignupForm> layout="vertical" size="large" requiredMark={false} onFinish={onFinish} disabled={signup.isPending}>
        <Form.Item
          label="Organisation name"
          name="account_name"
          rules={[{ required: true, whitespace: true, message: 'Enter your organisation name' }]}
          extra="Your group or business name. You can add your companies after you log in."
        >
          <Input prefix={<BankOutlined className="faint" />} placeholder="Michy Group" autoFocus />
        </Form.Item>
        <Form.Item label="Your name" name="full_name" rules={[{ required: true, whitespace: true, message: 'Enter your name' }]}>
          <Input prefix={<UserOutlined className="faint" />} placeholder="Full name" autoComplete="name" />
        </Form.Item>
        <Form.Item label="Work email" name="email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
          <Input prefix={<MailOutlined className="faint" />} placeholder="name@michy.in" autoComplete="email" />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={[{ required: true, min: 8, message: 'Use at least 8 characters' }]}>
          <Input.Password prefix={<LockOutlined className="faint" />} placeholder="At least 8 characters" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="Confirm password"
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Type the password again' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('Passwords do not match')),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined className="faint" />} placeholder="Type it again" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={signup.isPending} style={{ height: 50, fontSize: 16, marginTop: 4 }}>
          Create account
        </Button>
      </Form>
      <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
        Already have an account? <Link to="/login" style={{ fontWeight: 700 }}>Sign in</Link>
      </p>
    </AuthLayout>
  )
}
