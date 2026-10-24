import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import ChunkErrorBoundary from './components/ChunkErrorBoundary'
import MainLayout from './components/MainLayout'
import PageLoader from './components/PageLoader'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import SessionManager from './components/SessionManager'
import { useAccess } from './hooks/useAccess'
import { useAuth } from './hooks/useAuth'
import { isOperatorOnly } from './utils/navigation'
import { SCREEN_ACCESS } from './utils/permissions'

const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const NotFound = lazy(() => import('./pages/NotFound'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const OperatorHome = lazy(() => import('./pages/OperatorHome'))
const CeoWelcome = lazy(() => import('./pages/CeoWelcome'))
const PurchasesList = lazy(() => import('./pages/purchases/PurchasesList'))
const NewPurchase = lazy(() => import('./pages/purchases/NewPurchase'))
const ProductionList = lazy(() => import('./pages/production/ProductionList'))
const NewProduction = lazy(() => import('./pages/production/NewProduction'))
const StockOverview = lazy(() => import('./pages/stock/StockOverview'))
const CompanyDetail = lazy(() => import('./pages/companies/CompanyDetail'))
const SalesList = lazy(() => import('./pages/sales/SalesList'))
const NewSale = lazy(() => import('./pages/sales/NewSale'))
const Finance = lazy(() => import('./pages/Finance'))
const Records = lazy(() => import('./pages/Records'))
const Settings = lazy(() => import('./pages/Settings'))
const Review = lazy(() => import('./pages/Review'))
const Parties = lazy(() => import('./pages/Parties'))
const Reports = lazy(() => import('./pages/Reports'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Wastage = lazy(() => import('./pages/Wastage'))

function Home() {
  const { companies } = useAccess()
  return isOperatorOnly(companies) ? <OperatorHome /> : <Dashboard />
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
                  <Route path="purchases" element={<PurchasesList />} />
                  <Route path="purchases/new" element={<ProtectedRoute anyOf={['enter_purchase']}><NewPurchase /></ProtectedRoute>} />
                  <Route path="production" element={<ProductionList />} />
                  <Route path="production/new" element={<ProtectedRoute anyOf={['enter_production']}><NewProduction /></ProtectedRoute>} />
                  <Route path="stock" element={<StockOverview />} />
                  <Route path="companies/:id" element={<CompanyDetail />} />
                  <Route path="sales" element={<SalesList />} />
                  <Route path="sales/new" element={<ProtectedRoute anyOf={['enter_sales']}><NewSale /></ProtectedRoute>} />
                  <Route path="finance" element={<ProtectedRoute anyOf={SCREEN_ACCESS.finance}><Finance /></ProtectedRoute>} />
                  <Route path="reports" element={<ProtectedRoute anyOf={SCREEN_ACCESS.reports}><Reports /></ProtectedRoute>} />
                  <Route path="pricing" element={<ProtectedRoute anyOf={SCREEN_ACCESS.pricing}><Pricing /></ProtectedRoute>} />
                  <Route path="wastage" element={<ProtectedRoute anyOf={SCREEN_ACCESS.wastage}><Wastage /></ProtectedRoute>} />
                  <Route path="review" element={<Review />} />
                  <Route path="parties" element={<Parties />} />
                  <Route path="records" element={<ProtectedRoute anyOf={SCREEN_ACCESS.records}><Records /></ProtectedRoute>} />
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
