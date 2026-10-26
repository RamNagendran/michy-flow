import { useNavigate } from 'react-router-dom'
import { Table } from 'antd'
import { CompaniesTotalCard, CompanyBadge, CompanyCard, StockFigure } from '../../components/CompanyCards'
import { Formula, PageHeader, SectionTitle } from '../../components/ui'
import { itemName } from '../../data/catalog'
import { useCompanyData } from '../../hooks/useCompanyData'
import { seriesColors } from '../../styles/theme'
import type { CompanyRef } from '../../types/auth'
import type { StockLine, StockSection } from '../../types/entries'
import { formatINRShort, formatKg, formatQty } from '../../utils/format'
import { periodLabels } from '../../utils/period'

const zero: StockLine = { item: '', grade: 'A', unit: 'kg', counted_adjustment: 0, provisional: { in_qty: 0, out_qty: 0, balance: 0 }, confirmed: { in_qty: 0, out_qty: 0, balance: 0 } }
const dot = (item: string) => <span className="legend-dot" style={{ background: seriesColors[item as keyof typeof seriesColors] }} />

/** Items down the side, companies across the top, each cell "in stock (finalised)". */
function Matrix({ items, companies, lineFor, total }: { items: string[]; companies: CompanyRef[]; lineFor: (c: CompanyRef, item: string) => StockLine; total: (item: string) => StockLine }) {
  return (
    <Table
      scroll={{ x: 'max-content' }}
      pagination={false}
      rowKey={(i) => i}
      dataSource={items}
      columns={[
        { title: 'Item', render: (_, i) => <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>{dot(i)}{itemName(i)}</span> },
        ...companies.map((c) => ({ title: c.name, align: 'right' as const, render: (_: unknown, i: string) => <StockFigure line={lineFor(c, i)} /> })),
        ...(companies.length > 1 ? [{ title: 'All companies', align: 'right' as const, render: (_: unknown, i: string) => <StockFigure line={total(i)} /> }] : []),
      ]}
    />
  )
}

export default function StockOverview() {
  const navigate = useNavigate()
  const { scope, period, stocks, raw, output, resale, books, summaries } = useCompanyData()
  const several = scope.length > 1
  const find = (lines: StockLine[] | undefined, item: string) => lines?.find((l) => l.item === item) ?? zero
  // The server sends each company type's items; keep the ones anybody in view has touched.
  const touched = (lines: StockLine[]) => lines.filter((l) => l.provisional.in_qty || l.provisional.out_qty).map((l) => l.item)
  const rawItems = touched(raw)
  const resaleItems = touched(resale)
  const bookItems = touched(books)
  const products = output.map((l) => l.item)
  const matrix = (section: StockSection, items: string[], all: StockLine[]) => (
    <div className="surface table-card">
      <Matrix items={items} companies={scope} lineFor={(c, i) => find(stocks.get(c.id)?.[section], i)} total={(i) => find(all, i)} />
    </div>
  )

  return (
    <div className="page">
      <PageHeader
        title="Stock by company"
        subtitle="Stock is kept separately for each grade. Grade A: tyres for the plant and what it made. Grade B: tyres to sell again. Grade C: bill-only stock. Oil is in litres. The big number includes entries not yet checked. The small number is what Finance has checked."
      />

      <div className="grid grid-4">
        {scope.map((c) => (
          <CompanyCard key={c.id} company={c} raw={stocks.get(c.id)?.raw} output={stocks.get(c.id)?.output} summary={summaries.get(c.id)} />
        ))}
        {several && <CompaniesTotalCard count={scope.length} raw={raw} output={output} />}
      </div>

      <SectionTitle title="Grade A · Raw material for production" hint="Only these can go into production" />
      {matrix('raw', rawItems.length ? rawItems : raw.slice(0, 1).map((l) => l.item), raw)}

      <SectionTitle title="Grade A · Output ready to sell" hint="Made in the plant" />
      {matrix('output', products, output)}

      <SectionTitle title="Grade B · Raw material to re-sell" hint="Bought and sold on without processing" />
      {resaleItems.length ? matrix('resale', resaleItems, resale) : <div className="surface muted" style={{ padding: 18 }}>No Grade B stock yet. Record a purchase as Grade B to buy raw material for re-selling.</div>}

      <SectionTitle title="Grade C · Book stock" hint="Bills only. No goods move. Kept separate from Grade A and B." />
      {bookItems.length ? matrix('books', bookItems, books) : <div className="surface muted" style={{ padding: 18 }}>No Grade C entries yet.</div>}

      <SectionTitle title="How output stock is worked out" hint={several ? 'All companies in view' : scope[0]?.name} />
      <div className="grid" style={{ gap: 12 }}>
        {output
          .filter((line) => line.item !== 'other')
          .map((line) => {
            const l = line.provisional
            return (
              <div key={line.item} className="surface" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ width: 130, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {dot(line.item)}
                  {itemName(line.item)}
                </div>
                <div style={{ flex: 1 }}>
                  <Formula
                    parts={[
                      { label: 'Produced', value: formatQty(l.in_qty, line.unit), kind: 'in' },
                      { op: '−', label: 'Sold', value: formatQty(l.out_qty, line.unit), kind: 'out' },
                      { op: '=', label: 'Available now', value: formatQty(l.balance, line.unit), kind: 'result' },
                    ]}
                  />
                </div>
              </div>
            )
          })}
      </div>

      {summaries.size > 0 && (
        <>
          <SectionTitle title="Movement" hint={periodLabels[period]} />
          <div className="surface table-card">
            <Table
              scroll={{ x: 'max-content' }}
              pagination={false}
              rowKey="id"
              dataSource={scope.filter((c) => summaries.has(c.id))}
              onRow={(c) => ({ onClick: () => navigate(`/companies/${c.id}`), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: 'Company',
                  render: (_, c) => (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CompanyBadge code={c.code} size={30} />
                      <b>{c.name}</b>
                    </span>
                  ),
                },
                { title: 'Tyres for production (A)', align: 'right', render: (_, c) => <span className="num" style={{ color: '#1f9d6b', fontWeight: 700 }}>+{formatKg(summaries.get(c.id)!.purchases.by_grade[0].qty_kg)}</span> },
                { title: 'Tyres to re-sell (B)', align: 'right', render: (_, c) => <span className="num" style={{ fontWeight: 700 }}>+{formatKg(summaries.get(c.id)!.purchases.by_grade[1].qty_kg)}</span> },
                { title: 'Sent to production', align: 'right', render: (_, c) => <span className="num" style={{ color: '#D82E54', fontWeight: 700 }}>−{formatKg(summaries.get(c.id)!.production.input_kg)}</span> },
                { title: 'Output produced', align: 'right', render: (_, c) => <span className="num" style={{ fontWeight: 700 }}>{formatKg(summaries.get(c.id)!.production.output_kg)}</span> },
                { title: 'Wastage', align: 'right', render: (_, c) => <span className="num">{formatKg(summaries.get(c.id)!.production.wastage_kg)}</span> },
                { title: 'Purchase cost', align: 'right', render: (_, c) => <span className="num" style={{ fontWeight: 700 }}>{formatINRShort(summaries.get(c.id)!.purchases.amount)}</span> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  )
}
