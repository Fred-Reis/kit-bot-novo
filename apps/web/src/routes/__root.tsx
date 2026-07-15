import * as Sentry from '@sentry/react';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
    if (location.pathname === '/auth/callback') return;
    const { data } = await supabase.auth.getSession();
    const isAuthRoute = location.pathname.startsWith('/login');

    if (!data.session && !isAuthRoute) {
      throw redirect({ to: '/login' });
    }
    if (data.session && isAuthRoute) {
      throw redirect({ to: '/' });
    }
  },
  component: RootComponent,
});

function ErrorFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-[var(--color-foreground)]">
      <p className="text-sm text-[var(--color-muted-foreground)]">Algo deu errado.</p>
      <button
        onClick={() => window.location.reload()}
        className="rounded-[7px] bg-[var(--color-primary)] px-4 py-2 text-sm text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary-hover)]"
      >
        Recarregar
      </button>
    </div>
  );
}

function RootComponent() {
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) Sentry.setUser({ id: data.session.user.id, email: data.session.user.email ?? undefined });
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      Sentry.setUser(session ? { id: session.user.id, email: session.user.email ?? undefined } : null);
    });
    return () => listener.subscription.unsubscribe();
  }, [setSession]);

  return (
    <>
      <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
        <Outlet />
      </Sentry.ErrorBoundary>
      <Toaster position="bottom-right" richColors />
    </>
  );
}
