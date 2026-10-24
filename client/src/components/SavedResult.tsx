import type { ReactNode } from 'react'
import { Button } from 'antd'
import { CheckOutlined } from '@ant-design/icons'

export default function SavedResult({
  title,
  subtitle,
  refId,
  lines,
  effects,
  actions,
}: {
  title: string
  subtitle: ReactNode
  refId: string
  lines: [string, ReactNode][]
  effects: ReactNode[]
  actions: { label: string; onClick: () => void; primary?: boolean }[]
}) {
  return (
    <div className="fade-in" style={{ maxWidth: 680, margin: '8px auto 0' }}>
      <div className="surface" style={{ padding: '40px 40px 32px', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#e8f6ef', display: 'grid', placeItems: 'center', margin: '0 auto' }}>
          <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#1f9d6b', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 24 }}>
            <CheckOutlined />
          </div>
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, margin: '18px 0 6px' }}>{title}</h2>
        <div className="muted" style={{ fontSize: 15 }}>
          {subtitle}
        </div>
        <div className="pill" style={{ marginTop: 14, fontSize: 13.5 }}>
          Reference <b style={{ color: '#191919' }}>{refId}</b>
        </div>

        <div style={{ textAlign: 'left', marginTop: 26, background: '#f7f8fa', borderRadius: 12, padding: '6px 18px' }}>
          {lines.map(([k, v]) => (
            <div className="summary-line" key={k}>
              <span className="muted">{k}</span>
              <span className="num" style={{ fontWeight: 700 }}>
                {v}
              </span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'left', marginTop: 18 }}>
          <div className="faint" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            What changed
          </div>
          {effects.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 14 }}>
              <CheckOutlined style={{ color: '#1f9d6b', marginTop: 4 }} />
              <span>{e}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 28 }}>
          {actions.map((a) => (
            <Button key={a.label} size="large" type={a.primary ? 'primary' : 'default'} onClick={a.onClick}>
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
