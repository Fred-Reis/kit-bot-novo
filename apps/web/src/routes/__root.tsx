import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ location }) => {
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

function RootComponent() {
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [setSession]);

  return <Outlet />;
}
