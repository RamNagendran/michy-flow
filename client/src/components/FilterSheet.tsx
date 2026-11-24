import type { ReactNode } from 'react'
import { Badge, Button, Drawer, Tag } from 'antd'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'

export interface FilterChip {
  key: string
  label: ReactNode
  clear: () => void
}

/** Phone filters: opens the sheet; the count is how many filters are in use. `label` says what it filters, e.g. "Status & dates". */
export function FilterButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <Badge count={count} size="small">
      <Button icon={<FilterOutlined />} onClick={onClick}>
        {label}
      </Button>
    </Badge>
  )
}

/** Filters in use, each removable with its ✕. `extra` sits at the end of the row (e.g. a count). */
export function FilterChips({ chips, extra }: { chips: FilterChip[]; extra?: ReactNode }) {
  if (!chips.length && !extra) return null
  return (
    <div className="m-filter-chips">
      {chips.map((c) => (
        <Tag key={c.key} closable onClose={c.clear}>
          {c.label}
        </Tag>
      ))}
      {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
    </div>
  )
}

export function FilterField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="filter-sheet-field">
      <div className="filter-label">{label}</div>
      {children}
    </div>
  )
}

/** Every filter stacked in a sheet from the bottom of a phone screen. Filters apply as they change; the button just closes it. */
export function FilterSheet({ title, open, onClose, onReset, canReset, children }: { title: string; open: boolean; onClose: () => void; onReset: () => void; canReset: boolean; children: ReactNode }) {
  return (
    <Drawer
      placement="bottom"
      open={open}
      onClose={onClose}
      title={title}
      rootClassName="filter-sheet"
      footer={
        <div className="form-actions" style={{ marginTop: 0 }}>
          <Button icon={<ReloadOutlined />} disabled={!canReset} onClick={onReset}>
            Reset
          </Button>
          <Button type="primary" onClick={onClose}>
            Show results
          </Button>
        </div>
      }
    >
      {children}
    </Drawer>
  )
}
