import { useMemo, type ReactNode } from 'react'
import { App } from 'antd'
import { errorMessage } from '../services/apiError'
import { NotificationContext, type Notifier } from './notifier'

/** Wraps antd's notification/message so the whole app reports results the same way. Must sit inside antd <App>. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { notification, message } = App.useApp()
  const value = useMemo<Notifier>(
    () => ({
      success: (title, description) => notification.success({ title, description, placement: 'topRight' }),
      info: (title, description) => notification.info({ title, description, placement: 'topRight' }),
      warning: (title, description) => notification.warning({ title, description, placement: 'topRight', duration: 8 }),
      alert: (title, description) => notification.error({ title, description, placement: 'topRight', duration: 0 }),
      error: (error, title = 'Something went wrong') =>
        notification.error({ title, description: errorMessage(error), placement: 'topRight' }),
      message,
    }),
    [notification, message],
  )
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}
