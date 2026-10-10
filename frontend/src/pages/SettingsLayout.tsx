import { Repeat, SlidersHorizontal, Tags, Wallet } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Tooltip } from 'react-tooltip'

const TABS = [
  { to: 'categories', label: 'Categories', icon: Tags },
  { to: 'accounts', label: 'Accounts', icon: Wallet },
  { to: 'recurring', label: 'Recurring', icon: Repeat },
  { to: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
]

export default function SettingsLayout() {
  return (
    <>
      <h1>Settings</h1>
      <div className="tabs" role="tablist">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `tab with-icon${isActive ? ' active' : ''}`}>
            <Icon size={15} /> {label}
          </NavLink>
        ))}
      </div>
      <Outlet />
      <Tooltip id="settings-tip" />
    </>
  )
}
