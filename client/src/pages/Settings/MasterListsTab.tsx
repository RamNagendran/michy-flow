import { useState } from 'react'
import { App, Button, Space, Table, Tag } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { HintButton, SectionTitle } from '../../components/ui'
import { OIL_DENSITY, processOf, WASTAGE_ALERT_PCT, type CatalogItem, type CatalogItemRow, type CompanyTypeRow } from '../../data/catalog'
import { useCatalog, useDeleteItem, useDeleteType } from '../../hooks/queries/catalog'
import { ItemModal, TypeModal } from './CatalogModals'

const Chip = ({ item }: { item: CatalogItem }) => (
  <span
    className="pill"
    style={{
      background: '#fff',
      border: '1px solid #e6e8ec',
      color: '#3a3f47',
      marginRight: 6,
      marginBottom: 4,
    }}
  >
    <span className="legend-dot" style={{ background: item.color }} />
    {item.name}
    {item.unit === 'L' && <b> · litres</b>}
    {!item.stocked && <span className="faint"> · not stocked</span>}
  </span>
)

const actions = (onEdit: () => void, onDelete: () => void, name: string) => (
  <Space size={0} style={{ whiteSpace: 'nowrap' }}>
    <Button type="text" icon={<EditOutlined />} onClick={onEdit} aria-label={`Edit ${name}`} />
    <Button type="text" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label={`Delete ${name}`} />
  </Space>
)

/** Super Admin: the company types (what each processes and makes) and every item. */
export function ProductsTab() {
  const catalog = useCatalog()
  const deleteItem = useDeleteItem()
  const deleteType = useDeleteType()
  const { modal } = App.useApp()
  const [item, setItem] = useState<CatalogItemRow | 'new' | null>(null)
  const [type, setType] = useState<CompanyTypeRow | 'new' | null>(null)

  const confirmDelete = (name: string, run: () => Promise<unknown>) =>
    modal.confirm({
      title: `Delete ${name}?`,
      content: 'This cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: run,
    })

  return (
    <div>
      <SectionTitle
        title="Company types"
        extra={
          <Space>
            <HintButton title="How company types and items work">
              <p>Each company gets one type when it is added (Settings → Companies). The type fills in what the company processes and makes. You can then change one company with Stock settings.</p>
              <p>Changing a type changes only companies added after that. Companies already added keep their own settings.</p>
              <p>
                Items measured in litres are changed to kg with the company's oil factor ({OIL_DENSITY.default} kg per litre by default) when production is weighed. Missing weight over{' '}
                {WASTAGE_ALERT_PCT}% is counted as wastage.
              </p>
              <p>Once an item is used in any entry, company or type, its kind, unit and stock setting are locked and it cannot be deleted. You can still rename it or change its colour.</p>
              <p>A type cannot be deleted while a company uses it.</p>
            </HintButton>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setType('new')}>
              Add company type
            </Button>
          </Space>
        }
      />
      <Table<CompanyTypeRow>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={catalog.isLoading}
        pagination={false}
        dataSource={catalog.data?.types}
        columns={[
          {
            title: 'Company type',
            render: (_, t) => (
              <div>
                <div style={{ fontWeight: 800 }}>{t.name}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {t.example}
                </div>
              </div>
            ),
          },
          {
            title: 'Processes (input)',
            render: (_, t) => processOf(t.key).inputs.map((i) => <Chip key={i.id} item={i} />),
          },
          {
            title: 'Makes (output)',
            render: (_, t) => processOf(t.key).outputs.map((o) => <Chip key={o.id} item={o} />),
          },
          {
            title: 'Companies',
            align: 'right',
            render: (_, t) => <span className="num">{t.companies}</span>,
          },
          {
            key: 'actions',
            align: 'right',
            render: (_, t) =>
              actions(
                () => setType(t),
                () => confirmDelete(t.name, () => deleteType.mutateAsync(t)),
                t.name,
              ),
          },
        ]}
      />

      <div style={{ height: 28 }} />
      <SectionTitle
        title="Items"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setItem('new')}>
            Add item
          </Button>
        }
      />
      <Table<CatalogItemRow>
        scroll={{ x: 'max-content' }}
        rowKey="id"
        loading={catalog.isLoading}
        pagination={false}
        dataSource={catalog.data?.items}
        columns={[
          {
            title: 'Item',
            render: (_, i) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="legend-dot" style={{ background: i.color }} />
                <span>
                  <div style={{ fontWeight: 700 }}>{i.name}</div>
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {i.description}
                  </div>
                </span>
              </span>
            ),
          },
          {
            title: 'Kind',
            render: (_, i) => (i.kind === 'material' ? <Tag color="blue">Raw material</Tag> : <Tag color="green">Product</Tag>),
          },
          {
            title: 'Measured in',
            render: (_, i) => (i.unit === 'L' ? 'litres' : 'kg'),
          },
          {
            title: 'Stock',
            render: (_, i) => (i.stocked ? 'Kept in stock' : <span className="faint">Not stocked</span>),
          },
          {
            key: 'actions',
            align: 'right',
            render: (_, i) =>
              actions(
                () => setItem(i),
                () => confirmDelete(i.name, () => deleteItem.mutateAsync(i)),
                i.name,
              ),
          },
        ]}
      />

      {item && <ItemModal key={item === 'new' ? 'new' : item.id} item={item === 'new' ? undefined : item} onClose={() => setItem(null)} />}
      {type && <TypeModal key={type === 'new' ? 'new' : type.id} row={type === 'new' ? undefined : type} onClose={() => setType(null)} />}
    </div>
  )
}
