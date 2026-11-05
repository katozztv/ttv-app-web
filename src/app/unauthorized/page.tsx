'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Suspense } from 'react';

function UnauthorizedContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  let title = "การเข้าถึงถูกปฏิเสธ";
  let message = "คุณไม่ได้รับอนุญาตให้เข้าใช้งานระบบนี้";

  if (error === 'not_in_server') {
    title = "ไม่พบข้อมูลในเซิร์ฟเวอร์";
    message = "คุณจำเป็นต้องอยู่ในเซิร์ฟเวอร์ Discord ของ TTV ก่อนจึงจะเข้าใช้งานได้";
  } else if (error === 'no_role') {
    title = "ไม่มีสิทธิ์เข้าใช้งาน";
    message = "คุณจำเป็นต้องมียศ (Role) ที่กำหนดในเซิร์ฟเวอร์ Discord เพื่อเข้าใช้งานระบบนี้";
  }

  return (
    <div className="relative z-10 w-full max-w-md text-center">
      <div className="bg-red-500/10 border border-red-500/20 p-8 rounded-3xl backdrop-blur-xl">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-10 h-10 text-red-500" />
        </div>
        
        <h1 className="text-2xl font-bold text-white mb-4">{title}</h1>
        <p className="text-zinc-400 mb-8 leading-relaxed">
          {message}
        </p>

        <Link 
          href="/"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-zinc-300 hover:text-white transition-all w-full"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>กลับสู่หน้าหลัก</span>
        </Link>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[120px]" />
      
      <Suspense fallback={<div className="text-white">กำลังตรวจสอบ...</div>}>
        <UnauthorizedContent />
      </Suspense>
    </div>
  );
}
