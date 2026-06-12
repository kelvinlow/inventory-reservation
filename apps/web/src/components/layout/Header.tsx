import { Link, NavLink } from 'react-router-dom';

export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo">
          <div className="header-logo-icon">📦</div>
          <span className="header-logo-text">
            <span className="text-gradient">Everest</span>
          </span>
        </Link>

        <nav className="header-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `header-nav-link ${isActive ? 'active' : ''}`
            }
          >
            Products
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `header-nav-link ${isActive ? 'active' : ''}`
            }
          >
            Admin
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
