import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export const Route = createFileRoute('/_auth/login')({ component: LoginPage });

function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleMagicLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSent(true);
    setLoading(false);
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-surface-raised p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-foreground">kit-manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">Painel do proprietário</p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Entrar com Google
        </button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {sent ? (
          <p className="text-center text-sm text-foreground">
            Link enviado para <strong>{email}</strong>. Verifique seu e-mail.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg border border-primary bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
