import { authorizationInput } from '@/lib/stickwar-access';
import StickWarLogin from '@/components/StickWarLogin';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try {
    const params = await searchParams, values = new URLSearchParams();
    for (const name of ['state', 'challenge', 'device', 'redirect']) if (typeof params[name] === 'string') values.set(name, params[name]);
    const input = authorizationInput(values);
    return <StickWarLogin callbackUrl={'/api/stickwar/authorize?' + new URLSearchParams(input)} />;
  } catch { return <main style={{ padding: 32 }}>คำขอเข้าเกมไม่ถูกต้อง กรุณาเริ่มเข้าสู่ระบบจาก Stick WAR อีกครั้ง</main>; }
}
