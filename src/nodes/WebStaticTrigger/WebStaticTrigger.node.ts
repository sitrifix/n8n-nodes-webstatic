import {
  IWebhookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookResponseData,
} from 'n8n-workflow';

import {
  checkAuth,
  handleLoginPost,
  isAuthenticated,
  applyResponseHeaders,
  authProperties,
} from '../../shared/auth';

/** Parse application/x-www-form-urlencoded into a plain object */
function parseFormBody(raw: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Page</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 3rem auto; padding: 0 1rem; }
    label { display: block; margin-bottom: .5rem; font-weight: 600; }
    input, select { width: 100%; padding: .5rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
    button { padding: .6rem 1.4rem; background: #ff6d5a; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
  </style>
</head>
<body>
  <h1>My Workflow Page</h1>
  <!-- This form POSTs to the same URL — n8n receives it and continues the workflow -->
  <form method="POST" action="">
    <label for="date">Select a date</label>
    <input type="date" id="date" name="date" required />

    <label for="action">Action</label>
    <select id="action" name="action">
      <option value="generate">Generate report</option>
      <option value="export">Export data</option>
    </select>

    <button type="submit">Continue →</button>
  </form>
</body>
</html>`;

const DEFAULT_SUBMIT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Submitted</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #0f0f13; color: #e2e8f0; }
    .box { text-align: center; }
    .icon { font-size: 3rem; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">✅</div>
    <h2>Submitted — workflow is running</h2>
    <p>You can close this page.</p>
  </div>
</body>
</html>`;

export class WebStaticTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Web Form Trigger',
    name: 'webStaticTrigger',
    icon: 'file:webstatic.svg',
    group: ['trigger'],
    version: 1,
    description:
      'Serve an HTML page with a form at a fixed URL. ' +
      'A visit (GET) and a form submission (POST) each trigger a separate workflow output.',
    defaults: { name: 'Web Form Trigger' },
    inputs: [],
    outputs: ['main', 'main'],
    outputNames: ['Visit', 'Submit'],
    credentials: [
      {
        name: 'webStaticAuth',
        required: true,
        displayOptions: { show: { authentication: ['basicAuth'] } },
      },
    ],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'GET',
        responseMode: 'onReceived',
        path: '={{$parameter["path"]}}',
      },
      {
        name: 'setup',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: '={{$parameter["path"]}}',
      },
    ],
    properties: [
      // ── Path ──────────────────────────────────────────────────────────
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: 'my-page',
        required: true,
        placeholder: 'my-page',
        description:
          'URL path. Page at <code>[n8n-host]/webhook/[path]</code> (GET). ' +
          'HTML forms using <code>method="POST" action=""</code> submit to the same URL.',
      },

      // ── Auth ──────────────────────────────────────────────────────────
      ...authProperties,

      // ── Page HTML ──────────────────────────────────────────────────────
      {
        displayName: 'HTML Content',
        name: 'htmlContent',
        type: 'string',
        typeOptions: { rows: 20 },
        default: DEFAULT_HTML,
        required: true,
        description:
          'HTML served on GET. Add <code>&lt;form method="POST" action=""&gt;</code> ' +
          'to let users trigger the workflow. Supports n8n expressions.',
      },

      // ── Submit response ────────────────────────────────────────────────
      {
        displayName: 'Response After Submit',
        name: 'submitResponse',
        type: 'options',
        options: [
          { name: 'Show confirmation page', value: 'page' },
          { name: 'Redirect to URL', value: 'redirect' },
        ],
        default: 'page',
        description: 'What to show the user after they submit the form',
      },
      {
        displayName: 'Confirmation HTML',
        name: 'submitHtml',
        type: 'string',
        typeOptions: { rows: 10 },
        default: DEFAULT_SUBMIT_HTML,
        displayOptions: { show: { submitResponse: ['page'] } },
        description: 'HTML page shown after a successful form submission',
      },
      {
        displayName: 'Redirect URL',
        name: 'submitRedirect',
        type: 'string',
        default: '',
        placeholder: 'https://example.com/thank-you',
        displayOptions: { show: { submitResponse: ['redirect'] } },
        description: 'URL to redirect the user to after submission',
      },

      // ── Extra headers ──────────────────────────────────────────────────
      {
        displayName: 'Additional Response Headers',
        name: 'responseHeaders',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        placeholder: 'Add Header',
        description: 'Extra HTTP headers on GET responses',
        options: [
          {
            name: 'headers',
            displayName: 'Header',
            values: [
              { displayName: 'Name', name: 'name', type: 'string', default: '', placeholder: 'X-Frame-Options' },
              { displayName: 'Value', name: 'value', type: 'string', default: '', placeholder: 'DENY' },
            ],
          },
        ],
      },
    ],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const webhookName = this.getWebhookName();
    const req = this.getRequestObject();
    const res = this.getResponseObject();

    // ── POST ──────────────────────────────────────────────────────────────
    if (webhookName === 'setup') {
      // Parse body
      const contentType = (req.headers['content-type'] ?? '') as string;
      let body: Record<string, string> = {};
      if (contentType.includes('application/x-www-form-urlencoded')) {
        if (typeof req.body === 'string') {
          body = parseFormBody(req.body);
        } else if (req.body && typeof req.body === 'object') {
          body = req.body as Record<string, string>;
        }
      } else if (req.body && typeof req.body === 'object') {
        body = req.body as Record<string, string>;
      }

      // Login attempt? (only when auth is enabled)
      const authentication = this.getNodeParameter('authentication') as string;
      if (authentication === 'basicAuth') {
        const loginResult = await handleLoginPost(this, req, res, body);
        if (loginResult !== null) return loginResult;

        // Auth check for regular form submissions
        if (!(await isAuthenticated(this, req))) {
          res.redirect(302, req.path);
          return { noWebhookResponse: true };
        }
      }

      // Form submission — respond then trigger workflow
      const submitResponse = this.getNodeParameter('submitResponse') as string;
      if (submitResponse === 'redirect') {
        res.redirect(this.getNodeParameter('submitRedirect') as string);
      } else {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(this.getNodeParameter('submitHtml') as string);
      }

      return {
        noWebhookResponse: true,
        workflowData: [
          null as unknown as [],
          [{ json: { timestamp: new Date().toISOString(), ...body } }],
        ],
      };
    }

    // ── GET: serve the page ───────────────────────────────────────────────
    const authResult = await checkAuth(this, req, res);
    if (authResult !== null) return authResult;

    const htmlContent = this.getNodeParameter('htmlContent') as string;
    const responseHeaders = this.getNodeParameter('responseHeaders') as {
      headers?: Array<{ name: string; value: string }>;
    };

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    applyResponseHeaders(res, responseHeaders);
    res.status(200).send(htmlContent);

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    return {
      noWebhookResponse: true,
      workflowData: [
        [{ json: { timestamp: new Date().toISOString(), ip, userAgent: req.headers['user-agent'] ?? null, path: req.path, query: req.query } }],
        null as unknown as [],
      ],
    };
  }
}
