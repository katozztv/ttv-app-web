import { exchangeAccess, failure, headers, readBody } from '@/lib/stickwar-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return Response.json(await exchangeAccess(await readBody(request)), { headers }); }
  catch (error) { return failure(error); }
}
