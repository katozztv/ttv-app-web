import NextAuth, { NextAuthOptions } from "next-auth"
import DiscordProvider from "next-auth/providers/discord"
import CredentialsProvider from "next-auth/providers/credentials"
import { supabase } from "@/lib/supabase"
import { supabaseAdmin } from "@/lib/supabaseAdmin"
import { TTV_GUILD_ID, ttvRoleFromDiscord, isTtvMember } from "@/lib/ttvRoles"

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID as string,
      clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
      // Discord now returns `iss` on the callback (RFC 9207); openid-client throws
      // "issuer must be configured on the issuer" (OAuthCallback) unless this is set.
      issuer: "https://discord.com",
      authorization: {
        params: {
          scope: "identify guilds guilds.members.read"
        }
      }
    }),
    CredentialsProvider({
      name: 'Guest',
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        hwid: { label: "HWID", type: "text" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password || !credentials?.hwid) return null;
        
        const hwid = credentials.hwid;
        const guestId = `HWID:${hwid}`;
        const username = credentials.username.trim();
        const password = credentials.password;

        if (password !== username) {
          return null;
        }

        try {
          const { data: existingUser } = await supabaseAdmin
            .from('ttv_task')
            .select('*')
            .eq('discord_id', guestId)
            .single();

          if (!existingUser) {
            // New HWID, check if username already taken
            const { data: nameCheck } = await supabaseAdmin
              .from('ttv_task')
              .select('discord_id')
              .eq('discord_username', username)
              .single();

            if (nameCheck) {
              if (nameCheck.discord_id.startsWith('RESET:')) {
                // Claim the reset account with the new HWID
                await supabaseAdmin.from('ttv_task')
                  .update({ discord_id: guestId })
                  .eq('discord_id', nameCheck.discord_id);
                  
                return {
                  id: guestId,
                  name: username,
                  image: null
                };
              }
              return null; // Username taken by someone else
            }

            // Register new guest
            const { error: insertError } = await supabaseAdmin.from('ttv_task').insert({
              discord_id: guestId,
              discord_username: username,
              tiktok_username: username,
              role: 'guest',
              total_points: 0,
              lp: 0
            });
            if (insertError) console.error("Supabase Admin Insert Error:", insertError);
          } else {
            // Existing HWID, check if they are changing to a taken username
            if (existingUser.discord_username !== username) {
              const { data: nameCheck } = await supabaseAdmin
                .from('ttv_task')
                .select('discord_id')
                .eq('discord_username', username)
                .single();

              if (nameCheck && nameCheck.discord_id !== guestId) {
                return null; // Username taken by someone else
              }
              // Update username
              await supabaseAdmin.from('ttv_task')
                .update({ discord_username: username, tiktok_username: username })
                .eq('discord_id', guestId);
            }
          }

          return {
            id: guestId,
            name: username,
            image: null
          };
        } catch (error) {
          console.error("Error with Guest login:", error);
          return null;
        }
      }
    })
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "discord") {
        try {
          // Check if user is in the server
          const res = await fetch(`https://discord.com/api/users/@me/guilds/${TTV_GUILD_ID}/member`, {
            headers: {
              Authorization: `Bearer ${account.access_token}`
            }
          });
          
          if (!res.ok) {
            console.error("User not in server or failed to fetch roles. Status:", res.status);
            return "/unauthorized?error=not_in_server";
          }
          
          const member = await res.json();
          const ttvRole = ttvRoleFromDiscord(member.roles || []);

          // Store it in account so jwt callback can access it
          if (account) {
            (account as any).ttvRole = ttvRole;
          }

          // Keep the DB role in sync with Discord: gaining/losing TTV or TTV STAR
          // updates the badge on next login. Admin/customize roles are left alone.
          if (profile && (profile as any).id) {
            const { data: existing } = await supabaseAdmin
              .from('ttv_task')
              .select('role')
              .eq('discord_id', (profile as any).id)
              .maybeSingle();
            const current = String(existing?.role || '').toLowerCase();
            const canSync = existing && (current === 'user' || current === '' || isTtvMember(current));
            const nextRole = ttvRole || 'user';
            if (canSync && current !== nextRole) {
              await supabaseAdmin.from('ttv_task').update({ role: nextRole }).eq('discord_id', (profile as any).id);
            }
          }

          return true; // Login successful
        } catch (error) {
          console.error("Error fetching Discord member info", error);
          return "/unauthorized?error=server_error";
        }
      }
      return true;
    },
    async jwt({ token, profile, account, user }: any) {
      if (account) {
        token.ttvRole = account.ttvRole;
      }
      if (profile) {
        token.id = profile.id;
        token.name = profile.username; // use discord username
      }
      if (user?.image) {
        token.picture = user.image;
      }
      if (account?.provider === "credentials" && user) {
        token.id = user.id;
        token.name = user.name;
        token.picture = null;
        token.ttvRole = null;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string | null;
        (session.user as any).ttvRole = (token.ttvRole as string | null) ?? null;
      }
      return session;
    }
  },
  pages: {
    signIn: '/',
    error: '/unauthorized'
  },
  secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
