import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class WebStaticAuth implements ICredentialType {
  name = 'webStaticAuth';
  displayName = 'Web Static — Password Protection';
  documentationUrl = 'https://github.com/sitrifix/n8n-nodes-webstatic';
  properties: INodeProperties[] = [
    {
      displayName: 'Username',
      name: 'username',
      type: 'string',
      default: 'admin',
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: { password: true },
      default: '',
    },
  ];
}
