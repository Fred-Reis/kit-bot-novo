import { createFileRoute, Outlet, Link, useNavigate } from '@tanstack/react-router';
import { LayoutDashboard, Users, Building2, UserCheck, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { twMerge } from 'tailwind-merge';

export const Route = createFileRoute('/_dashboard')({ component: DashboardLayout });

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/properties', label: 'Imóveis', icon: Building2 },
  { to: '/tenants', label: 'Inquilinos', icon: UserCheck },
] as const;

function DashboardLayout() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: '/login' });
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="flex w-56 flex-col border-r border-border bg-surface-raised">
        <div className="px-4 py-5">
          <span className="text-sm font-semibold text-foreground">kit-manager</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={twMerge(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                '[&.active]:bg-muted [&.active]:text-foreground [&.active]:font-medium',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border px-2 py-3">
          <div className="mb-1 px-3 py-1">
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sair"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
