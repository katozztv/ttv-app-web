import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase'; // need this for fallback

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const DISCORD_ADMIN_ID = '279905202277187584';

export async function POST(request: Request) {
  try {
    const { tiktokUsername, pointsToDeduct, couponName, paymentInfo, discordPaymentText } = await request.json();

    if (!tiktokUsername || !pointsToDeduct || !couponName || !paymentInfo) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Fetch user data to check points
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('ttv_task')
      .select('total_points, discord_username, redeem_history, lp')
      .eq('tiktok_username', tiktokUsername)
      .single();

    if (fetchError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const currentPoints = userData.total_points || 0;
    const currentLp = userData.lp || 0;

    // Calculate level and discount
    let level = 1;
    if (currentLp >= 1500) level = 4;
    else if (currentLp >= 750) level = 3;
    else if (currentLp >= 250) level = 2;

    let discountPercent = 0;
    if (level >= 4) discountPercent = 20;
    else if (level === 3) discountPercent = 10;
    else if (level === 2) discountPercent = 5;

    const baseCoupons: Record<string, number> = {
      "คูปอง 200 ฿": 420,
      "คูปอง 400 ฿": 840,
      "คูปอง 600 ฿": 1260,
      "คูปอง 800 ฿": 1680,
      "คูปอง 1,000 ฿": 2100,
    };

    const basePoints = baseCoupons[couponName as string];
    if (!basePoints) {
      return NextResponse.json({ error: 'Invalid coupon name' }, { status: 400 });
    }
    
    const expectedPointsToDeduct = Math.round(basePoints * (1 - discountPercent / 100));

    if (pointsToDeduct !== expectedPointsToDeduct) {
      return NextResponse.json({ error: 'แต้มที่ใช้แลกไม่ตรงกับราคาจริง กรุณารีเฟรชโปรแกรม' }, { status: 400 });
    }

    // 2. Check if user has enough points
    if (currentPoints < expectedPointsToDeduct) {
      return NextResponse.json({ error: 'Not enough points' }, { status: 400 });
    }

    // 3. Deduct points and update payment info
    const newPoints = currentPoints - pointsToDeduct;

    // Parse old history or start new array
    let history: any[] = [];
    try {
      if (userData.redeem_history) {
        history = typeof userData.redeem_history === 'string' 
          ? JSON.parse(userData.redeem_history) 
          : userData.redeem_history;
      }
    } catch (e) {
      // Ignore parse error
    }
    if (!Array.isArray(history)) history = [];

    // Add new history entry
    const newHistoryEntry = {
      coupon: couponName,
      points: pointsToDeduct,
      date: new Date().toISOString()
    };
    history.push(newHistoryEntry);

    const { error: updateError } = await supabaseAdmin
      .from('ttv_task')
      .update({
        total_points: newPoints,
        payment_info: paymentInfo,
        redeem_history: JSON.stringify(history)
      })
      .eq('tiktok_username', tiktokUsername);

    if (updateError) {
      // If payment_info column doesn't exist, we fallback to just updating points
      // so the app doesn't break entirely if the user forgot to add the column
      console.error('Update error (might be missing payment_info column):', updateError);
      
      const { error: retryError } = await supabase
        .from('ttv_task')
        .update({
          total_points: newPoints
        })
        .eq('tiktok_username', tiktokUsername);

      if (retryError) {
        return NextResponse.json({ error: 'Failed to deduct points' }, { status: 500 });
      }
    }

    // 4. Send Discord Webhook
    const discordMessage = {
      content: `<@${DISCORD_ADMIN_ID}> 🔔 **มีการแลกของรางวัลใหม่!** 🔔`,
      embeds: [
        {
          title: "🎁 แจ้งเตือนการแลกคูปองเงินสด",
          color: 0x10b981, // Emerald green
          fields: [
            {
              name: "👤 ผู้แลก (TikTok)",
              value: `\`${tiktokUsername}\``,
              inline: true
            },
            {
              name: "🎮 Discord",
              value: userData.discord_username ? `\`${userData.discord_username}\`` : 'ไม่พบข้อมูล',
              inline: true
            },
            {
              name: "🎟️ คูปองที่แลก",
              value: `**${couponName}** (ใช้ ${pointsToDeduct} Points)`,
              inline: true
            },
            {
              name: "💳 ช่องทางรับเงิน (บัญชี/พร้อมเพย์)",
              value: `\`\`\`\n${discordPaymentText || paymentInfo}\n\`\`\``,
              inline: false
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: "TTV App Auto-Notifier"
          }
        }
      ]
    };

    try {
      const response = await fetch(DISCORD_WEBHOOK_URL + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordMessage)
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.id) {
          // Save message ID to history
          history[history.length - 1].messageId = data.id;
          await supabaseAdmin
            .from('ttv_task')
            .update({ redeem_history: JSON.stringify(history) })
            .eq('tiktok_username', tiktokUsername);
        }
      }
    } catch (discordError) {
      console.error('Failed to send Discord webhook:', discordError);
      // We don't fail the request if Discord fails, since points were already deducted
    }

    return NextResponse.json({ success: true, newPoints, newHistory: history });

  } catch (error: any) {
    console.error('Redeem API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
