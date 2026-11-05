import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { bangkokDateStr, buildWebhookRollover } from '@/lib/dailyRollover';

// คาดหวัง JSON Body รูปแบบนี้จาก Tikfinity:
// {
//   "tiktok_username": "timezeeev2",
//   "event_type": "diamond" | "live",
//   "amount": 10 // จำนวนเพชรที่ได้รับ (ถ้าเป็น event_type = diamond)
// }

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized access' }, { status: 401 });
    }

    const body = await req.json();
    const { tiktok_username, event_type, amount = 0 } = body;

    if (!tiktok_username) {
      return NextResponse.json({ error: 'Missing tiktok_username' }, { status: 400 });
    }

    // 1. ดึงข้อมูล User ปัจจุบันด้วย tiktok_username
    const { data: users, error: fetchError } = await supabaseAdmin
      .from('ttv_task')
      .select('*')
      .ilike('tiktok_username', tiktok_username) // ไม่สนตัวพิมพ์เล็กใหญ่
      .limit(1);

    let user = users?.[0];

    if (fetchError || !user) {
      return NextResponse.json({ error: 'User not found', details: fetchError ? fetchError.message : 'No user data' }, { status: 404 });
    }

    // 2. จัดการเรื่องเวลา (เช็คการรีเซ็ตเมื่อข้ามวัน GMT+7)
    // หาเวลาปัจจุบันในเขตเวลาไทย
    const nowBkk = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const todayDateStr = bangkokDateStr(); // "YYYY-MM-DD" เวลาไทย

    // ตัดรอบตอนเที่ยงคืนเวลาไทยเป๊ะๆ: ถ้าข้อมูลของ user ยังเป็นของเมื่อวาน (cron ยังไม่ทันรัน/รันช้า)
    // ให้ตัดรอบวัน (และสัปดาห์ถ้าข้ามวันจันทร์) ตรงนี้เลย แล้วนับ event นี้เป็นของวันใหม่
    // cron daily-reset จะข้ามคนที่ last_active_date เป็นวันนี้แล้ว จึงไม่ล้างซ้ำ
    const rollover = buildWebhookRollover(user, todayDateStr);
    if (rollover) user = { ...user, ...rollover };

    let currentDiamonds = user.daily_diamonds || 0;
    let currentLiveCount = user.daily_live_count || 0;
    let currentLiveMinutes = user.daily_live_minutes || 0;
    let missionCompleted = user.mission_completed_today || false;

    // 3. เพิ่มข้อมูลตามประเภทของ Event
    let isLive = user.is_live || false;

    if (event_type === 'diamond') {
      currentDiamonds += Number(amount);
    } else if (event_type === 'live_start') {
      // เริ่มไลฟ์
      currentLiveCount += 1;
      isLive = true;
    } else if (event_type === 'live_end') {
      // ปิดไลฟ์
      isLive = false;
      // หากลงไลฟ์แล้วยังไม่ถึง 60 นาที ให้รีเซ็ตเวลาใหม่หมด
      if (currentLiveMinutes < 60) {
        currentLiveMinutes = 0;
      }
    } else if (event_type === 'live_duration') {
      // นับใน 1 ไลฟ์ จึงใช้ Math.max ป้องกันข้อมูลลดลงถ้าเริ่มไลฟ์ใหม่ แต่ผ่านเกณฑ์ไปแล้ว
      currentLiveMinutes = Math.max(currentLiveMinutes, Number(amount) || 0);
    }

    // 4. ตรวจสอบเงื่อนไขภารกิจ: ไลฟ์ >= 1, เพชร >= 500, เวลาไลฟ์ >= 60 นาที (Base Mission)
    let totalPoints = user.total_points || 0;
    
    let ptsHistory: any[] = [];
    try {
      if (user.pts_history) {
        ptsHistory = typeof user.pts_history === 'string' ? JSON.parse(user.pts_history) : user.pts_history;
      }
    } catch (e) {}
    if (!Array.isArray(ptsHistory)) ptsHistory = [];
    
    // ระบบอีเว้นท์: 100 เพชร = 1 คะแนน (เฉพาะ เสาร์ 00.00 น. - จันทร์ 00.00 น. และอีเวนต์พิเศษ หยุดยาวไฟลุก วันที่ 28-30 ก.ค.)
    if (event_type === 'diamond') {
      const isWeekend = nowBkk.getDay() === 6 || nowBkk.getDay() === 0;
      const isLongHolidayEvent = nowBkk.getFullYear() === 2026 && nowBkk.getMonth() === 6 && (nowBkk.getDate() >= 28 && nowBkk.getDate() <= 30);
      if (isWeekend || isLongHolidayEvent) {
        const oldDiamonds = currentDiamonds - Number(amount);
        // เช็คว่าการได้เพชรครั้งนี้ทำให้ข้ามหลักร้อยหรือไม่
        const earnedEventPoints = Math.floor(currentDiamonds / 100) - Math.floor(oldDiamonds / 100);
        if (earnedEventPoints > 0) {
          totalPoints += earnedEventPoints;
          ptsHistory.push({ reason: 'กิจกรรม 100 เพชร = 1 คะแนน', points: earnedEventPoints, date: nowBkk.toISOString() });
        }
      }
    }
    let totalLp = user.lp || 0;
    let bonusClaimed = user.bonus_claimed_today || false;
    
    let weeklyMissionCount = user.weekly_mission_count || 0;
    let weeklyMissionCompleted = user.weekly_mission_completed || false;
    let shields = user.shields || 0;
    
    // ตรวจสอบเลเวลเพื่อหาเกณฑ์โบนัส
    const getLevel = (lp: number) => {
      if (lp >= 1500) return 4;
      if (lp >= 750) return 3;
      if (lp >= 250) return 2;
      return 1;
    };
    const currentLevel = getLevel(totalLp);
    
    const bonusThresholds = { 1: 999999, 2: 1500, 3: 4500, 4: 13500 };
    const bonusPoints = { 1: 0, 2: 4, 3: 10, 4: 20 };
    
    const targetBonusDiamonds = bonusThresholds[currentLevel as keyof typeof bonusThresholds];
    const rewardBonusPoints = bonusPoints[currentLevel as keyof typeof bonusPoints];
    
    // Check Base Mission
    if (!missionCompleted && currentLiveCount >= 1 && currentDiamonds >= 500 && currentLiveMinutes >= 60) {
      totalPoints += 20;
      totalLp += 50;
      missionCompleted = true; // สำเร็จภารกิจของวันนี้แล้ว
      weeklyMissionCount += 1; // อัปเดตยอดสะสมวันในสัปดาห์
      ptsHistory.push({ reason: 'ภารกิจรายวัน (Base Mission)', points: 20, date: nowBkk.toISOString() });
    }

    // Check Bonus Mission (only if Base is met)
    if (missionCompleted && !bonusClaimed && currentDiamonds >= targetBonusDiamonds) {
      totalPoints += rewardBonusPoints;
      bonusClaimed = true;
      ptsHistory.push({ reason: `ภารกิจโบนัส (เลเวล ${currentLevel})`, points: rewardBonusPoints, date: nowBkk.toISOString() });
    }

    // Check Weekly Mission
    if (weeklyMissionCount >= 5 && !weeklyMissionCompleted) {
      totalPoints += 300;
      shields += 1;
      weeklyMissionCompleted = true;
      ptsHistory.push({ reason: 'ภารกิจรายสัปดาห์', points: 300, date: nowBkk.toISOString() });
    }

    // 5. บันทึกข้อมูลกลับลงฐานข้อมูล
    const { error: updateError } = await supabaseAdmin
      .from('ttv_task')
      .update({
        daily_diamonds: currentDiamonds,
        daily_live_count: currentLiveCount,
        daily_live_minutes: currentLiveMinutes,
        last_active_date: todayDateStr,
        mission_completed_today: missionCompleted,
        bonus_claimed_today: bonusClaimed,
        total_points: totalPoints,
        is_live: isLive,
        lp: totalLp,
        weekly_mission_count: weeklyMissionCount,
        weekly_mission_completed: weeklyMissionCompleted,
        shields: shields,
        pts_history: JSON.stringify(ptsHistory)
      })
      .eq('discord_id', user.discord_id);

    if (updateError) {
      // Fallback in case pts_history column is not created yet
      const { error: retryError } = await supabaseAdmin
        .from('ttv_task')
        .update({
          daily_diamonds: currentDiamonds,
          daily_live_count: currentLiveCount,
          daily_live_minutes: currentLiveMinutes,
          last_active_date: todayDateStr,
          mission_completed_today: missionCompleted,
          bonus_claimed_today: bonusClaimed,
          total_points: totalPoints,
          is_live: isLive,
          lp: totalLp,
          weekly_mission_count: weeklyMissionCount,
          weekly_mission_completed: weeklyMissionCompleted,
          shields: shields
        })
        .eq('discord_id', user.discord_id);
      
      if (retryError) throw retryError;
    }

    return NextResponse.json({ 
      success: true, 
      mission_completed: missionCompleted,
      total_points: totalPoints,
      current_diamonds: currentDiamonds,
      current_live_count: currentLiveCount
    });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
