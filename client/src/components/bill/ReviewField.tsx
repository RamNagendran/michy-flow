import type { ReactNode } from 'react'
import { Checkbox, Tooltip } from 'antd'
import type { ParsedValue } from '../../types/documents'

const sourceLabel: Record<ParsedValue['source'], string> = {
  qr: 'from the e-invoice QR code',
  label: 'next to its label on the bill',
  pattern: 'by its pattern on the bill',
  arithmetic: 'from quantity × rate on the bill',
}

/** How sure the reader was about one value. Anything under 90% asks the person to look. */
function Confidence({ value, source }: { value?: number; source?: ParsedValue['source'] }) {
  if (value === undefined) return null
  if (value === 0)
    return (
      <span className="pill" style={{ fontSize: 11.5, padding: '1px 8px', background: '#fdeef2', color: '#b8213f' }}>
        Not found — please fill in
      </span>
    )
  const low = value < 90
  const how = source ? ` Read ${sourceLabel[source]}.` : ''
  return (
    <Tooltip title={(low ? 'Not fully sure about this value. Please compare it with the bill.' : 'Read clearly.') + how}>
      <span className="pill" style={{ fontSize: 11.5, padding: '1px 8px', background: low ? '#fff6e6' : '#e8f6ef', color: low ? '#b26b00' : '#1f9d6b' }}>
        {source === 'qr' ? 'From QR code' : low ? 'Please check' : `${value}% sure`}
      </span>
    </Tooltip>
  )
}

/** One value read from the bill, with an optional "I've checked this" tick. */
export function XField({
  label,
  read,
  warn,
  note,
  verify,
  children,
}: {
  label: string
  /** What the bill reader found for this field; null when it found nothing. */
  read?: ParsedValue<unknown> | null
  warn?: boolean
  note?: ReactNode
  verify?: { checked: boolean; onChange: (v: boolean) => void }
  children: ReactNode
}) {
  const confidence = read === undefined ? undefined : (read?.confidence ?? 0)
  const low = confidence !== undefined && confidence < 90
  return (
    <div className={`xfield ${warn || (low && !verify?.checked) ? 'warn' : ''} ${verify?.checked ? 'ok-verified' : ''}`}>
      <div className="xfield-label">
        <span>{label}</span>
        <Confidence value={confidence} source={read?.source} />
      </div>
      {children}
      {note && (
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
          {note}
        </div>
      )}
      {verify && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e6e8ec' }}>
          <Checkbox checked={verify.checked} onChange={(e) => verify.onChange(e.target.checked)}>
            <span style={{ fontWeight: 700, fontSize: 13, color: verify.checked ? '#1f9d6b' : '#3a3f47' }}>
              {verify.checked ? 'Checked against the bill' : "I've checked this against the bill"}
            </span>
          </Checkbox>
        </div>
      )}
    </div>
  )
}
