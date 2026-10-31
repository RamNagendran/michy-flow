import { Tag } from 'antd'
import type { WastageStatus } from '../../types/reports'
import { statusMeta } from './wastageMeta'

export function WastageStatusTag({ status }: { status: WastageStatus }) {
  return <Tag color={statusMeta[status].color}>{statusMeta[status].label}</Tag>
}
