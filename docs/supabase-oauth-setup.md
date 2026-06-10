# Configurar Google OAuth no Supabase

## Pré-requisitos

- Conta Google Cloud com projeto criado
- Acesso ao Supabase Console do projeto

## Passos

### 1. Google Cloud Console

1. Acesse https://console.cloud.google.com e selecione seu projeto
2. Vá em **APIs & Services → Credentials**
3. Clique em **Create Credentials → OAuth 2.0 Client ID**
4. Tipo: **Web application**
5. Em **Authorized redirect URIs**, adicione:
   - `https://<seu-projeto>.supabase.co/auth/v1/callback`
6. Copie o **Client ID** e **Client Secret**

### 2. Supabase Console

1. Acesse https://supabase.com/dashboard e abra o projeto
2. Vá em **Authentication → Providers**
3. Habilite **Google**
4. Cole o **Client ID** e **Client Secret** obtidos acima
5. Salve

### 3. Redirect URLs permitidas

No Supabase Console, em **Authentication → URL Configuration**:

- **Site URL**: URL de produção (ex: `https://kit-manager.vercel.app`)
- **Redirect URLs**: adicionar cada ambiente:
  - `http://localhost:5173`
  - `https://kit-manager.vercel.app`

## Verificar

Com as configurações acima, o botão "Entrar com Google" em `/login` deve abrir
o fluxo OAuth do Google e redirecionar de volta ao painel após autenticação.
