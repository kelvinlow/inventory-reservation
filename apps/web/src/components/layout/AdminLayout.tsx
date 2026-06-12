import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { to: '/admin/inventory', label: 'Inventory', icon: '📦', end: false },
  { to: '/admin/products', label: 'Products', icon: '🏷️', end: false },
  { to: '/admin/reservations', label: 'Reservations', icon: '🔒', end: false },
  { to: '/admin/orders', label: 'Orders', icon: '✅', end: false },
  { to: '/admin/audit-log', label: 'Audit Log', icon: '📜', end: false },
];

export function AdminLayout() {
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-section">
          <div className="admin-sidebar-label">Management</div>
          <nav className="admin-sidebar-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `admin-nav-link ${isActive ? 'active' : ''}`
                }
              >
                <span className="admin-nav-link-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
