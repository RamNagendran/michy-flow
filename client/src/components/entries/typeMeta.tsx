import { ExperimentOutlined, ShopOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import type { EntryType } from '../../types/entries'

export const typeMeta: Record<EntryType, { label: string; fg: string; icon: React.ReactNode }> = {
  purchase: { label: 'Purchase', fg: '#2F6FEB', icon: <ShoppingCartOutlined /> },
  production: { label: 'Production', fg: '#3a3f47', icon: <ExperimentOutlined /> },
  sale: { label: 'Sale', fg: '#D82E54', icon: <ShopOutlined /> },
}
