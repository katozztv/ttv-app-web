import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tiktok_username, discord_id, discord_username } = await req.json();

    if (!tiktok_username || !discord_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Security check: ensure the user is only creating an entry for their own discord_id
    if (session.user.id !== discord_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if another user already claimed this tiktok username
    const { data: existingUser } = await supabaseAdmin
      .from('ttv_task')
      .select('discord_id')
      .eq('tiktok_username', tiktok_username)
      .neq('discord_id', discord_id)
      .single();

    if (existingUser) {
      return NextResponse.json({ error: `ชื่อ TikTok @${tiktok_username} ถูกเชื่อมต่อกับบัญชีดิสคอร์ดอื่นไปแล้วครับ กรุณาใช้ชื่ออื่น`, code: 'ALREADY_EXISTS' }, { status: 400 });
    }
    
    const ttvRole = (session.user as any).ttvRole as string | null;
    const userRole = ttvRole === 'ttv_star' || ttvRole === 'ttv' ? ttvRole : 'user';
    
    const basePermissions: any = {
      apps: ["counter", "gifts", "game"],
      games: ["minecraft", "roblox", "other"],
      roblox_games: ["pizza_speed", "donkey_smash", "build_block", "line_up_jump"],
      other_games: ["block_pvp", "pirate_wars"]
    };

    if (userRole !== 'user') {
      basePermissions.apps.push("sound", "decoration", "keyboard_sound");
      basePermissions.other_games.push("spouge_bob");
    }

    const { error } = await supabaseAdmin
      .from('ttv_task')
      .upsert({ 
        discord_id: discord_id, 
        discord_username: discord_username,
        tiktok_username: tiktok_username,
        role: userRole,
        permissions: basePermissions
      });
      
    if (error) {
      console.error('Supabase Upsert Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('User Create Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
