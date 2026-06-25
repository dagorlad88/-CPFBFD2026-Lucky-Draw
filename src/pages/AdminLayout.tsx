import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import { LayoutDashboard, Users, Gift, Dices, FileText, PlayCircle, LogOut } from 'lucide-react';

export function AdminLayout() {
  const navigate = useNavigate();
  const { logout, isMock } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
    { name: 'Participant Upload', path: '/admin/upload', icon: Users },
    { name: 'Prize Setup', path: '/admin/prizes', icon: Gift },
    { name: 'Bulk & Redraw', path: '/admin/bulk', icon: Dices },
    { name: 'Audit Logs', path: '/admin/audit', icon: FileText },
  ];

  return (
    <div className="bg-background text-on-surface font-sans min-h-screen flex">
      {/* SideNavBar */}
      <nav className="fixed left-0 top-0 h-screen w-64 border-r border-outline-variant/20 shadow-2xl bg-surface-container-highest flex flex-col py-6 px-4 space-y-8 z-50">
        <div className="flex flex-col items-center">
          <h1 className="text-primary-container font-display font-black text-lg tracking-tight text-center uppercase text-glow-sm">#CPFBFamilyDay2026</h1>
          <p className="text-sm text-on-surface-variant font-display font-medium uppercase tracking-widest mt-1 text-center">Lucky Draw Admin</p>
        </div>

        <div className="flex-1 flex flex-col space-y-2 w-full">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg font-display text-sm font-medium transition-all duration-300 active:scale-95",
                    isActive 
                      ? "bg-primary-container/10 text-primary-container border-r-4 border-primary-container shadow-[0_0_15px_rgba(255,225,53,0.2)]"
                      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-lowest/50"
                  )
                }
              >
                <Icon className="w-5 h-5" />
                {item.name}
              </NavLink>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col space-y-4 w-full">
          <button 
            onClick={() => window.open('/stage', '_blank')}
            className="w-full py-3 px-4 bg-primary-container text-on-primary-container font-mono text-sm uppercase tracking-wider font-bold rounded-[24px] outer-glow-yellow transition-all duration-300 flex items-center justify-center gap-2"
          >
            <PlayCircle className="w-5 h-5" />
            Live Draw
          </button>

          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-all duration-300 font-display text-sm font-medium"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 ml-64 flex flex-col">
        {/* TopAppBar */}
        <header className="sticky top-0 h-16 flex items-center justify-between px-8 z-40 bg-surface-container-highest/80 backdrop-blur-xl border-b border-outline-variant/20 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
          <div className="text-primary-container font-black text-xl uppercase tracking-widest font-display text-glow-sm">
            LUCKY DRAW ADMIN
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-mono text-on-surface-variant">Local Storage</span>
            <div className="w-2 h-2 rounded-full bg-[#10B981]"></div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-8 relative overflow-x-hidden">
             {/* Background glow effects */}
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary-container/5 blur-[120px]"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-secondary-container/10 blur-[100px]"></div>
            </div>
            <div className="relative z-10 max-w-7xl mx-auto">
                <Outlet />
            </div>
        </main>
      </div>
    </div>
  );
}
