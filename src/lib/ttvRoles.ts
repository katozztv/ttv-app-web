// Discord roles (same guild as LINE UP) that unlock TTV App.
// Both tiers get identical features; only the badge differs.
export const TTV_GUILD_ID = "1433434950476238973";
export const TTV_ROLE_ID = "1566059578632704100";
export const TTV_STAR_ROLE_ID = "1566059732442288258";

export type TtvRole = "ttv" | "ttv_star";

export function ttvRoleFromDiscord(roles: string[]): TtvRole | null {
  if (roles.includes(TTV_STAR_ROLE_ID)) return "ttv_star";
  if (roles.includes(TTV_ROLE_ID)) return "ttv";
  return null;
}

export function isTtvMember(role?: string | null) {
  return ["ttv", "ttv_star"].includes(String(role || "").toLowerCase());
}

export function ttvBadgeLabel(role?: string | null) {
  const r = String(role || "").toLowerCase();
  if (r === "ttv_star") return "TTV STAR";
  if (r === "ttv") return "TTV";
  return null;
}
