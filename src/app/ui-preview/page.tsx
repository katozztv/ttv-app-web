import { notFound } from "next/navigation";
import Dashboard from "@/components/Dashboard";

// Local-only UI preview with a fake TTV STAR user; never served in production.
export default function UiPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  const user = {
    discord_id: "000000000000000000",
    discord_username: "ttv_demo",
    tiktok_username: "ttv_demo",
    role: "ttv_star",
    total_points: 1250,
    lp: 340,
    shields: 2,
    daily_diamonds: 820,
    daily_live_minutes: 75,
    weekly_mission_count: 3,
    permissions: {
      apps: ["counter", "gifts", "game", "sound", "keyboard_sound", "decoration"],
      games: ["minecraft", "roblox", "other"],
      roblox_games: ["pizza_speed", "donkey_smash", "build_block", "line_up_jump"],
      other_games: ["block_pvp", "pirate_wars", "spouge_bob"],
    },
  };

  return <Dashboard user={user} sessionUser={{ id: user.discord_id, name: "TTV Demo", image: null }} />;
}
