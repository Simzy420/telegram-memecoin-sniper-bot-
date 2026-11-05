import { handleAccountsRequest } from './_lib/accounts.ts';

export default function handler(req: Parameters<typeof handleAccountsRequest>[0], res: Parameters<typeof handleAccountsRequest>[1]) {
  return handleAccountsRequest(req, res);
}
