import { useNavigate } from 'react-router-dom'
import { Alert, Button, Form, Input } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import AuthLayout from '../../components/AuthLayout'
import { useChangePassword } from '../../hooks/queries/auth'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../services/apiError'
import { homePath } from '../../utils/navigation'

interface FormValues {
  current_password: string
  new_password: string
  confirm: string
}

/** Shown after signing in with a temporary password; nothing else opens until it is replaced. */
export default function ChangePassword() {
  const change = useChangePassword()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const forced = !!user?.must_change_password

  const onFinish = ({ current_password, new_password }: FormValues) =>
    change.mutate({ current_password, new_password }, { onSuccess: ({ user: next }) => navigate(homePath(next), { replace: true }) })

  return (
    <AuthLayout
      title={forced ? 'Set your own password' : 'Change password'}
      subtitle={forced ? 'You signed in with a temporary password. Choose a new one to continue.' : 'This signs you out on every other device.'}
    >
      {change.isError && <Alert type="error" showIcon title={errorMessage(change.error)} style={{ marginBottom: 20 }} />}
      <Form<FormValues> layout="vertical" size="large" requiredMark={false} onFinish={onFinish} disabled={change.isPending}>
        <Form.Item label={forced ? 'Temporary password' : 'Current password'} name="current_password" rules={[{ required: true, message: 'Enter the password you signed in with' }]}>
          <Input.Password prefix={<LockOutlined className="faint" />} autoComplete="current-password" autoFocus />
        </Form.Item>
        <Form.Item
          label="New password"
          name="new_password"
          dependencies={['current_password']}
          rules={[
            { required: true, min: 8, message: 'Use at least 8 characters' },
            ({ getFieldValue }) => ({
              validator: (_, v) => (!v || v !== getFieldValue('current_password') ? Promise.resolve() : Promise.reject(new Error('Choose a different password'))),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined className="faint" />} placeholder="At least 8 characters" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="Confirm new password"
          name="confirm"
          dependencies={['new_password']}
          rules={[
            { required: true, message: 'Type the new password again' },
            ({ getFieldValue }) => ({
              validator: (_, v) => (!v || v === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'))),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined className="faint" />} autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={change.isPending} style={{ height: 50, fontSize: 16, marginTop: 4 }}>
          Save new password
        </Button>
      </Form>
      <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
        <a onClick={() => logout()} style={{ fontWeight: 700 }}>
          Sign out instead
        </a>
      </p>
    </AuthLayout>
  )
}
