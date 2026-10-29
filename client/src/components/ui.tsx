import type { ReactNode } from 'react'
import { Button, Popover, Tag, Tooltip } from 'antd'
import {
  EditOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'
import { formatKg } from '../utils/format'
import { seriesColors } from '../styles/theme'
import { itemName, type MaterialId, type OutputId } from '../data/catalog'
import type { EntrySource, EntryStatus, EntryType, Grade } from '../types/entries'
import { gradeInfo } from '../data/grades'
import { statusMeta } from '../utils/entryStatus'

/* ---------- Brand ---------- */

export function MichyMark({ size = 28, ink = '#191919' }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={(size * 90) / 120} viewBox="0 0 120 90" aria-hidden>
      <path fill={ink} d="M96 0H120V90H98V34L72 68L60 52Z" />
      <path fill="#D82E54" d="M0 0H26L70 58V90H48L22 55V90H0Z" />
    </svg>
  )
}

/* ---------- Page scaffolding ---------- */

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  extra,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="page-header fade-in">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {extra && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{extra}</div>}
    </div>
  )
}

export function SectionTitle({ title, hint, extra }: { title: ReactNode; hint?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="section-title">
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h2>{title}</h2>
        {hint && <span className="hint">{hint}</span>}
      </div>
      {extra}
    </div>
  )
}

/**
 * A small "How it works" button. Hover (or tap) opens a panel with the full explanation, so
 * cards stay short and the details are one move away.
 */
export function HintButton({ title, children, label = 'How it works' }: { title: ReactNode; children: ReactNode; label?: string }) {
  return (
    <Popover
      trigger={['hover', 'click']}
      placement="bottomLeft"
      title={<span style={{ fontSize: 15 }}>{title}</span>}
      content={<div className="hint-panel">{children}</div>}
      mouseEnterDelay={0.15}
    >
      <Button size="small" type="text" icon={<QuestionCircleOutlined />} className="hint-button" aria-label={label}>
        {label}
      </Button>
    </Popover>
  )
}

export function Help({ text }: { text: ReactNode }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined style={{ color: '#9aa1ad', fontSize: 13, cursor: 'help' }} />
    </Tooltip>
  )
}

/* ---------- Numbers ---------- */

export function Qty({ kg, block, strong }: { kg: number; block?: boolean; strong?: boolean }) {
  return (
    <span className="num" style={{ display: block ? 'block' : 'inline' }}>
      <span style={{ fontWeight: strong ? 800 : 600, color: strong ? '#191919' : undefined }}>{formatKg(kg)}</span>
    </span>
  )
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone,
  help,
  onClick,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon: ReactNode
  tone: { bg: string; fg: string }
  help?: ReactNode
  onClick?: () => void
}) {
  return (
    <div className="surface kpi fade-in" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <div className="kpi-label">
        <span className="kpi-icon" style={{ background: tone.bg, color: tone.fg }}>
          {icon}
        </span>
        {label}
        {help && <Help text={help} />}
      </div>
      <div className="kpi-value" style={{ marginTop: 6 }}>
        {value}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/* ---------- Formula card ---------- */

export interface FormulaPart {
  label: string
  value: string
  op?: '+' | '−' | '='
  kind?: 'in' | 'out' | 'result'
}

export function Formula({ parts }: { parts: FormulaPart[] }) {
  return (
    <div className="formula">
      {parts.map((p, i) => (
        <div key={i} style={{ display: 'contents' }}>
          {p.op && <div className="formula-op">{p.op}</div>}
          <div className={`formula-item ${p.kind ?? ''}`}>
            <div className="f-label">{p.label}</div>
            <div className="f-value">{p.value}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Tags ---------- */

export function MaterialTag({ id }: { id: MaterialId }) {
  return (
    <span className="pill" style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#3a3f47' }}>
      <span className="legend-dot" style={{ background: seriesColors[id] }} />
      {itemName(id)}
    </span>
  )
}

export function ProductTag({ id }: { id: OutputId }) {
  return (
    <span className="pill" style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#3a3f47' }}>
      <span className="legend-dot" style={{ background: seriesColors[id] }} />
      {itemName(id)}
    </span>
  )
}

export function StatusTag({ status }: { status: EntryStatus }) {
  const m = statusMeta[status]
  return (
    <Tooltip title={m.hint}>
      <Tag color={m.color} icon={m.icon} variant="filled" style={{ fontWeight: 700, borderRadius: 999, paddingInline: 10 }}>
        {m.label}
      </Tag>
    </Tooltip>
  )
}

export function SourceTag({ source }: { source: EntrySource }) {
  return source === 'ai' ? (
    <Tooltip title="Details taken from the uploaded bill and checked by a person">
      <span className="pill" style={{ background: '#f4efff', color: '#6941c6' }}>
        <ThunderboltFilled /> From bill
      </span>
    </Tooltip>
  ) : (
    <span className="pill">
      <EditOutlined /> Typed in
    </span>
  )
}

/* ---------- Stock bar ---------- */

export function StockBar({ parts, total, height = 10 }: { parts: { key: string; value: number; color: string }[]; total?: number; height?: number }) {
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className="stockbar" style={{ height }}>
      {parts.map((p) => (
        <Tooltip key={p.key} title={`${p.key}: ${formatKg(p.value)}`}>
          <span style={{ width: `${(Math.max(p.value, 0) / (sum || 1)) * 100}%`, background: p.color }} />
        </Tooltip>
      ))}
    </div>
  )
}

/** Grade A / B / C, with what it means for this kind of entry on hover. */
export function GradeTag({ grade, type }: { grade: Grade; type?: EntryType }) {
  const g = gradeInfo(grade)
  const hint = type === 'production' ? 'Production is always Grade A' : type ? g[type] : g.short
  return (
    <Tooltip title={`${g.name}: ${hint}`}>
      <span className="pill" style={{ background: g.bg, color: g.fg, fontWeight: 800 }}>
        {grade}
      </span>
    </Tooltip>
  )
}
