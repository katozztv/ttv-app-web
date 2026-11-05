// ตัดรอบวัน/สัปดาห์ตามเวลาไทย (UTC+7) ใช้ร่วมกันระหว่าง cron daily-reset กับ webhook TikTok
// หลักการ: ตัดรอบที่ 00:00 เวลาไทยเป๊ะๆ โดยอิงวันที่ใน last_active_date
//  - ถ้า cron รันช้ากว่าเที่ยงคืน (Vercel cron ไม่การันตีนาทีที่รัน) event แรกหลังเที่ยงคืนจะตัดรอบให้เอง
//  - cron ข้ามคนที่ตัดรอบของวันนี้ไปแล้ว (last_active_date = วันนี้) จึงไม่ล้างข้อมูลที่เริ่มนับใหม่ซ้ำ

const DAY_MS = 24 * 60 * 60 * 1000;
const TH_OFFSET_MS = 7 * 60 * 60 * 1000;

// วันที่ปัจจุบันเวลาไทย รูปแบบ "YYYY-MM-DD"
export function bangkokDateStr(ms: number = Date.now()): string {
  return new Date(ms + TH_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

// วันจันทร์ที่เป็นจุดเริ่มสัปดาห์ของวันที่นั้น (สัปดาห์เริ่มวันจันทร์ 00:00 เวลาไทย)
function weekStart(dateStr: string): string {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0 = อาทิตย์
  return addDays(dateStr, -((dow + 6) % 7));
}

export type RolloverSource = {
  last_active_date?: string | null;
  mission_completed_today?: boolean | null;
  is_live?: boolean | null;
  lp?: number | null;
  shields?: number | null;
};

// คืนค่าฟิลด์ที่ต้องอัปเดตเมื่อข้ามวัน หรือ null ถ้าตัดรอบของวันนี้ไปแล้ว
// penalizeMissed: หักโล่/LP ถ้าเมื่อวานทำภารกิจไม่สำเร็จ
export function buildRollover(
  user: RolloverSource,
  todayStr: string,
  penalizeMissed: boolean
): Record<string, any> | null {
  const lastActive = user.last_active_date || '2000-01-01';
  if (lastActive === todayStr) return null;

  let lp = user.lp || 0;
  let shields = user.shields || 0;
  if (penalizeMissed && !user.mission_completed_today) {
    if (shields > 0) {
      shields -= 1; // หักโล่แทน
    } else {
      lp = Math.max(0, lp - 100); // หัก LP
    }
  }

  // คนที่กำลังไลฟ์ข้ามเที่ยงคืนอยู่ ให้นับเป็นไลฟ์ของวันใหม่ทันที (เพชร/เวลาเริ่มนับใหม่จาก 0)
  const stillLive = !!user.is_live;

  const updateData: Record<string, any> = {
    daily_diamonds: 0,
    daily_live_count: stillLive ? 1 : 0,
    daily_live_minutes: 0,
    mission_completed_today: false,
    bonus_claimed_today: false,
    is_live: stillLive,
    lp,
    shields,
    last_active_date: todayStr,
  };

  // ข้ามสัปดาห์ (ผ่านเที่ยงคืนวันอาทิตย์ → จันทร์) รีเซ็ตภารกิจรายสัปดาห์
  if (weekStart(todayStr) !== weekStart(lastActive)) {
    updateData.weekly_mission_count = 0;
    updateData.weekly_mission_completed = false;
  }

  return updateData;
}

// ใช้ใน webhook: หักโล่/LP เฉพาะกรณีเมื่อวานเป็นวันล่าสุดที่ถูกบันทึกเท่านั้น
// (ถ้าห่างกว่านั้น cron เคยหักไปแล้ว กันหักซ้ำ)
export function buildWebhookRollover(user: RolloverSource, todayStr: string): Record<string, any> | null {
  const lastActive = user.last_active_date || '2000-01-01';
  return buildRollover(user, todayStr, lastActive === addDays(todayStr, -1));
}
