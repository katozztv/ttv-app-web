import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { hasStickWarAccess } from '@/lib/stickwar-permission';

const OWNER_ID = '279905202277187584'; // Same owner as TTV APP.
const ID = /^[0-9]{17,20}$/;
const DEVICE = /^[a-f0-9]{64}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
type Ticket = { kind: 'grant' | 'session'; sub: string; device: string; expires: number; sourceToken: string; challenge?: string };
export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) throw new AccessError(503, 'ระบบเข้าสู่เกมยังไม่พร้อม');
  return createHash('sha256').update('stickwar-lineup-access-v1\0' + secret).digest();
}
export function seal(ticket: Ticket): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(Buffer.from('stickwar-lineup-v1'));
  const data = Buffer.concat([cipher.update(JSON.stringify(ticket), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url');
}
export function unseal(token: unknown, kind: Ticket['kind'], device: unknown): Ticket {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token) || typeof device !== 'string' || !DEVICE.test(device)) throw new AccessError(401, 'ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');
  const secret = key();
  try {
    const data = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', secret, data.subarray(0, 12));
    decipher.setAAD(Buffer.from('stickwar-lineup-v1')); decipher.setAuthTag(data.subarray(12, 28));
    const ticket: Ticket = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
    if (ticket.kind !== kind || ticket.device !== device || !ID.test(ticket.sub) || !Number.isFinite(ticket.expires)
      || ticket.expires <= Date.now() || !/^sw_src_[a-f0-9]{64}$/.test(ticket.sourceToken)) throw new Error();
    return ticket;
  } catch { throw new AccessError(401, 'เซสชันไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
}
export async function entitlement(id: unknown) {
  if (typeof id !== 'string' || !ID.test(id)) throw new AccessError(403, 'ใช้บัญชี Discord ที่มีสิทธิ์ TTV เท่านั้น');
  const { data, error } = await supabaseAdmin.from('ttv_task').select('role, discord_username, tiktok_username, permissions, access_expires_at').eq('discord_id', id).maybeSingle();
  if (error) throw new AccessError(503, 'ติดต่อระบบสิทธิ์ TTV ไม่สำเร็จ');
  if (!hasStickWarAccess({ ...data, discord_id: id })) throw new AccessError(403, 'บัญชีนี้ไม่มีสิทธิ์ Stick WAR กรุณาติดต่อแอดมิน TTV APP');
  const username = String(data?.tiktok_username || '').trim().replace(/^@/, '').toLowerCase();
  if (username && (!/^[a-z0-9._]{1,24}$/.test(username) || username.endsWith('.'))) throw new AccessError(403, 'ชื่อ TikTok ใน TTV APP ไม่ถูกต้อง กรุณาติดต่อแอดมิน');
  return { id, label: String(data?.discord_username || 'สมาชิก TTV').slice(0, 120), username: username || null };
}
export function authorizationInput(values: URLSearchParams | FormData) {
  const state = String(values.get('state') || ''), challenge = String(values.get('challenge') || '');
  const device = String(values.get('device') || ''), redirect = String(values.get('redirect') || '');
  let callback: URL;
  try { callback = new URL(redirect); } catch { throw new AccessError(400, 'ที่อยู่กลับเกมไม่ถูกต้อง'); }
  if (!DEVICE.test(state) || !DEVICE.test(device) || !CHALLENGE.test(challenge) || callback.protocol !== 'http:'
    || callback.hostname !== '127.0.0.1' || !callback.port || Number(callback.port) < 1024
    || callback.pathname !== '/api/lineup/callback' || callback.username || callback.password || callback.search || callback.hash) throw new AccessError(400, 'คำขอเข้าเกมไม่ถูกต้อง');
  return { state, challenge, device, redirect };
}
export async function grantAccess(id: unknown, input: ReturnType<typeof authorizationInput>) {
  const member = await entitlement(id);
  // Existing Stick WAR leaderboard RPC: no PASS/license or extra database migration.
  const { data, error } = await supabaseAdmin.rpc('stickwar_create_source', { p_name: ('LINE UP · ' + member.id + ' · ' + input.device.slice(0, 12)).slice(0, 120) });
  if (error || !/^sw_src_[a-f0-9]{64}$/.test(data?.sourceToken || '')) throw new AccessError(503, 'ระบบคะแนน Stick WAR ยังไม่พร้อม กรุณาติดต่อผู้ดูแล');
  return seal({ kind: 'grant', sub: member.id, device: input.device, challenge: input.challenge, expires: Date.now() + 90_000, sourceToken: data.sourceToken });
}
export async function validateAccess(ticket: Ticket) {
  const member = await entitlement(ticket.sub);
  return { valid: true, licenseId: 'lineup:' + member.id, label: member.label, username: member.username, sourceToken: ticket.sourceToken,
    expiresAt: new Date(ticket.expires).toISOString() };
}
export async function exchangeAccess(body: Record<string, unknown>) {
  const grant = unseal(body.grant, 'grant', body.machineId);
  if (typeof body.verifier !== 'string' || !CHALLENGE.test(body.verifier)
    || createHash('sha256').update(body.verifier).digest('base64url') !== grant.challenge) throw new AccessError(401, 'คำขอไม่ตรงกับเครื่องที่เริ่มเข้าสู่ระบบ');
  const session: Ticket = { kind: 'session', sub: grant.sub, device: grant.device, expires: Date.now() + 30 * 86400_000, sourceToken: grant.sourceToken };
  return { ...await validateAccess(session), sessionToken: seal(session) };
}
export const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export function failure(error: unknown): Response {
  return Response.json({ error: error instanceof AccessError ? error.message : 'ระบบเข้าเกมไม่พร้อม กรุณาลองใหม่' }, { status: error instanceof AccessError ? error.status : 503, headers });
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json') || Number(request.headers.get('content-length')) > 8192) throw new AccessError(400, 'ข้อมูลไม่ถูกต้อง');
  const text = await request.text(); if (text.length > 8192) throw new AccessError(400, 'ข้อมูลมากเกินไป');
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    if (body.protocol !== 1) throw new AccessError(426, 'กรุณาอัปเดต Stick WAR และ TTV APP เป็นเวอร์ชันล่าสุด');
    return body; }
  catch (error) { if (error instanceof AccessError) throw error; throw new AccessError(400, 'ข้อมูลไม่ถูกต้อง'); }
}
