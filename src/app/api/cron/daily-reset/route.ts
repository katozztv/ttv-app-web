import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { bangkokDateStr, buildRollover } from '@/lib/dailyRollover';

export async function GET(req: Request) {
  try {
    // 1. ดึงข้อมูลทุกคน
    const { data: users, error: fetchError } = await supabaseAdmin
      .from('ttv_task')
      .select('*')
      .neq('discord_id', 'none');

    if (fetchError) throw fetchError;

    // วันที่ปัจจุบันเวลาไทย (cron รันที่ 17:00 UTC = 00:00 ไทย)
    const todayStr = bangkokDateStr();

    // 2. อัปเดตข้อมูลทีละคนแต่ทำแบบขนาน (Parallel) เพื่อไม่ให้ติด Timeout
    // buildRollover คืน null ถ้าคนนั้นถูกตัดรอบของวันนี้ไปแล้ว (เช่น cron มาช้า แล้ว webhook ตัดให้ตอนเที่ยงคืนเป๊ะ)
    // จะได้ไม่ล้างเพชร/เวลาไลฟ์ของวันใหม่ที่เริ่มนับไปแล้ว
    const updatePromises = users.flatMap(user => {
      const updateData = buildRollover(user, todayStr, true);
      if (!updateData) return [];
      return [
        supabaseAdmin
          .from('ttv_task')
          .update(updateData)
          .eq('discord_id', user.discord_id),
      ];
    });

    // รอให้การอัปเดตทุกคนเสร็จสิ้นพร้อมๆ กัน
    await Promise.all(updatePromises);

    return NextResponse.json({ success: true, message: 'Daily reset and LP deduction completed' });
  } catch (error: any) {
    console.error('Failed to run daily reset:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
