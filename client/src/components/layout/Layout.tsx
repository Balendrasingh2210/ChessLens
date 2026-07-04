import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Library, BarChart3, Target, PlugZap, LogOut,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import styles from './Layout.module.css';

const NAV = [
  { to: '/',         label: 'Dashboard',  Icon: LayoutDashboard },
  { to: '/games',    label: 'My Games',   Icon: Library         },
  { to: '/analysis', label: 'Analysis',   Icon: BarChart3       },
  { to: '/puzzles',  label: 'Puzzles',    Icon: Target          },
  { to: '/connect',  label: 'Connect',    Icon: PlugZap         },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const initial = user?.username?.[0]?.toUpperCase() ?? '?';

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoIcon}>♟</span>
          <span className={styles.logoText}>Chess<span className={styles.logoAccent}>Lens</span></span>
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.active : ''}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={styles.navAccent} />
                  <Icon size={17} strokeWidth={isActive ? 2.2 : 1.8} className={styles.navIcon} />
                  <span className={styles.navLabel}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className={styles.userSection}>
          <div className={styles.userAvatar}>{initial}</div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user?.username}</span>
            <span className={styles.userSub}>
              {user?.connectedAccounts?.length
                ? `${user.connectedAccounts.length} account${user.connectedAccounts.length > 1 ? 's' : ''} connected`
                : 'No accounts connected'}
            </span>
          </div>
          <button
            className={styles.logoutBtn}
            onClick={() => { logout(); navigate('/login'); }}
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
