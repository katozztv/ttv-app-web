import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { supabase } from "@/lib/supabase";
import LoginButton from "@/components/LoginButton";
import GuestLoginForm from "@/components/GuestLoginForm";
import TikTokForm from "@/components/TikTokForm";
import Dashboard from "@/components/Dashboard";
import ConnectionRetry from "@/components/ConnectionRetry";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const USER_FETCH_ATTEMPTS = 3;

// A failed read must never look like "no account yet", otherwise a Supabase hiccup
// during a live kicks the user to the first-time TikTok form. Retry, then report failure.
async function fetchUserRow(discordId: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < USER_FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    try {
      const { data, error } = await supabase
        .from("ttv_task")
        .select("*")
        .eq("discord_id", discordId)
        .maybeSingle();
      if (!error) return { user: data, failed: false };
      lastError = error;
    } catch (err) {
      lastError = err;
    }
  }
  console.error("Failed to load ttv_task row:", lastError);
  return { user: null, failed: true };
}

const LOGIN_ERRORS: Record<string, string> = {
  OAuthSignin: "เริ่มเชื่อมต่อ Discord ไม่สำเร็จ ลองกดใหม่อีกครั้ง",
  OAuthCallback: "Discord ส่งข้อมูลกลับมาไม่สำเร็จ (อาจเกิดจากเวลาเครื่องไม่ตรง หรือ cookie ถูกบล็อก) ลองกดใหม่อีกครั้ง",
  OAuthCreateAccount: "สร้างข้อมูลผู้ใช้จาก Discord ไม่สำเร็จ",
  OAuthAccountNotLinked: "บัญชีนี้เคยเข้าสู่ระบบด้วยวิธีอื่นแล้ว",
  Callback: "ระบบตรวจสอบการเข้าสู่ระบบล้มเหลว ลองกดใหม่อีกครั้ง",
  AccessDenied: "ไม่ได้รับอนุญาตให้เข้าสู่ระบบ",
  CredentialsSignin: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  SessionRequired: "กรุณาเข้าสู่ระบบก่อน",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const rawError = (await searchParams).error;
  const loginError = Array.isArray(rawError) ? rawError[0] : rawError;

  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch (err: any) {
    return <div className="text-white p-10">Error fetching session: {err.message}</div>;
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#050505] flex flex-col items-center justify-center relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-br from-yellow-400/15 to-amber-600/10 rounded-full blur-[100px]" />
        
        <div className="relative z-10 text-center">
          <div className="mb-12 inline-block">
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter">
              <span className="text-yellow-400">TTV</span> <span className="text-white">APP</span>
            </h1>
            <p className="mt-4 text-xl text-zinc-400 font-medium">เครื่องมือไลฟ์ TikTok สำหรับสมาชิก TTV / TTV STAR</p>
          </div>
          
          {loginError && (
            <div className="mb-8 mx-auto max-w-xl px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {LOGIN_ERRORS[loginError] || "เข้าสู่ระบบไม่สำเร็จ"}
              <span className="block mt-1 text-xs text-red-400/70">รหัสข้อผิดพลาด: {loginError}</span>
            </div>
          )}

          <div className="flex flex-col md:flex-row items-stretch justify-center gap-8 w-full max-w-4xl mx-auto px-4">
            
            {/* Left: Discord Login (Existing) */}
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-yellow-400/5 border border-yellow-400/30 rounded-2xl backdrop-blur-sm">
              <h2 className="text-xl font-bold text-white mb-2">สมาชิก TTV</h2>
              <p className="text-sm text-zinc-400 mb-6 text-center">เข้าสู่ระบบด้วย Discord เพื่อสะสมแต้ม เลเวล และรับของรางวัลพิเศษต่างๆ</p>
              <LoginButton />
              <p className="mt-4 text-xs text-zinc-500">*ต้องมียศ TTV หรือ TTV STAR ใน Discord เพื่อปลดล็อกทุกฟีเจอร์</p>
            </div>

            {/* Divider for mobile */}
            <div className="md:hidden w-full h-[1px] bg-zinc-800 my-4" />

            {/* Right: Guest Login */}
            <div className="flex-1 flex justify-center">
              <GuestLoginForm />
            </div>

          </div>
        </div>
      </main>
    );
  }

  // User is logged in, check Supabase for their data
  const { user, failed } = await fetchUserRow(session.user.id);

  if (failed) {
    return <ConnectionRetry />;
  }

  const isGuest = session.user.id.startsWith("HWID:");

  if (!isGuest && (!user || !user.tiktok_username)) {
    // First time login or no tiktok username for Discord users
    return <TikTokForm discordId={session.user.id} discordName={session.user.name || "User"} />;
  }

  return <Dashboard user={user || { discord_id: session.user.id, role: 'guest' }} sessionUser={session.user} />;
}
