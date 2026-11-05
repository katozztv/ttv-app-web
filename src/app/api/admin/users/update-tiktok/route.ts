import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const OWNER_ID = '279905202277187584';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: currentUser } = await supabaseAdmin
      .from('ttv_task')
      .select('role')
      .eq('discord_id', session.user.id)
      .single();

    const isOwner = session.user.id === OWNER_ID;
    const isAdmin = currentUser?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { discord_id, tiktok_username } = body;

    if (!discord_id || tiktok_username === undefined) {
      return NextResponse.json({ error: 'Missing discord_id or tiktok_username' }, { status: 400 });
    }

    if (discord_id === OWNER_ID) {
      return NextResponse.json({ error: 'Cannot modify Owner' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('ttv_task')
      .update({ tiktok_username })
      .eq('discord_id', discord_id);

    if (error) {
      console.error('Failed to update tiktok:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Updated successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
