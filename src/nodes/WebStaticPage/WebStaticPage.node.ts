import {
  IWebhookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookResponseData,
} from 'n8n-workflow';

import { checkAuth, applyResponseHeaders, authProperties } from '../../shared/auth';

const PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Not yet generated</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #0f0f13; color: #94a3b8; }
    p { font-size: 1.1rem; }
  </style>
</head>
<body><p>Page not yet generated — POST HTML to this URL to publish content.</p></body>
</html>`;

export class WebStaticPage implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Web Page',
    name: 'webStaticPage',
    icon: 'file:webstaticpage.svg',
    group: ['trigger'],
    version: 1,
    description:
      'Serve a live HTML page at a fixed URL. ' +
      'Another workflow pushes content to it via HTTP POST — visitors always see the latest version.',
    defaults: { name: 'Web Page' },
    inputs: [],
    outputs: ['main'],
    outputNames: ['Updated'],
    credentials: [
      {
        name: 'httpBasicAuth',
        required: true,
        displayOptions: { show: { authentication: ['basicAuth', 'customLogin'] } },
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
      // ── Path ─────────────────────────────────────────────────────────────
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: 'my-page',
        required: true,
        placeholder: 'weekly-report',
        description: 'URL path — page available at <code>[n8n-host]/webhook/[path]</code>',
      },

      // ── Auth ─────────────────────────────────────────────────────────────
      ...authProperties,

      // ── Extra response headers ────────────────────────────────────────────
      {
        displayName: 'Additional Response Headers',
        name: 'responseHeaders',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        placeholder: 'Add Header',
        description: 'Extra HTTP headers on GET responses (e.g. <code>Cache-Control: no-store</code>)',
        options: [
          {
            name: 'headers',
            displayName: 'Header',
            values: [
              { displayName: 'Name', name: 'name', type: 'string', default: '', placeholder: 'Cache-Control' },
              { displayName: 'Value', name: 'value', type: 'string', default: '', placeholder: 'no-store' },
            ],
          },
        ],
      },

      // ── Usage notice ──────────────────────────────────────────────────────
      {
        displayName:
          '<b>How to update this page from another workflow:</b><br/>' +
          'Add an <b>HTTP Request</b> node:<br/>' +
          '• Method: <code>POST</code><br/>' +
          '• URL: <code>[n8n-host]/webhook/[path]</code><br/>' +
          '• Body (JSON): <code>{ "html": "{{ $json.html }}" }</code><br/>' +
          '• Body (raw): paste an HTML string directly',
        name: 'notice',
        type: 'notice',
        default: '',
      },
    ],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const webhookName = this.getWebhookName();
    const req = this.getRequestObject();
    const res = this.getResponseObject();

    // ── POST: receive and store new HTML from another workflow ────────────────
    if (webhookName === 'setup') {
      const body = req.body as Record<string, unknown> | string | undefined;
      let html: string | undefined;

      if (typeof body === 'string' && body.trimStart().startsWith('<')) {
        html = body;
      } else if (body && typeof body === 'object' && typeof body['html'] === 'string') {
        html = body['html'];
      }

      if (!html) {
        res.status(400).json({ error: 'Send { "html": "..." } or a raw HTML string.' });
        return { noWebhookResponse: true };
      }

      const staticData = this.getWorkflowStaticData('node');
      staticData.html = html;
      staticData.lastUpdated = new Date().toISOString();

      res.status(200).json({ success: true, lastUpdated: staticData.lastUpdated });

      return {
        noWebhookResponse: true,
        workflowData: [[{
          json: {
            event: 'page_updated',
            path: this.getNodeParameter('path') as string,
            lastUpdated: staticData.lastUpdated,
            htmlLength: html.length,
          },
        }]],
      };
    }

    // ── GET: serve stored HTML ────────────────────────────────────────────────
    const authResult = await checkAuth(this, req, res);
    if (authResult !== null) return authResult;

    const responseHeaders = this.getNodeParameter('responseHeaders') as { headers?: Array<{ name: string; value: string }> };
    const staticData = this.getWorkflowStaticData('node');
    const html = (staticData.html as string | undefined) ?? PLACEHOLDER_HTML;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (staticData.lastUpdated) res.setHeader('X-Last-Updated', staticData.lastUpdated as string);
    applyResponseHeaders(res, responseHeaders);
    res.status(200).send(html);

    return { noWebhookResponse: true };
  }
}
