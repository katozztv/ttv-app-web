import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { AccessError, authorizationInput, entitlement, failure, grantAccess, headers, readBody } from '@/lib/stickwar-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new AccessError(403, 'ที่มาคำขอไม่ถูกต้อง');
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new AccessError(401, 'กรุณาเข้าสู่ระบบ TTV APP ใหม่');
    const body = await readBody(request);
    // Preflight checks permissions before starting the executable; identity always comes from the session.
    if (body.preflight === true) {
      await entitlement(session.user.id);
      return Response.json({ allowed: true }, { headers });
    }
    const input = authorizationInput(new URLSearchParams(Object.fromEntries(
      ['state', 'challenge', 'device', 'redirect'].map(key => [key, String(body[key] || '')]),
    )));
    return Response.json({ grant: await grantAccess(session.user.id, input), state: input.state }, { headers });
  } catch (error) { return failure(error); }
}
