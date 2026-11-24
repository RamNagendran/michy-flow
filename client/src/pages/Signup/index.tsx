import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Form, Input } from 'antd'
import { ArrowLeftOutlined, BankOutlined, LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons'
import AuthLayout from '../../components/AuthLayout'
import { useSignup, useSignupOtp } from '../../hooks/queries/auth'
import { useResendTimer } from '../../hooks/useResendTimer'
import { errorMessage } from '../../services/apiError'
import type { SignupRequest } from '../../types/auth'

type Details = Omit<SignupRequest, 'otp'>
type SignupForm = Details & { confirm: string }

export default function Signup() {
  const signup = useSignup()
  const sendOtp = useSignupOtp()
  const navigate = useNavigate()
  const [details, setDetails] = useState<Details | null>(null)
  const [otp, setOtp] = useState('')
  const { waitSeconds, start: startTimer } = useResendTimer()

  const askCode = (d: Details) =>
    sendOtp.mutate(
      { email: d.email, full_name: d.full_name },
      {
        onSuccess: (res) => {
          setDetails(d)
          setOtp('')
          signup.reset()
          startTimer(res.resend_after_seconds)
        },
      },
    )

  const onDetails = ({ account_name, full_name, email, password }: SignupForm) => askCode({ account_name, full_name, email, password })

  const verify = () => details && signup.mutate({ ...details, otp }, { onSuccess: () => navigate('/', { replace: true }) })

  const step = details ? 'otp' : 'details'
  const error = step === 'otp' ? (signup.error ?? sendOtp.error) : sendOtp.error

  return (
    <AuthLayout
      title={step === 'otp' ? 'Check your email' : 'Create your organisation'}
      subtitle={step === 'otp' ? `We sent a 6-digit code to ${details?.email}. It works for 10 minutes.` : "Set up your group of companies. You'll be its Super Admin."}
    >
      {error && <Alert type="error" showIcon title={errorMessage(error)} style={{ marginBottom: 20 }} />}

      <Form<SignupForm>
        layout="vertical"
        size="large"
        requiredMark={false}
        onFinish={onDetails}
        disabled={sendOtp.isPending}
        style={{ display: step === 'details' ? undefined : 'none' }}
      >
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
        <Button type="primary" htmlType="submit" block size="large" loading={sendOtp.isPending} style={{ height: 50, fontSize: 16, marginTop: 4 }}>
          Send code to my email
        </Button>
      </Form>

      {step === 'otp' && details && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Enter the code</div>
          <Input.OTP length={6} size="large" value={otp} onChange={setOtp} disabled={signup.isPending} formatter={(v) => v.replace(/\D/g, '')} autoFocus />
          <Button
            type="primary"
            block
            size="large"
            disabled={otp.length !== 6}
            loading={signup.isPending}
            onClick={verify}
            style={{ height: 50, fontSize: 16, marginTop: 24 }}
          >
            Verify and create account
          </Button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
            <Button type="link" icon={<ArrowLeftOutlined />} style={{ padding: 0 }} onClick={() => setDetails(null)} disabled={signup.isPending}>
              Change details
            </Button>
            <Button type="link" style={{ padding: 0 }} onClick={() => askCode(details)} loading={sendOtp.isPending} disabled={waitSeconds > 0 || signup.isPending}>
              {waitSeconds > 0 ? `Resend code in ${waitSeconds}s` : 'Resend code'}
            </Button>
          </div>
          <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
            Can't find it? Check your spam folder.
          </p>
        </div>
      )}

      <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>
        Already have an account? <Link to="/login" style={{ fontWeight: 700 }}>Sign in</Link>
      </p>
    </AuthLayout>
  )
}
