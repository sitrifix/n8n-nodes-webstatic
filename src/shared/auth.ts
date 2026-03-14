import { IWebhookFunctions, IWebhookResponseData, INodeProperties } from 'n8n-workflow';
import { Response, Request } from 'express';

export const authProperties: INodeProperties[] = [
  {
    displayName: 'Authentication',
    name: 'authentication',
    type: 'options',
    options: [
      { name: 'None', value: 'none' },
      { name: 'Password (Basic Auth)', value: 'basicAuth' },
    ],
    default: 'none',
    description: 'Whether to protect the page with a password',
  },
  {
    displayName: 'Username',
    name: 'username',
    type: 'string',
    default: 'admin',
    required: true,
    displayOptions: { show: { authentication: ['basicAuth'] } },
    description: 'Username shown in the browser login dialog',
  },
  {
    displayName: 'Password',
    name: 'password',
    type: 'string',
    typeOptions: { password: true },
    default: '',
    required: true,
    displayOptions: { show: { authentication: ['basicAuth'] } },
    description: 'Password to access the page',
  },
  {
    displayName: 'Realm',
    name: 'realm',
    type: 'string',
    default: 'Protected Page',
    displayOptions: { show: { authentication: ['basicAuth'] } },
    description: 'Text shown in the browser login dialog',
  },
];

/**
 * Checks Basic Auth credentials.
 * Returns an IWebhookResponseData (to return early) if auth fails, or null if auth passes.
 */
export function basicAuthCheck(
  ctx: IWebhookFunctions,
  req: Request,
  res: Response,
): IWebhookResponseData | null {
  const authentication = ctx.getNodeParameter('authentication') as string;
  if (authentication !== 'basicAuth') return null;

  const expectedUsername = ctx.getNodeParameter('username') as string;
  const expectedPassword = ctx.getNodeParameter('password') as string;
  const realm = ctx.getNodeParameter('realm') as string;

  const reject = (): IWebhookResponseData => {
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
    res.status(401).send('Unauthorized');
    return { noWebhookResponse: true };
  };

  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Basic ')) return reject();

  const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) return reject();

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  if (username !== expectedUsername || password !== expectedPassword) return reject();

  return null;
}

export function applyResponseHeaders(
  res: Response,
  responseHeaders: { headers?: Array<{ name: string; value: string }> },
): void {
  for (const header of responseHeaders.headers ?? []) {
    if (header.name) res.setHeader(header.name, header.value);
  }
}
