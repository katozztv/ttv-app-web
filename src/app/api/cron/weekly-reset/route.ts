import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: Request) {
  try {
    // รีเซ็ตค่าภารกิจรายสัปดาห์
    const { error } = await supabaseAdmin
      .from('ttv_task')
      .update({ weekly_mission_count: 0, weekly_mission_completed: false })
      .neq('discord_id', 'none');

    if (error) {
      console.error('Failed to reset weekly mission:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Weekly points reset successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
