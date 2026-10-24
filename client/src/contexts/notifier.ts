import { createContext } from 'react'
import type { MessageInstance } from 'antd/es/message/interface'

export interface Notifier {
  success: (title: string, description?: string) => void
  error: (error: unknown, title?: string) => void
  info: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  /** A high alert that stays on screen until it is closed. */
  alert: (title: string, description?: string) => void
  message: MessageInstance
}

export const NotificationContext = createContext<Notifier | null>(null)
