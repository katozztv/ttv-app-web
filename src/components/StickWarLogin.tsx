'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
export default function StickWarLogin({ callbackUrl }: { callbackUrl: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <main className="min-h-screen grid place-items-center bg-zinc-950 text-white p-6"><section className="max-w-md w-full rounded-2xl border border-zinc-700 bg-zinc-900 p-8">
    <p className="text-amber-300 mb-3">TTV APP · STICK WAR</p><h1 className="text-2xl font-bold mb-4">เข้าสู่เกมด้วยบัญชี TTV</h1>
    <p className="text-zinc-300 mb-6 leading-7">ใช้ Discord บัญชีเดียวกับ TTV APP ไม่ต้องสร้าง PASS เมื่อเข้าเกมแล้วตั้งค่า TikTok ของคุณเองได้</p>
    <button disabled={busy} className="w-full rounded-lg bg-yellow-500 p-4 font-bold disabled:opacity-50" onClick={async () => {
      setBusy(true); setError('');
      try { await signIn('discord', { callbackUrl }); }
      catch { setError('เปิด Discord ไม่สำเร็จ กรุณาลองใหม่'); setBusy(false); }
    }}>{busy ? 'กำลังเปิด Discord…' : 'เข้าสู่ระบบด้วย Discord'}</button>
    {error && <p role="alert" className="text-red-300 mt-4">{error}</p>}
  </section></main>;
}
