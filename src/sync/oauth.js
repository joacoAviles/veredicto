// OAuth con tu propio cliente (Google Cloud o Azure). Nada pasa por servidores de terceros.
const PROV = {
  google: {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/calendar",
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  outlook: {
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access Calendars.ReadWrite User.Read",
    extra: { response_mode: "query", prompt: "select_account" },
  },
};

// URL de retorno OAuth del proveedor.
export const redirectUri = (publicUrl, tipo) => `${publicUrl.replace(/\/$/, "")}/oauth/${tipo}`;

// URL para autorizar en Google u Outlook.
export function authUrl(tipo, { client_id, redirect, state }) {
  const p = PROV[tipo];
  const u = new URL(p.auth);
  for (const [k, v] of Object.entries({ client_id, redirect_uri: redirect, response_type: "code", scope: p.scope, state, ...p.extra })) u.searchParams.set(k, v);
  return u.href;
}

// Llamada al endpoint de tokens del proveedor.
async function tokenCall(tipo, params, fetcher) {
  const r = await fetcher(PROV[tipo].token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const fatal = j.error === "invalid_grant" || j.error === "invalid_client" || j.error === "unauthorized_client";
    throw Object.assign(new Error(fatal ? "Se perdió el permiso: vuelve a conectar esta cuenta." : `Error al pedir el token: ${j.error_description || j.error || r.status}`), { fatal });
  }
  return j;
}

// Cambia el código OAuth por tokens.
export async function exchange(tipo, { client_id, client_secret, code, redirect }, fetcher = fetch) {
  const j = await tokenCall(tipo, { client_id, client_secret, code, redirect_uri: redirect, grant_type: "authorization_code" }, fetcher);
  if (!j.refresh_token) throw new Error("El proveedor no entregó permiso permanente. Quita el acceso de la app en tu cuenta y conecta de nuevo.");
  return { refresh_token: j.refresh_token, access_token: j.access_token, expira: Date.now() + (j.expires_in - 60) * 1000 };
}

// Devuelve un token válido; si el proveedor rota el refresh_token (Microsoft), avisa para guardarlo.
export async function accessToken(tipo, cfg, { fetcher = fetch, onConfig } = {}) {
  if (cfg.access_token && cfg.expira > Date.now()) return cfg.access_token;
  const j = await tokenCall(tipo, { client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: "refresh_token" }, fetcher);
  cfg.access_token = j.access_token;
  cfg.expira = Date.now() + (j.expires_in - 60) * 1000;
  if (j.refresh_token) cfg.refresh_token = j.refresh_token;
  if (onConfig) await onConfig(cfg);
  return cfg.access_token;
}

// Llamada autenticada (renueva el token si venció).
export async function api(tipo, cfg, method, url, { body, headers = {}, fetcher = fetch, onConfig } = {}) {
  const tok = await accessToken(tipo, cfg, { fetcher, onConfig });
  const r = await fetcher(url, {
    method,
    headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 412) throw Object.assign(new Error("Cambió afuera mientras tanto."), { conflicto: true });
  if (r.status === 404 || r.status === 410) throw Object.assign(new Error("Ya no existe."), { borrado: true, status: r.status });
  if (r.status === 401) { cfg.expira = 0; throw Object.assign(new Error("El proveedor rechazó el acceso; se reintenta."), { status: 401 }); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `El proveedor respondió ${r.status}`), { status: r.status });
  return j;
}
