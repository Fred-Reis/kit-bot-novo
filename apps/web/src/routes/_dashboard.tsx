import {
  createFileRoute,
  Outlet,
  Link,
  useNavigate,
  useRouterState,
  useLocation,
} from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Building2,
  UserCheck,
  MessageSquare,
  ListChecks,
  LayoutTemplate,
  FileText,
  Coins,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Moon,
  Sun,
  Bell,
  Plus,
  Search,
  Menu,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { fetchLeads } from '@/lib/queries';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CustomButton } from '@/components/ui/btn';
import { twMerge } from 'tailwind-merge';

export const Route = createFileRoute('/_dashboard')({ component: DashboardLayout });

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: boolean;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/properties', label: 'Imóveis', icon: Building2 },
      { href: '/tenants', label: 'Inquilinos', icon: UserCheck },
      { href: '/leads', label: 'Leads', icon: MessageSquare, badge: true },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { href: '/rules', label: 'Regras', icon: ListChecks },
      { href: '/templates', label: 'Templates', icon: LayoutTemplate },
      { href: '/contracts', label: 'Contratos', icon: FileText },
      { href: '/finance', label: 'Financeiro', icon: Coins },
    ],
  },
  {
    label: 'Sistema',
    items: [{ href: '/config', label: 'Configurações', icon: Settings }],
  },
];

function usePageTitle() {
  const matches = useRouterState({ select: (s) => s.matches });
  const last = matches[matches.length - 1];
  const path = last?.pathname ?? '/';
  if (path === '/') return 'Dashboard';
  if (path.startsWith('/leads/')) return 'Lead';
  if (path.startsWith('/properties/new')) return 'Novo imóvel';
  if (path.startsWith('/properties/')) return 'Imóvel';
  if (path.startsWith('/tenants/new')) return 'Novo inquilino';
  if (path.startsWith('/tenants/')) return 'Inquilino';
  const segment = path.split('/')[1];
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function NavLink({
  item,
  collapsed,
  leadsCount,
}: {
  item: NavItem;
  collapsed: boolean;
  leadsCount: number;
}) {
  const location = useLocation();
  const isActive = item.exact
    ? location.pathname === item.href
    : location.pathname === item.href || location.pathname.startsWith(item.href + '/');

  return (
    <Link
      to={item.href as '/'}
      title={collapsed ? item.label : undefined}
      className={twMerge(
        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted hover:text-foreground',
        isActive
          ? 'bg-accent-soft text-accent-ink font-medium'
          : 'text-muted-foreground',
        collapsed && 'justify-center',
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <item.icon className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && leadsCount > 0 && <Badge count={leadsCount} />}
        </>
      )}
    </Link>
  );
}

interface SidebarContentProps {
  collapsed: boolean;
  leadsCount: number;
  userName: string;
  userEmail: string | undefined;
  onLogout: () => void;
}

function SidebarContent({ collapsed, leadsCount, userName, userEmail, onLogout }: SidebarContentProps) {
  return (
    <>
      {/* Logo block */}
      <div
        className={twMerge(
          'flex h-16 shrink-0 items-center gap-3 px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-xs font-bold text-surface-raised">
          KM
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">kit-manager</p>
            <p className="text-xs text-muted-foreground">Proprietário</p>
          </div>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  leadsCount={leadsCount}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-border px-2 py-3">
        <div
          className={twMerge(
            'mb-1 flex items-center gap-2.5 px-3 py-1',
            collapsed && 'justify-center px-2',
          )}
        >
          <Avatar name={userName} size="sm" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{userName}</p>
              <p className="truncate text-[10px] text-muted-foreground">{userEmail}</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onLogout}
          title={collapsed ? 'Sair' : undefined}
          aria-label="Sair"
          className={twMerge(
            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            collapsed && 'justify-center',
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && 'Sair'}
        </button>
      </div>
    </>
  );
}

function DashboardLayout() {
  const user = useAuthStore((s) => s.user);
  const { sidebarCollapsed, setSidebarCollapsed, darkMode, setDarkMode } = useUiStore();
  const navigate = useNavigate();
  const pageTitle = usePageTitle();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const quickCreateRef = useRef<HTMLDivElement>(null);

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    refetchInterval: 5000,
  });
  const leadsCount = leads.filter((l) => l.stage !== 'converted').length;

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (quickCreateRef.current && !quickCreateRef.current.contains(e.target as Node)) {
        setQuickCreateOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: '/login' });
  }

  const sidebarWidth = sidebarCollapsed ? '64px' : '248px';
  const userName = user?.email?.split('@')[0] ?? 'Proprietário';

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Desktop sidebar */}
      <aside
        className="relative hidden flex-col border-r border-border bg-surface-raised transition-[width] duration-200 lg:flex"
        style={{ width: sidebarWidth }}
      >
        <SidebarContent
          collapsed={sidebarCollapsed}
          leadsCount={leadsCount}
          userName={userName}
          userEmail={user?.email}
          onLogout={handleLogout}
        />

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
          className="absolute -right-[11px] top-[18px] z-30 flex size-[22px] items-center justify-center rounded-full border border-border bg-surface-raised text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronLeft className="size-3" />
          )}
        </button>
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-border bg-surface-raised lg:hidden">
            <SidebarContent
          collapsed={sidebarCollapsed}
          leadsCount={leadsCount}
          userName={userName}
          userEmail={user?.email}
          onLogout={handleLogout}
        />
          </aside>
        </>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header
          className="sticky top-0 z-20 flex h-[60px] shrink-0 items-center gap-3 border-b border-border px-4"
          style={{
            backgroundColor: 'color-mix(in oklch, var(--color-surface) 85%, transparent)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <CustomButton
            variant="icon"
            size="sm"
            className="lg:hidden"
            aria-label="Abrir menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-4" />
          </CustomButton>

          <span className="text-sm font-semibold text-foreground lg:hidden">{pageTitle}</span>

          {/* Search — desktop only */}
          <div className="hidden flex-1 lg:flex">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Buscar..."
                className="h-8 w-full rounded-lg border border-border bg-muted pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <CustomButton
              variant="icon"
              size="sm"
              aria-label={darkMode ? 'Modo claro' : 'Modo escuro'}
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </CustomButton>

            <CustomButton variant="icon" size="sm" aria-label="Notificações">
              <Bell className="size-4" />
            </CustomButton>

            {/* Quick-create dropdown */}
            <div ref={quickCreateRef} className="relative">
              <CustomButton
                variant="primary"
                size="sm"
                onClick={() => setQuickCreateOpen((o) => !o)}
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Novo</span>
              </CustomButton>

              {quickCreateOpen && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface-raised py-1"
                  style={{ boxShadow: 'var(--shadow-md)' }}
                >
                  <Link
                    to="/properties/new"
                    onClick={() => setQuickCreateOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <Building2 className="size-4 text-muted-foreground" />
                    Novo imóvel
                  </Link>
                  <Link
                    to="/tenants/new"
                    onClick={() => setQuickCreateOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <UserCheck className="size-4 text-muted-foreground" />
                    Novo inquilino
                  </Link>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
