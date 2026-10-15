import { handleDriveRequest } from '../../_lib/handle.ts';

export default function handler(req: Parameters<typeof handleDriveRequest>[0], res: Parameters<typeof handleDriveRequest>[1]) {
  return handleDriveRequest(req, res);
}
