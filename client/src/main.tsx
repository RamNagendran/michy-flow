import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import enGB from 'antd/locale/en_GB'
import dayjs from 'dayjs'
import 'dayjs/locale/en-gb'
import './styles/global.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import PageLoader from './components/PageLoader'
import { NotificationProvider } from './contexts/NotificationContext'
import { queryClient } from './lib/queryClient'
import { persistor, store } from './statemanager/store'
import { theme } from './styles/theme'

dayjs.locale('en-gb')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Every modal opens in the middle of the screen and never runs off it: long ones scroll inside. */}
    <ConfigProvider theme={theme} locale={enGB} modal={{ centered: true, styles: { body: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } } }}>
      <AntApp>
        <ErrorBoundary>
          <Provider store={store}>
            <PersistGate loading={<PageLoader fullscreen />} persistor={persistor}>
              <QueryClientProvider client={queryClient}>
                <NotificationProvider>
                  <App />
                </NotificationProvider>
              </QueryClientProvider>
            </PersistGate>
          </Provider>
        </ErrorBoundary>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
