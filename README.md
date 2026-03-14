# n8n-nodes-webstatic

An [n8n](https://n8n.io) community node package that lets you **host HTML pages directly from your workflows** — no external web server required.

[![npm version](https://img.shields.io/npm/v/n8n-nodes-webstatic)](https://www.npmjs.com/package/n8n-nodes-webstatic)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Two nodes

| Node | Role |
|---|---|
| **Web Form** | Serve a custom HTML page. When a visitor submits the form, the workflow is triggered with the form data. |
| **Web Page** | Serve a live HTML page whose content is pushed by another workflow. |

---

## Installation

### Via the n8n UI (recommended)

1. Go to **Settings → Community Nodes**
2. Search for `n8n-nodes-webstatic`
3. Click **Install**

### Manually (self-hosted)

```bash
npm install n8n-nodes-webstatic
```

Restart n8n after installation.

---

## Web Form

### How it works

- **`GET /webhook/[path]`** → serves your HTML page to the visitor (no workflow output)
- **`POST /webhook/[path]`** → receives form data and **triggers the workflow**

### Output

The **Submit** output fires on every form submission:

```json
{
  "timestamp": "2026-03-14T22:00:00.000Z",
  "field1": "value1",
  "field2": "value2"
}
```

Every `<input>`, `<select>`, and `<textarea>` in your form becomes a key in `$json`.

### Parameters

| Parameter | Description |
|---|---|
| **Path** | URL path where the page is served |
| **Authentication** | None / Basic Auth / Custom Login Page (see [Authentication](#authentication)) |
| **Page HTML** | Full HTML served on GET — supports n8n expressions |
| **After Submit** | Show a confirmation page or redirect to a URL |
| **Confirmation HTML** | HTML shown after a successful submission |
| **Redirect URL** | URL to redirect to after submission |
| **Additional Response Headers** | Custom HTTP headers (e.g. `X-Frame-Options: DENY`) |

### HTML conventions

**Minimal form** — every field name becomes a key in `$json`:
```html
<form method="POST" action="">
  <input name="date" type="date" />
  <select name="action">
    <option value="generate">Generate report</option>
    <option value="export">Export data</option>
  </select>
  <button type="submit">Continue</button>
</form>
```
→ `$json.date`, `$json.action`

**Pass fixed values with hidden fields:**
```html
<form method="POST" action="">
  <input type="hidden" name="action" value="start" />
  <input type="hidden" name="vm" value="windows" />
  <button type="submit">Start VM</button>
</form>
```
→ `$json.action = "start"`, `$json.vm = "windows"`

**Multiple buttons with different actions:**
```html
<form method="POST" action="">
  <button type="submit" name="action" value="start">Start</button>
  <button type="submit" name="action" value="stop">Stop</button>
</form>
```
→ `$json.action` will be `"start"` or `"stop"` depending on which button was clicked.

**Dynamic content with n8n expressions** — use expressions inside the Page HTML:
```html
<p>Hello, {{ $json.name }}</p>
<p>Status: {{ $json.status }}</p>
```

### Workflow example

```
[Web Form] ──Submit──▶ [Start VM via API] ──▶ [Send notification]
```

> **Note:** The confirmation page is shown immediately after submit — it does not wait for the workflow to complete. If you need to display a result that depends on the workflow output, use a **Web Page** node and redirect the user to it.

---

## Web Page

### How it works

- **`GET /webhook/[path]`** → serves the last HTML content that was pushed (no workflow output)
- **`POST /webhook/[path]`** → receives new HTML from another workflow, stores it, fires the **Updated** output

The content persists between workflow executions (stored in n8n's workflow static data).

### Output

The **Updated** output fires every time the content is pushed:

```json
{
  "event": "page_updated",
  "path": "my-page",
  "lastUpdated": "2026-03-14T22:00:00.000Z",
  "htmlLength": 4821
}
```

The GET response also includes an `X-Last-Updated` header with the ISO timestamp.

### Parameters

| Parameter | Description |
|---|---|
| **Path** | URL path where the page is served |
| **Authentication** | None / Basic Auth / Custom Login Page (see [Authentication](#authentication)) |
| **Additional Response Headers** | Custom HTTP headers (e.g. `Cache-Control: no-store`) |

### How to push content from another workflow

Add an **HTTP Request** node at the end of your workflow:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `[n8n-host]/webhook/[path]` |
| Body Content Type | JSON |
| JSON Body | `{ "html": "{{ $json.html }}" }` |

You can also send a raw HTML string as the body (Content-Type: `text/html`).

### Workflow example

**Workflow A — display (keep active)**
```
[Web Page]  ──Updated──▶  (optional: log / notify)
  path: weekly-report
```

**Workflow B — content generation (runs on schedule)**
```
[Schedule] ──▶ [Fetch data] ──▶ [Code: build HTML] ──▶ [HTTP Request → POST /webhook/weekly-report]
```

---

## Authentication

Both nodes support three authentication modes via the **Authentication** parameter.

### None
The page is publicly accessible — no credentials required.

### Basic Auth
Uses n8n's built-in **HTTP Basic Auth** credential (the same credential type used across all n8n HTTP nodes).

The browser shows its native login dialog. Credentials are stored securely in the n8n vault.

**Setup:**
1. Set Authentication to `Basic Auth`
2. Create or select an `HTTP Basic Auth` credential with your username and password

### Custom Login Page
Same `HTTP Basic Auth` credential, but instead of the browser dialog, visitors see a **custom HTML login form**.

After a successful login, a session cookie is set so the visitor stays authenticated for the browser session.

**Setup:**
1. Set Authentication to `Custom Login Page`
2. Select an `HTTP Basic Auth` credential
3. Optionally edit the **Login Page HTML** parameter to customise the design

#### Custom login page requirements

Your HTML must contain a form with these exact fields:

```html
<form method="POST" action="">

  <!-- Required: tells the node this is a login request -->
  <input type="hidden" name="_webstatic_login" value="1" />

  <!-- Field names must be exactly "username" and "password" -->
  <input type="text"     name="username" autocomplete="username" />
  <input type="password" name="password" autocomplete="current-password" />

  <button type="submit">Sign in</button>
</form>
```

Place `{{ERROR}}` anywhere in the HTML to show an error message on failed login:

```html
<!-- {{ERROR}} is replaced by an error <p> on failed login, or empty string on success -->
<div class="error-container">{{ERROR}}</div>
```

The default login page follows these conventions and can be used as a starting point.

---

## Typical use cases

### Interactive dashboard with action button
```
[Web Form] ──Submit──▶ [API: perform action] ──▶ [Send notification]
```
The user visits the page, clicks a button (form with hidden fields), and the workflow runs.

### Live report or monitoring page
```
[Schedule] ──▶ [Fetch metrics] ──▶ [Code: build HTML] ──▶ [HTTP Request → Web Page]
```
Visitors always see the latest generated content.

### AI-generated page
```
[Trigger] ──▶ [OpenAI: generate HTML] ──▶ [HTTP Request → Web Page]
```

### Form → workflow → result page
Combine both nodes:

1. **Web Form** at `/webhook/my-form` — user submits, workflow runs, "After Submit" redirects to `/webhook/my-result`
2. **Web Page** at `/webhook/my-result` — the workflow pushes the result HTML there before the redirect lands

---

## Development

Clone and build locally with Docker:

```bash
git clone https://github.com/sitrifix/n8n-nodes-webstatic.git
cd n8n-nodes-webstatic
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine npm run build
```

### Compatibility

| n8n version | Status |
|---|---|
| ≥ 1.0.0 | ✅ Supported |

---

## License

MIT © Sitrifix
