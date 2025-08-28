## Auth Frontend Spec

### Endpoints (tRPC)
- **auth.signup**: `{ name: string; email: string; password: string }` → `{ id: string; email: string; name: string }`
- **auth.login**: `{ email: string; password: string }` → `{ id: string; email: string; name: string; image?: string | null; token: string }` (also sets `auth_token` cookie)
- **auth.getSession**: `void` → `{ user: { id: string; email: string; name: string; image?: string | null } }`
- **auth.logout**: `void` → `{ success: true }` (clears `auth_token` cookie)

### Cookie & Token
- On login, server sets `auth_token` cookie (HTTP-only). Value is HMAC of base64 user id with `AUTH_SECRET`.
- Cookie attributes:
  - `httpOnly: true`
  - `secure: true` in production
  - `sameSite: 'none'` in production, `'lax'` in dev
  - `domain: 'server-w8mz.onrender.com'` in production
  - `maxAge: 30 days`

### UX Notes
- After `auth.login`, rely on cookie for session; also keep returned `token` if needed for client-side display.
- Call `auth.getSession` on app bootstrap; if it throws, redirect to login.
- On `auth.logout`, clear local user state immediately (optimistic) and navigate to login.
