import { Suspense, lazy } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import AccountsTab from './pages/AccountsTab'
import AddPage from './pages/AddPage'
import CashflowPage from './pages/CashflowPage'
import BudgetPage from './pages/BudgetPage'
import CategoriesTab from './pages/CategoriesTab'
import ImportPage from './pages/ImportPage'
import RecurringTab from './pages/RecurringTab'
import SettingsLayout from './pages/SettingsLayout'
import TransactionEditPage from './pages/TransactionEditPage'
import TransactionsPage from './pages/TransactionsPage'

// Recharts is heavy; load it only when the report is opened.
const ReportsPage = lazy(() => import('./pages/ReportsPage'))

const LINKS = [
  { to: '/', label: 'Add', end: true },
  { to: '/transactions', label: 'Transactions' },
  { to: '/import', label: 'Import' },
  { to: '/budget', label: 'Budget' },
  { to: '/reports', label: 'Report' },
  { to: '/cashflow', label: 'Cash flow' },
  { to: '/settings', label: 'Settings' },
]

function Layout() {
  return (
    <>
      <nav>
        <div className="inner">
          <span className="brand">Monthly Budget</span>
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `link${isActive ? ' active' : ''}`}>
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AddPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="transactions/:id" element={<TransactionEditPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="budget" element={<BudgetPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="cashflow" element={<CashflowPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="categories" replace />} />
          <Route path="categories" element={<CategoriesTab />} />
          <Route path="accounts" element={<AccountsTab />} />
          <Route path="recurring" element={<RecurringTab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
