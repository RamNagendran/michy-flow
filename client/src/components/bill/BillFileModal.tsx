import { Empty, Modal, Skeleton } from 'antd'
import { useBillFile } from '../../hooks/queries/documents'

/** The original uploaded bill of an entry, for the Manager and Finance to compare against. */
export default function BillFileModal({ companyId, documentId, title, onClose }: { companyId: number; documentId: number; title: string; onClose: () => void }) {
  const { url, type, isLoading } = useBillFile(companyId, documentId)
  return (
    <Modal open title={title} footer={null} onCancel={onClose} width={900} styles={{ body: { height: '75vh', padding: 0 } }}>
      {isLoading ? (
        <div style={{ padding: 24 }}>
          <Skeleton active paragraph={{ rows: 12 }} />
        </div>
      ) : !url ? (
        <Empty style={{ paddingTop: 80 }} description="The bill could not be shown" />
      ) : type === 'application/pdf' ? (
        <iframe title={title} src={url} style={{ width: '100%', height: '100%', border: 0 }} />
      ) : (
        <div style={{ height: '100%', overflow: 'auto', background: '#e9ebef', padding: 16 }}>
          <img src={url} alt={title} style={{ width: '100%', display: 'block' }} />
        </div>
      )}
    </Modal>
  )
}
