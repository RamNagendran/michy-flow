import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import ChunkErrorBoundary from './components/ChunkErrorBoundary'
import MainLayout from './components/MainLayout'
import PageLoader from './components/PageLoader'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import SessionManager from './components/SessionManager'
import { useAccess } from './hooks/useAccess'
import { useAuth } from './hooks/useAuth'
import { SCREEN_ACCESS } from './utils/permissions'

const pageLoaders: (() => Promise<unknown>)[] = []

/** A lazily loaded page whose code can also be fetched ahead of time (see PreloadPages). */
function page(load: () => Promise<{ default: ComponentType }>) {
  pageLoaders.push(load)
  return lazy(load)
}

const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const NotFound = page(() => import('./pages/NotFound'))
const ChangePassword = page(() => import('./pages/ChangePassword'))
const Dashboard = page(() => import('./pages/Dashboard'))
const OperatorHome = page(() => import('./pages/OperatorHome'))
const CeoWelcome = page(() => import('./pages/CeoWelcome'))
const PurchasesList = page(() => import('./pages/purchases/PurchasesList'))
const NewPurchase = page(() => import('./pages/purchases/NewPurchase'))
const ProductionList = page(() => import('./pages/production/ProductionList'))
const NewProduction = page(() => import('./pages/production/NewProduction'))
const StockOverview = page(() => import('./pages/stock/StockOverview'))
const CompanyDetail = page(() => import('./pages/companies/CompanyDetail'))
const SalesList = page(() => import('./pages/sales/SalesList'))
const NewSale = page(() => import('./pages/sales/NewSale'))
const Finance = page(() => import('./pages/Finance'))
const Records = page(() => import('./pages/Records'))
const Settings = page(() => import('./pages/Settings'))
const Review = page(() => import('./pages/Review'))
const Parties = page(() => import('./pages/Parties'))
const Reports = page(() => import('./pages/Reports'))
const Pricing = page(() => import('./pages/Pricing'))
const Wastage = page(() => import('./pages/Wastage'))

/**
 * Once signed in, fetches every page's code while the browser is idle, so opening a screen
 * never waits for its download. Pages the person cannot open are only downloaded, never shown.
 */
function PreloadPages() {
  const { isAuthenticated } = useAuth()
  useEffect(() => {
    if (!isAuthenticated) return
    const run = () => pageLoaders.forEach((load) => void load().catch(() => {}))
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(run, { timeout: 5000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(run, 2000)
    return () => clearTimeout(id)
  }, [isAuthenticated])
  return null
}

/** Company dashboard for people who see all entries; otherwise the task list for their duties. */
function Home() {
  const { canAnywhere } = useAccess()
  return canAnywhere(...SCREEN_ACCESS.dashboard) ? <Dashboard /> : <OperatorHome />
}

/** Route guard for one screen in SCREEN_ACCESS. */
function Screen({ name, children }: { name: keyof typeof SCREEN_ACCESS; children: ReactNode }) {
  return <ProtectedRoute anyOf={SCREEN_ACCESS[name]}>{children}</ProtectedRoute>
}

/** Signed in, but a temporary password is allowed (the change-password screen itself). */
function SignedIn({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionManager />
      <PreloadPages />
      <ChunkErrorBoundary>
        <Suspense fallback={<PageLoader fullscreen />}>
          <Routes>
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
            </Route>

            <Route path="/change-password" element={<SignedIn><ChangePassword /></SignedIn>} />
            {/* Company picker for anyone who can see several companies. Outside the main layout, so no side menu. */}
            <Route path="/welcome" element={<ProtectedRoute><CeoWelcome /></ProtectedRoute>} />

            <Route element={<ProtectedRoute />}>
              <Route element={<MainLayout />}>
                {/* Inner Suspense keeps the sidebar and header on screen while a page loads. */}
                <Route element={<Suspense fallback={<PageLoader />}><Outlet /></Suspense>}>
                  <Route index element={<Home />} />
                  <Route path="purchases" element={<Screen name="purchases"><PurchasesList /></Screen>} />
                  <Route path="purchases/new" element={<ProtectedRoute anyOf={['enter_purchase']}><NewPurchase /></ProtectedRoute>} />
                  <Route path="production" element={<Screen name="production"><ProductionList /></Screen>} />
                  <Route path="production/new" element={<ProtectedRoute anyOf={['enter_production']}><NewProduction /></ProtectedRoute>} />
                  <Route path="stock" element={<Screen name="stock"><StockOverview /></Screen>} />
                  <Route path="companies/:id" element={<Screen name="stock"><CompanyDetail /></Screen>} />
                  <Route path="sales" element={<Screen name="sales"><SalesList /></Screen>} />
                  <Route path="sales/new" element={<ProtectedRoute anyOf={['enter_sales']}><NewSale /></ProtectedRoute>} />
                  <Route path="finance" element={<Screen name="finance"><Finance /></Screen>} />
                  <Route path="reports" element={<Screen name="reports"><Reports /></Screen>} />
                  <Route path="pricing" element={<Screen name="pricing"><Pricing /></Screen>} />
                  <Route path="wastage" element={<Screen name="wastage"><Wastage /></Screen>} />
                  <Route path="review" element={<Screen name="review"><Review /></Screen>} />
                  <Route path="parties" element={<Screen name="parties"><Parties /></Screen>} />
                  <Route path="records" element={<Screen name="records"><Records /></Screen>} />
                  <Route path="settings" element={<ProtectedRoute system="manage_users"><Settings /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </ChunkErrorBoundary>
    </BrowserRouter>
  )
}
