import { useState } from 'react'
import { Button, Input, Timeline } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { itemName } from '../../data/catalog'
import { useCommentOnEntry } from '../../hooks/queries/entries'
import type { EntryDetail, EntryEvent } from '../../types/entries'

const eventMeta: Record<string, { label: string; color: string }> = {
  created: { label: 'entered it', color: '#2F6FEB' },
  approved: { label: 'approved it (Manager)', color: '#1f9d6b' },
  verified: { label: 'gave the final approval (Finance)', color: '#137a52' },
  escalated: { label: 'escalated it', color: '#D4380D' },
  change_requested: { label: 'asked the Super Admin to change it', color: '#D4380D' },
  rejected: { label: 'rejected it (Super Admin)', color: '#8a919e' },
  edited: { label: 'changed it (Super Admin)', color: '#7A5AF8' },
  commented: { label: 'commented', color: '#d98a0b' },
  gstin_corrected: { label: 'corrected a GST number read from the bill', color: '#D4380D' },
  debit_note: { label: 'added a debit note', color: '#D98A0B' },
  debit_note_adjusted: { label: 'marked a debit note as settled', color: '#1f9d6b' },
  debit_note_reopened: { label: 'debit note is open again', color: '#D98A0B' },
  // Older entries only.
  held: { label: 'put it on hold', color: '#D4380D' },
  deleted: { label: 'deleted it', color: '#8a919e' },
  resolved: { label: 'closed the escalation', color: '#1f9d6b' },
}

const fieldLabel: Record<string, string> = {
  qty: 'Quantity',
  qty_kg: 'Quantity (kg)',
  returned_kg: 'Returned to stock (kg)',
  crew_ids: 'Crew',
  running_hours: 'Running hours',
  input_kg: 'Input (kg)',
  rate: 'Rate',
  amount: 'Amount',
  invoice_no: 'Bill no.',
  entry_date: 'Date',
  material: 'Tyre type',
  product: 'Product',
  supplier_id: 'Supplier',
  buyer_id: 'Buyer',
  notes: 'Notes',
  shift: 'Shift',
  outputs: 'Outputs',
  output_kg: 'Output (kg)',
  wastage_kg: 'Missing (kg)',
  wastage_pct: 'Wastage %',
}

const show = (v: unknown): string =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'object'
      ? Object.entries(v as Record<string, unknown>)
          .map(([k, x]) => `${itemName(k)} ${x}`)
          .join(', ')
      : String(v)

function Changes({ changes }: { changes: EntryEvent['changes'] }) {
  if (!changes) return null
  return (
    <div style={{ background: '#f7f8fa', borderRadius: 8, padding: '6px 10px', marginTop: 6, fontSize: 12.5 }}>
      {Object.entries(changes).map(([field, pair]) => {
        const [before, after] = pair as [unknown, unknown]
        return (
          <div key={field}>
            <b>{fieldLabel[field] ?? field}:</b> <s className="faint">{show(before)}</s> → {show(after)}
          </div>
        )
      })}
    </div>
  )
}

/** What happened to the entry, oldest first, with a box to add a comment. */
export default function EntryTimeline({ entry }: { entry: EntryDetail }) {
  const [text, setText] = useState('')
  const comment = useCommentOnEntry()
  const canComment = entry.actions.includes('comment')

  return (
    <div>
      <Timeline
        items={entry.events.map((e) => ({
          color: eventMeta[e.action]?.color ?? '#8a919e',
          content: (
            <div>
              <div style={{ fontSize: 13.5 }}>
                <b>{e.actor_name ?? 'Someone'}</b> {eventMeta[e.action]?.label ?? e.action}
                <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                  {dayjs(e.created_at).format('DD MMM, HH:mm')}
                </span>
              </div>
              {e.comment && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: '#3a3f47' }}>“{e.comment}”</div>}
              <Changes changes={e.changes} />
            </div>
          ),
        }))}
      />
      {canComment && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask a question or explain a mismatch…"
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={2000}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={comment.isPending}
            disabled={!text.trim()}
            onClick={() => comment.mutate({ entry, comment: text.trim() }, { onSuccess: () => setText('') })}
            aria-label="Send comment"
          />
        </div>
      )}
    </div>
  )
}
