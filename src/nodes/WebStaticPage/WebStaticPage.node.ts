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
    displayName: 'Web Page Output',
    name: 'webStaticPage',
    icon: 'file:webstaticpage.svg',
    // Must be 'trigger' so n8n properly registers the webhooks
    group: ['trigger'],
    version: 1,
    description:
      'Serve a live HTML page at a fixed URL. ' +
      'Another workflow pushes HTML content to it via HTTP POST — the page is instantly updated for all visitors.',
    defaults: { name: 'Web Page Output' },
    inputs: [],
    outputs: ['main'],
    outputNames: ['On Update'],
    credentials: [
      {
        name: 'webStaticAuth',
        required: true,
        displayOptions: { show: { authentication: ['basicAuth'] } },
      },
    ],
    webhooks: [
      // GET — serves the stored HTML to any visitor
      {
        name: 'default',
        httpMethod: 'GET',
        responseMode: 'onReceived',
        path: '={{$parameter["path"]}}',
      },
      // POST — receives new HTML from another n8n workflow (HTTP Request node)
      {
        name: 'setup',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: '={{$parameter["path"]}}',
      },
    ],
    properties: [
      // ── Path ─────────────────────────────────────────────────────────
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: 'my-page',
        required: true,
        placeholder: 'weekly-report',
        description:
          'URL path. Page accessible at <code>[n8n-host]/webhook/[path]</code> (GET). ' +
          'Update it by POSTing <code>{ "html": "..." }</code> or a raw HTML string to the same URL from another workflow.',
      },

      // ── Auth (GET only) ───────────────────────────────────────────────
      ...authProperties,

      // ── Extra response headers ────────────────────────────────────────
      {
        displayName: 'Additional Response Headers',
        name: 'responseHeaders',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        placeholder: 'Add Header',
        description: 'Extra HTTP headers added to GET responses (e.g. Cache-Control)',
        options: [
          {
            name: 'headers',
            displayName: 'Header',
            values: [
              {
                displayName: 'Name',
                name: 'name',
                type: 'string',
                default: '',
                placeholder: 'Cache-Control',
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                placeholder: 'no-store',
              },
            ],
          },
        ],
      },

      // ── How-to notice ────────────────────────────────────────────────
      {
        displayName:
          '<b>How to update this page from another workflow:</b><br/>' +
          'Add an <b>HTTP Request</b> node at the end of your workflow:<br/>' +
          '• Method: <code>POST</code><br/>' +
          '• URL: <code>[n8n-host]/webhook/[path]</code><br/>' +
          '• Body: JSON → <code>{ "html": "{{ $json.html }}" }</code>',
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

    // ── POST: store new HTML (called from another n8n workflow, no browser auth) ──
    if (webhookName === 'setup') {
      const body = req.body as Record<string, unknown> | string | undefined;

      let html: string | undefined;
      if (typeof body === 'string' && body.trimStart().startsWith('<')) {
        html = body; // raw HTML string
      } else if (body && typeof body === 'object' && typeof body['html'] === 'string') {
        html = body['html']; // { "html": "..." }
      }

      if (!html) {
        res
          .status(400)
          .json({ error: 'Send JSON body { "html": "<your html>" } or a raw HTML string.' });
        return { noWebhookResponse: true };
      }

      const staticData = this.getWorkflowStaticData('node');
      staticData.html = html;
      staticData.lastUpdated = new Date().toISOString();

      res.status(200).json({ success: true, lastUpdated: staticData.lastUpdated });

      return {
        noWebhookResponse: true,
        workflowData: [
          [
            {
              json: {
                event: 'html_updated',
                lastUpdated: staticData.lastUpdated,
                path: this.getNodeParameter('path') as string,
                htmlLength: html.length,
              },
            },
          ],
        ],
      };
    }

    // ── GET: serve stored HTML ────────────────────────────────────────────
    const authResult = await checkAuth(this, req, res);
    if (authResult !== null) return authResult;

    const responseHeaders = this.getNodeParameter('responseHeaders') as {
      headers?: Array<{ name: string; value: string }>;
    };

    const staticData = this.getWorkflowStaticData('node');
    const html = (staticData.html as string | undefined) ?? PLACEHOLDER_HTML;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (staticData.lastUpdated) {
      res.setHeader('X-Last-Updated', staticData.lastUpdated as string);
    }
    applyResponseHeaders(res, responseHeaders);
    res.status(200).send(html);

    return { noWebhookResponse: true };
  }
}
