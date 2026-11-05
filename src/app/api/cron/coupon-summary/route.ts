import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    // Vercel Cron sends a Bearer token that matches CRON_SECRET if configured.
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      // return new Response('Unauthorized', { status: 401 });
    }

    const now = new Date();
    // Thai Time (UTC+7)
    const thTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const date = thTime.getUTCDate();

    let isStartOfMonth = date === 2;
    let isMidOfMonth = date === 16;

    const url = new URL(request.url);
    const forceRun = url.searchParams.get('force') === '1';
    const forceType = url.searchParams.get('type');

    if (forceRun) {
      if (forceType === 'start') { isStartOfMonth = true; isMidOfMonth = false; }
      if (forceType === 'mid') { isMidOfMonth = true; isStartOfMonth = false; }
    }

    if (!isStartOfMonth && !isMidOfMonth && !forceRun) {
       return NextResponse.json({ message: `Skipping. Today is ${date}th TH time.` });
    }

    let startDate: Date;
    let endDate: Date;

    if (isStartOfMonth) {
      let y = thTime.getUTCFullYear();
      let m = thTime.getUTCMonth(); 
      if (m === 0) {
         m = 11;
         y -= 1;
      } else {
         m -= 1;
      }
      startDate = new Date(Date.UTC(y, m, 15, 17, 0, 0));
      endDate = new Date(Date.UTC(thTime.getUTCFullYear(), thTime.getUTCMonth(), 1, 17, 0, 0));
    } else {
      startDate = new Date(Date.UTC(thTime.getUTCFullYear(), thTime.getUTCMonth(), 1, 17, 0, 0));
      endDate = new Date(Date.UTC(thTime.getUTCFullYear(), thTime.getUTCMonth(), 15, 17, 0, 0));
    }

    const { data: users, error } = await supabaseAdmin
      .from('ttv_task')
      .select('tiktok_username, discord_username, payment_info, redeem_history')
      .not('redeem_history', 'is', null);

    if (error) throw error;

    let totalPointsRedeemed = 0;
    let totalCashRedeemed = 0;
    let summaryRows: string[] = [];
    let couponCounts: Record<string, number> = {};

    for (const user of users) {
      if (!user.redeem_history) continue;
      
      let history = [];
      try {
         history = typeof user.redeem_history === 'string' ? JSON.parse(user.redeem_history) : user.redeem_history;
      } catch (e) { continue; }

      if (!Array.isArray(history)) continue;

      let userTotalPoints = 0;
      let userTotalCash = 0;
      let userCoupons = [];

      for (const entry of history) {
        const entryDate = new Date(entry.date);
        if (entryDate >= startDate && entryDate < endDate) {
           userTotalPoints += (entry.points || 0);
           userCoupons.push(entry.coupon);
           
           couponCounts[entry.coupon] = (couponCounts[entry.coupon] || 0) + 1;

           const match = entry.coupon.match(/\d+(,\d+)?/);
           if (match) {
              const cash = parseInt(match[0].replace(/,/g, ''), 10);
              totalCashRedeemed += cash;
              userTotalCash += cash;
           }
        }
      }

      if (userTotalPoints > 0) {
         totalPointsRedeemed += userTotalPoints;
         
         let pInfo = { bank: 'Unknown', account_no: 'Unknown', account_name: 'Unknown' };
         try {
            if (user.payment_info) pInfo = JSON.parse(user.payment_info);
         } catch(e) {
            pInfo.account_no = user.payment_info;
         }

         let bankDisplay = pInfo.bank;
         if (pInfo.bank === 'promptpay') bankDisplay = 'พร้อมเพย์';

         summaryRows.push(`**${user.tiktok_username}** ${user.discord_username ? `(<@${user.discord_username}>)` : ''}`);
         summaryRows.push(`🎫 คูปอง: ${userCoupons.join(', ')}`);
         summaryRows.push(`🎫 คูปองรวม: ${userTotalCash.toLocaleString()} ฿`);
         summaryRows.push(`💰 รวมแต้มที่ใช้: ${userTotalPoints.toLocaleString()} Points`);
         summaryRows.push(`🏦 ชำระที่: ${bankDisplay} | \`${pInfo.account_no}\` | ${pInfo.account_name}`);
         summaryRows.push(`----------------------------------------`);
      }
    }

    if (summaryRows.length === 0) {
      return NextResponse.json({ message: 'No redemptions in this period' });
    }

    const title = isStartOfMonth ? "📊 สรุปยอดแลกคูปองประจำครึ่งเดือนหลัง (วันที่ 16 - 1)" : "📊 สรุปยอดแลกคูปองประจำครึ่งเดือนแรก (วันที่ 2 - 15)";

    const chunks = [];
    let currentChunk = "";
    for (const row of summaryRows) {
       if (currentChunk.length + row.length > 3900) {
          chunks.push(currentChunk);
          currentChunk = "";
       }
       currentChunk += row + "\n";
    }
    if (currentChunk) chunks.push(currentChunk);

    let couponSummaryText = "📦 **สรุปจำนวนคูปองที่ถูกแลกทั้งหมด**\n";
    let totalCoupons = 0;
    for (const [name, count] of Object.entries(couponCounts)) {
        couponSummaryText += `- ${name}: ${count} ใบ\n`;
        totalCoupons += count;
    }
    couponSummaryText += `**รวมทั้งหมด: ${totalCoupons} ใบ**\n`;

    for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        let description = chunks[i];
        if (isLast) {
           description += `\n\n${couponSummaryText}`;
        }

        const discordMessage = {
          content: i === 0 ? `🔔 **[TTV] ${title}** 🔔` : undefined,
          embeds: [
            {
              color: 0xfacc15,
              description: description,
              footer: isLast ? { text: `สรุปรวมใช้แต้มไป: ${totalPointsRedeemed.toLocaleString()} Points (~${totalCashRedeemed.toLocaleString()} บาท)` } : undefined
            }
          ]
        };

        await fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordMessage)
        });
    }

    return NextResponse.json({ success: true, count: summaryRows.length / 5 });

  } catch (error: any) {
    console.error('Coupon Summary Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
