import { useContext } from 'react'
import { NotificationContext } from '../contexts/notifier'

export function useNotify() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotify must be used inside NotificationProvider')
  return ctx
}
