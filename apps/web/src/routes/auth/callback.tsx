import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        void navigate({ to: '/' });
      } else if (event === 'SIGNED_OUT') {
        void navigate({ to: '/login' });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  return null;
}
