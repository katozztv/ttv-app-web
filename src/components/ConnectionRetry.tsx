'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

const RETRY_INTERVAL_MS = 5000;

// Shown when user data couldn't be loaded (e.g. Supabase timeout) — keeps retrying
// instead of treating the user as a first-time login.
export default function ConnectionRetry() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-600/20 rounded-full blur-[128px]" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-yellow-600/20 rounded-full blur-[128px]" />

      <div className="relative z-10 w-full max-w-md">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl text-center">
          <div className="w-16 h-16 bg-gradient-to-tr from-amber-500 to-yellow-500 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-white animate-spin" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">กำลังเชื่อมต่อใหม่...</h2>
          <p className="text-zinc-400 mb-6">
            โหลดข้อมูลบัญชีไม่สำเร็จชั่วคราว ระบบจะลองใหม่อัตโนมัติ
          </p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="w-full py-3 px-4 rounded-xl text-black font-medium bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 transition-all"
          >
            ลองใหม่ตอนนี้
          </button>
        </div>
      </div>
    </div>
  );
}
