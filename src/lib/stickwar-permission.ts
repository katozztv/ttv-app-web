export type StickWarMember = {
  discord_id?: string; role?: string | null; access_expires_at?: string | null;
  permissions?: { other_games?: string[]; custom_expirations?: Record<string, string | null> } | null;
};

/** Existing and future LINE UP members qualify without a database backfill. */
export function hasStickWarAccess(member: StickWarMember, now = Date.now()): boolean {
  if (!/^[0-9]{17,20}$/.test(member.discord_id || '')) return false;
  if (member.discord_id === '279905202277187584' || ['ttv', 'ttv_star', 'admin', 'owner'].includes(String(member.role || '').toLowerCase())) return true;
  if (!member.permissions?.other_games?.includes('stick_war')) return false;
  const overrides = member.permissions.custom_expirations;
  const expiry = overrides && Object.hasOwn(overrides, 'stick_war') ? overrides.stick_war : member.access_expires_at;
  return expiry == null || Date.parse(expiry) > now;
}
