import { dispatch } from '@/lib/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request) {
  const url = new URL(req.url);
  return dispatch(req, url.pathname, url);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
