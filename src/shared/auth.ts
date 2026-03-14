import { IWebhookFunctions, IWebhookResponseData, INodeProperties } from 'n8n-workflow';
import { Response, Request } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Default custom login page
// Rules for a custom login page:
//   • <form method="POST" action="">
//   • <input name="username"> + <input type="password" name="password">
//   • <input type="hidden" name="_webstatic_login" value="1">
//   • Place {{ERROR}} to show the error message on failed login
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #0f0f13; color: #e2e8f0; }
    .card { background: #1a1a24; border: 1px solid #2d2d3d; border-radius: 12px;
            padding: 2rem; width: 100%; max-width: 360px; }
    h2 { margin: 0 0 1.5rem; font-size: 1.25rem; text-align: center; }
    label { display: block; margin-bottom: .35rem; font-size: .875rem; color: #94a3b8; }
    input { width: 100%; padding: .6rem .75rem; background: #0f0f13; border: 1px solid #2d2d3d;
            border-radius: 8px; color: #e2e8f0; font-size: 1rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #ff6d5a; }
    button { width: 100%; padding: .7rem; background: #ff6d5a; color: #fff; border: none;
             border-radius: 8px; font-size: 1rem; cursor: pointer; font-weight: 600; }
    button:hover { background: #ff8573; }
    .error { color: #f87171; font-size: .875rem; margin-bottom: 1rem; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Login</h2>
    {{ERROR}}
    <form method="POST" action="">
      <input type="hidden" name="_webstatic_login" value="1">
      <label for="u">Username</label>
      <input type="text" id="u" name="username" autocomplete="username" required autofocus>
      <label for="p">Password</label>
      <input type="password" id="p" name="password" autocomplete="current-password" required>
      <button type="submit">Sign in →</button>
    </form>
  </div>
</body>
</html>`;

// ─────────────────────────────────────────────────────────────────────────────
// Shared node properties
// Three modes:
//   none        → no auth
//   basicAuth   → native browser dialog (uses n8n built-in httpBasicAuth credential)
//   customLogin → custom HTML login page + cookie (uses same httpBasicAuth credential)
// ─────────────────────────────────────────────────────────────────────────────
export const authProperties: INodeProperties[] = [
  {
    displayName: 'Authentication',
    name: 'authentication',
    type: 'options',
    options: [
      { name: 'None', value: 'none' },
      { name: 'Basic Auth', value: 'basicAuth' },
      { name: 'Custom Login Page', value: 'customLogin' },
    ],
    default: 'none',
    description:
      '<b>Basic Auth</b>: browser native dialog, credentials stored in n8n vault. ' +
      '<b>Custom Login Page</b>: same credentials, custom HTML login form instead of browser dialog.',
  },
  {
    displayName: 'Login Page HTML',
    name: 'loginPageHtml',
    type: 'string',
    typeOptions: { rows: 15 },
    default: DEFAULT_LOGIN_HTML,
    displayOptions: { show: { authentication: ['customLogin'] } },
    description:
      'HTML of the login page. The form must use <code>method="POST" action=""</code> with fields ' +
      'named <code>username</code>, <code>password</code>, and a hidden field ' +
      '<code>_webstatic_login</code> with value <code>1</code>. ' +
      'Place <code>{{ERROR}}</code> anywhere to display an error on failed login.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

async function getHttpBasicCreds(ctx: IWebhookFunctions): Promise<{ user: string; password: string }> {
  const creds = await ctx.getCredentials('httpBasicAuth');
  return { user: creds['user'] as string, password: creds['password'] as string };
}

async function isCookieValid(ctx: IWebhookFunctions, cookieHeader: string | undefined): Promise<boolean> {
  if (!cookieHeader) return false;
  const token = parseCookies(cookieHeader)['ws_auth'];
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return false;
    const { user, password } = await getHttpBasicCreds(ctx);
    return decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call on every GET request.
 * Returns a response to send if auth fails, or null to continue normally.
 */
export async function checkAuth(
  ctx: IWebhookFunctions,
  req: Request,
  res: Response,
): Promise<IWebhookResponseData | null> {
  const mode = ctx.getNodeParameter('authentication') as string;
  if (mode === 'none') return null;

  // ── Basic Auth: native browser dialog ─────────────────────────────────────
  if (mode === 'basicAuth') {
    const { user, password } = await getHttpBasicCreds(ctx);
    const header = req.headers['authorization'] as string | undefined;
    if (header?.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
      const sep = decoded.indexOf(':');
      if (sep !== -1 && decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password) {
        return null; // ✓ valid
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected"');
    res.status(401).send('Unauthorized');
    return { noWebhookResponse: true };
  }

  // ── Custom Login Page: cookie-based ───────────────────────────────────────
  if (mode === 'customLogin') {
    const cookie = req.headers['cookie'] as string | undefined;
    if (await isCookieValid(ctx, cookie)) return null;

    const tpl = ctx.getNodeParameter('loginPageHtml') as string;
    const showError = req.query['login_error'] === '1';
    const errorHtml = showError ? '<p class="error">Incorrect username or password</p>' : '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(showError ? 401 : 200).send(tpl.replace('{{ERROR}}', errorHtml));
    return { noWebhookResponse: true };
  }

  return null;
}

/**
 * Call at the top of a POST handler.
 * If body contains _webstatic_login=1, handles the login attempt and returns a response.
 * Returns null if it is NOT a login attempt.
 */
export async function handleLoginPost(
  ctx: IWebhookFunctions,
  req: Request,
  res: Response,
  body: Record<string, string>,
): Promise<IWebhookResponseData | null> {
  if (body['_webstatic_login'] !== '1') return null;

  const { user, password } = await getHttpBasicCreds(ctx);
  const ok = body['username'] === user && body['password'] === password;

  if (ok) {
    const token = Buffer.from(`${body['username']}:${body['password']}`).toString('base64');
    res.setHeader('Set-Cookie', `ws_auth=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.redirect(302, req.path);
  } else {
    res.redirect(302, `${req.path}?login_error=1`);
  }
  return { noWebhookResponse: true };
}

/**
 * Returns true if the visitor is authenticated (or auth is disabled).
 * Use this to gate POST form submissions when customLogin is active.
 */
export async function isAuthenticated(ctx: IWebhookFunctions, req: Request): Promise<boolean> {
  const mode = ctx.getNodeParameter('authentication') as string;
  if (mode !== 'customLogin') return true;
  return isCookieValid(ctx, req.headers['cookie'] as string | undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Response headers helper
// ─────────────────────────────────────────────────────────────────────────────
export function applyResponseHeaders(
  res: Response,
  responseHeaders: { headers?: Array<{ name: string; value: string }> },
): void {
  for (const h of responseHeaders.headers ?? []) {
    if (h.name) res.setHeader(h.name, h.value);
  }
}
