import { dispatch } from '@/lib/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  return dispatch(req, url.pathname, url);
}
