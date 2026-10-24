interface Item {
  name?: string | number
  value?: number | string | (number | string)[]
  color?: string
  dataKey?: string | number
}

/** A calm, readable tooltip used by every chart. Text stays in ink; only the swatch carries colour. */
export default function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean
  payload?: Item[]
  label?: string | number
  format: (v: number, key?: string) => string
  /** Turns the raw x value (e.g. a period date) into a heading. */
  labelFormat?: (label: string) => string
}) {
  if (!active || !payload?.length) return null
  const heading = label !== undefined && labelFormat ? labelFormat(String(label)) : label
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e8eaee',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(16,24,40,0.12)',
        padding: '10px 12px',
        minWidth: 170,
      }}
    >
      {heading !== undefined && <div style={{ fontWeight: 800, marginBottom: 6, color: '#191919' }}>{heading}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '2px 0' }}>
          <span className="legend-dot" style={{ background: p.color }} />
          <span style={{ color: '#5b6270', flex: 1 }}>{p.name}</span>
          <span className="num" style={{ fontWeight: 800, color: '#191919' }}>
            {format(Number(p.value), String(p.dataKey))}
          </span>
        </div>
      ))}
    </div>
  )
}
