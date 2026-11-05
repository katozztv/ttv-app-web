'use client';

import { signIn } from 'next-auth/react';
import { LogIn } from 'lucide-react';

export default function LoginButton() {
  return (
    <button
      onClick={() => signIn('discord')}
      className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-2xl font-semibold text-lg transition-all duration-300 shadow-[0_0_20px_rgba(250,204,21,0.4)] hover:shadow-[0_0_30px_rgba(250,204,21,0.6)] hover:-translate-y-1 overflow-hidden"
    >
      <div className="absolute inset-0 bg-white/30 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out" />
      <LogIn className="w-5 h-5 relative z-10" />
      <span className="relative z-10">เข้าสู่ระบบด้วย Discord</span>
    </button>
  );
}
