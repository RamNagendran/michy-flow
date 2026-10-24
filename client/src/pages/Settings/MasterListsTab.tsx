import { Table, Tag } from 'antd'
import { PROCESSES, type CatalogItem } from '../../data/catalog'
import { seriesColors } from '../../styles/theme'

const Chip = ({ item }: { item: CatalogItem<string> }) => (
  <span className="pill" style={{ background: '#fff', border: '1px solid #e6e8ec', color: '#3a3f47', marginRight: 6, marginBottom: 4 }}>
    <span className="legend-dot" style={{ background: seriesColors[item.id as keyof typeof seriesColors] ?? '#8a919e' }} />
    {item.name}
    {item.unit === 'L' && <b> · litres</b>}
    {!item.stocked && <span className="faint"> · not stocked</span>}
  </span>
)

/** The three company types: what each processes and what it makes. Chosen per company. */
export function ProductsTab() {
  return (
    <div>
      <Tag color="default" style={{ marginBottom: 12 }}>
        Fixed for now. Each company is given one type when it is created (Settings → Companies).
      </Tag>
      <Table
        scroll={{ x: 'max-content' }}
        rowKey="id"
        pagination={false}
        dataSource={PROCESSES}
        columns={[
          {
            title: 'Company type',
            render: (_, p) => (
              <div>
                <div style={{ fontWeight: 800 }}>{p.name}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {p.example}
                </div>
              </div>
            ),
          },
          { title: 'Processes (input)', render: (_, p) => p.inputs.map((i) => <Chip key={i.id} item={i} />) },
          { title: 'Makes (output)', render: (_, p) => p.outputs.map((o) => <Chip key={o.id} item={o} />) },
        ]}
      />
      <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Every type can also put unprocessed material back into stock. Oil is measured in litres and counted at 0.92 kg per litre when production is balanced by weight; missing weight over 2% is flagged as waste.
      </div>
    </div>
  )
}
