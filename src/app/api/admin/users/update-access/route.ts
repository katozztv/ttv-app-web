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
    const { discord_id, access_expires_at, role, permissions } = body;

    if (!discord_id) {
      return NextResponse.json({ error: 'Missing discord_id' }, { status: 400 });
    }

    if (discord_id === OWNER_ID) {
      return NextResponse.json({ error: 'Cannot modify Owner' }, { status: 403 });
    }

    // Fetch target user's role
    const { data: targetUser } = await supabaseAdmin
      .from('ttv_task')
      .select('role')
      .eq('discord_id', discord_id)
      .single();

    const updateData: any = {};
    if (access_expires_at !== undefined) {
      updateData.access_expires_at = access_expires_at;
    }
    
    if (role !== undefined) {
      updateData.role = role;
    }

    if (permissions !== undefined) {
      updateData.permissions = permissions;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No data to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('ttv_task')
      .update(updateData)
      .eq('discord_id', discord_id);

    if (error) {
      console.error('Failed to update access/role:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Updated successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
