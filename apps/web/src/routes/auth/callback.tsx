import { createFileRoute, redirect } from '@tanstack/react-router';
import { supabase } from '@/lib/supabase';

export const Route = createFileRoute('/auth/callback')({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw redirect({ to: '/login' });
    throw redirect({ to: '/' });
  },
  component: () => null,
});
