import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: 'categories', label: 'Categories' },
  { to: 'accounts', label: 'Accounts' },
  { to: 'recurring', label: 'Recurring' },
]

export default function SettingsLayout() {
  return (
    <>
      <h1>Settings</h1>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </>
  )
}
