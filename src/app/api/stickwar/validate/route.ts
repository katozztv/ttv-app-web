import { failure, headers, readBody, unseal, validateAccess } from '@/lib/stickwar-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    return Response.json(await validateAccess(unseal(body.sessionToken, 'session', body.machineId)), { headers });
  } catch (error) { return failure(error); }
}
