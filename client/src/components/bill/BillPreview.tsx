import { useState } from 'react'
import { Button, Empty, Skeleton } from 'antd'
import { FilePdfFilled, PictureOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import { useBillFile } from '../../hooks/queries/documents'
import type { BillDocument } from '../../types/documents'

const methodLabel: Record<BillDocument['method'], string> = {
  pdf_text: 'Text read from the PDF',
  ocr: 'Text read from the picture (OCR)',
  none: 'No text could be read',
}

/** The uploaded bill itself, next to what was read from it. */
export default function BillPreview({ doc, height = 'calc(100vh - 190px)' }: { doc: BillDocument; height?: string }) {
  const { url, isLoading } = useBillFile(doc.company_id, doc.id)
  const [zoom, setZoom] = useState(1)
  const isPdf = doc.content_type === 'application/pdf'

  return (
    <div className="surface" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #eceef2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {isPdf ? <FilePdfFilled style={{ color: '#D82E54', fontSize: 20 }} /> : <PictureOutlined style={{ color: '#2F6FEB', fontSize: 20 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {doc.pages} page{doc.pages > 1 ? 's' : ''} · {methodLabel[doc.method]}
              {doc.parsed.einvoice && ' · e-invoice QR found'}
            </div>
          </div>
        </div>
        {!isPdf && (
          <div style={{ display: 'flex', gap: 4 }}>
            <Button type="text" icon={<ZoomOutOutlined />} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out" />
            <Button type="text" icon={<ZoomInOutlined />} onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in" />
          </div>
        )}
      </div>
      <div style={{ background: '#e9ebef', height, overflow: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: 24 }}>
            <Skeleton active paragraph={{ rows: 10 }} />
          </div>
        ) : !url ? (
          <Empty style={{ paddingTop: 80 }} description="The bill could not be shown" />
        ) : isPdf ? (
          // A blob: URL of our own; the browser's PDF viewer shows it with its own zoom and pages.
          <iframe title={doc.filename} src={url} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
        ) : (
          <div style={{ padding: 16 }}>
            <img src={url} alt={doc.filename} style={{ width: `${zoom * 100}%`, display: 'block', margin: '0 auto', boxShadow: '0 4px 16px rgba(16,24,40,0.12)' }} />
          </div>
        )}
      </div>
    </div>
  )
}
