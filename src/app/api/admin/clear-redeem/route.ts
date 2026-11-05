import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const OWNER_ID = '279905202277187584';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.id !== OWNER_ID) {
      return NextResponse.json({ error: 'Unauthorized. Only OWNER can clear history.' }, { status: 401 });
    }

    // 1. Fetch all users who have redeem history
    const { data: users, error: fetchError } = await supabaseAdmin
      .from('ttv_task')
      .select('tiktok_username, redeem_history')
      .not('redeem_history', 'is', null);

    if (fetchError) {
      throw fetchError;
    }

    let deletedMessages = 0;

    // 2. Iterate and delete Discord messages
    for (const user of users) {
      if (!user.redeem_history) continue;
      
      let history = [];
      try {
         history = typeof user.redeem_history === 'string' ? JSON.parse(user.redeem_history) : user.redeem_history;
      } catch (e) { continue; }

      if (!Array.isArray(history)) continue;

      for (const entry of history) {
        if (entry.messageId) {
          try {
            // Delete message via Webhook
            // DELETE /webhooks/{webhook.id}/{webhook.token}/messages/{message.id}
            const deleteUrl = `${DISCORD_WEBHOOK_URL}/messages/${entry.messageId}`;
            const res = await fetch(deleteUrl, { method: 'DELETE' });
            if (res.ok || res.status === 404) {
               deletedMessages++;
            }
            // Add a small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 200));
          } catch (e) {
            console.error('Failed to delete Discord message:', entry.messageId, e);
          }
        }
      }

      // 3. Clear history for this user
      await supabaseAdmin
        .from('ttv_task')
        .update({ redeem_history: '[]' })
        .eq('tiktok_username', user.tiktok_username);
    }

    return NextResponse.json({ success: true, deletedMessages, clearedUsers: users.length });
  } catch (error: any) {
    console.error('Clear Redeem History Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
