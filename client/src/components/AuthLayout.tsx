import type { ReactNode } from 'react'
import { ArrowRightOutlined, SafetyCertificateFilled } from '@ant-design/icons'
import { MichyLogo, MichyMark } from './ui'

const flow = ['Purchase', 'Production', 'Rubber · Steel', 'Sales', 'Finance check']

/** Brand panel on the left, form on the right. Shared by Login and Signup. On phones a short brand header sits on top and the form rises over it as a card. */
export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
          <MichyMark size={40} onDark />
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '0.14em', fontSize: 17 }}>
              <span style={{ color: '#D82E54' }}>MICHY</span> GROUP OF COMPANIES
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, fontWeight: 600 }}>Operations platform</div>
          </div>
        </div>

        <div style={{ position: 'relative', maxWidth: 600 }}>
          <div style={{ color: '#D82E54', fontWeight: 800, letterSpacing: '0.12em', fontSize: 12, marginBottom: 14 }}>
            CREATE A BETTER FUTURE BY MINIMIZING WASTE
          </div>
          <h1 style={{ color: '#fff', fontSize: 40, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
            Every kilo of tyre,
            <br />
            from purchase to sale.
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16, lineHeight: 1.6, marginTop: 18 }}>
            See what each company bought, what it produced, what is in stock and what was sold — approved, all in one place.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 36 }}>
            {flow.map((f, i) => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: i === 0 || i === flow.length - 1 ? 'rgba(216,46,84,0.18)' : 'rgba(255,255,255,0.07)',
                    border: `1px solid ${i === 0 || i === flow.length - 1 ? 'rgba(216,46,84,0.45)' : 'rgba(255,255,255,0.1)'}`,
                    fontWeight: 700,
                    fontSize: 12.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f}
                </div>
                {i < flow.length - 1 && <ArrowRightOutlined style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }} />}
              </div>
            ))}
          </div>
        </div>

        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12.5, position: 'relative', display: 'flex', gap: 8, alignItems: 'center' }}>
          <SafetyCertificateFilled /> Secure sign-in · Data stays within Michy Group of Companies
        </div>
      </div>

      {/* Phones only (hidden on a computer by global.css). */}
      <div className="login-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
          <MichyMark size={40} onDark />
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontWeight: 800, letterSpacing: '0.16em', fontSize: 16, color: '#D82E54' }}>MICHY</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>GROUP OF COMPANIES</div>
          </div>
        </div>
        <h1>
          Every kilo of tyre,
          <br />
          from purchase to sale.
        </h1>
      </div>

      <div className="login-form">
        <div className="login-card">
          <div className="login-logo">
            <MichyLogo height={110} />
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>{title}</h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 28, fontSize: 15 }}>
            {subtitle}
          </p>
          {children}
          <div className="login-secure">
            <SafetyCertificateFilled /> Secure sign-in
          </div>
        </div>
      </div>
    </div>
  )
}
