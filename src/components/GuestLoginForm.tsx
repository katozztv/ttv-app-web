'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function GuestLoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('กรุณากรอกชื่อผู้ใช้งาน');
      return;
    }
    
    // Validate username (no special chars, limit length)
    if (!/^[a-zA-Z0-9ก-๙]+$/.test(username) || username.length > 20) {
      setError('ชื่อต้องเป็นตัวอักษรหรือตัวเลขเท่านั้น และยาวไม่เกิน 20 ตัวอักษร');
      return;
    }

    if (password !== username) {
      setError('รหัสผ่านต้องตรงกับชื่อผู้ใช้งานเท่านั้น');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      let hwid = 'UNKNOWN';
      if (typeof window !== 'undefined' && window.electron && window.electron.getHWID) {
        hwid = await window.electron.getHWID();
      } else {
        // Fallback for browser debugging
        hwid = 'BROWSER-' + Math.random().toString(36).substr(2, 9);
      }

      const res = await signIn('credentials', {
        username,
        password,
        hwid,
        redirect: false
      });

      if (res?.error) {
        setError('เกิดข้อผิดพลาด หรือชื่อนี้ถูกใช้งานโดยเครื่องอื่นแล้ว');
        setLoading(false);
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
      setError('ระบบขัดข้อง กรุณาลองใหม่');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl w-full max-w-sm backdrop-blur-sm">
      <h2 className="text-xl font-bold text-white mb-2">เข้าใช้งานทั่วไป</h2>
      <p className="text-sm text-zinc-400 mb-6 text-center">สำหรับลูกค้าเช่า/ซื้อเกม กรอกชื่อแล้วเข้าใช้งานได้เลย (ระบบจะจดจำเครื่องอัตโนมัติ)</p>
      
      <form onSubmit={handleGuestLogin} className="w-full flex flex-col gap-3">
        <input 
          type="text" 
          placeholder="ชื่อผู้ใช้งานของคุณ" 
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FACC15]/50 focus:border-[#FACC15] transition-all"
        />
        <input 
          type="password" 
          placeholder="รหัสผ่าน (กรอกให้ตรงกับชื่อผู้ใช้งาน)" 
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FACC15]/50 focus:border-[#FACC15] transition-all"
        />
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        
        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-white hover:bg-zinc-200 text-black font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าใช้งานระบบ'}
        </button>
      </form>
    </div>
  );
}
