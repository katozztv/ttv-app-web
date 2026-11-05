import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { AccessError, authorizationInput, entitlement, failure, grantAccess, headers } from '@/lib/stickwar-access';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export async function GET(request: Request) {
  try {
    const url = new URL(request.url), input = authorizationInput(url.searchParams);
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      const signin = new URL('/stickwar-login', url.origin);
      signin.search = new URLSearchParams(input).toString();
      return new Response(null, { status: 302, headers: { ...headers, Location: signin.href } });
    }
    const member = await entitlement(session.user.id);
    const hidden = Object.entries(input).map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`).join('');
    return new Response(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LINE UP · เข้าเล่น Stick WAR</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#132820;color:#fff6dd;font-family:Tahoma,sans-serif}main{max-width:420px;margin:24px;padding:32px;border:1px solid #857847;border-radius:18px}h1{font-size:28px}p{line-height:1.8;color:#d8dfc7}button{width:100%;padding:15px;border:0;border-radius:8px;background:#ddc47d;color:#173628;font:700 16px Tahoma;cursor:pointer}small{display:block;margin-top:18px;line-height:1.7;color:#b8c4af}</style><main><p>TTV APP</p><h1>เข้าเล่น Stick WAR</h1><p>บัญชี ${escape(member.label)} มีสิทธิ์ TTV<br>กดยืนยันเพื่อเปิดเกมบนเครื่องที่คุณเริ่มเข้าสู่ระบบ</p><form method="post">${hidden}<button type="submit">ยืนยันและกลับเข้าเกม</button></form><small>เข้าเกมแล้วกด X → TikTok LIVE เพื่อตั้งค่าบัญชี TikTok ของคุณเอง</small></main></html>`,
      { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin || Number(request.headers.get('content-length')) > 4096) throw new AccessError(403, 'กรุณายืนยันจากหน้า TTV APP');
    const session = await getServerSession(authOptions);
    if (!session?.user) throw new AccessError(401, 'กรุณาเข้าสู่ระบบ Discord');
    const input = authorizationInput(await request.formData()), grant = await grantAccess(session.user.id, input);
    const callback = new URL(input.redirect); callback.searchParams.set('state', input.state); callback.searchParams.set('grant', grant);
    return new Response(null, { status: 303, headers: { ...headers, Location: callback.href } });
  } catch (error) { return failure(error); }
}
