'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LogOut, UserCircle, Users, Trophy, Target, Video, CheckCircle2, Flame, Activity, Gift, X, Gamepad2, Download, Play, ChevronLeft, Box, Loader2, Trash2, Shield, Timer, Sparkles, Check, Copy, Settings, Square, Search, Star } from 'lucide-react';
import Swal from 'sweetalert2';
import KeyboardSoundSystem from './KeyboardSoundSystem';
import StickWarCard from './StickWarCard';
import { hasStickWarAccess } from '@/lib/stickwar-permission';
import { ttvBadgeLabel } from '@/lib/ttvRoles';

function TtvBadge({ role }: { role?: string | null }) {
  const label = ttvBadgeLabel(role);
  if (!label) return <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-800 text-zinc-400">ยังไม่มียศ</span>;
  const star = label === 'TTV STAR';
  return (
    <span className={`inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-black tracking-wide ${star ? 'bg-gradient-to-r from-yellow-300 to-amber-500 text-black shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 'bg-yellow-400/15 text-yellow-300 border border-yellow-400/40'}`}>
      {star && '★'} {label}
    </span>
  );
}

import { supabase } from '@/lib/supabase';

// ป้าย NEW แสดงแค่ 3 วัน นับจากวันที่เพิ่มเกมใหม่ (19 ก.ย. 2026) แล้วหายเองอัตโนมัติ
const NEW_BADGE_UNTIL = new Date('2026-09-22T00:00:00+07:00').getTime();

let sharedAudioCtx: AudioContext | null = null;
const audioBufferCache = new Map<string, AudioBuffer>();

const preloadAudio = async (src: string) => {
  if (audioBufferCache.has(src)) return;
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const res = await fetch(src);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = await sharedAudioCtx.decodeAudioData(arrayBuffer);
    audioBufferCache.set(src, buffer);
  } catch (e) {
    console.error("Failed to preload audio:", src, e);
  }
};

// --- Web Audio API & Queue System ---
interface SoundQueueItem {
  src: string;
  volumePercent: number;
}
const soundQueue: SoundQueueItem[] = [];
let isSoundQueuePlaying = false;
let currentGiftPlayingSource: AudioBufferSourceNode | null = null;

if (typeof window !== 'undefined') {
  (window as any).giftSoundMode = (window as any).giftSoundMode || 'queue';
}

// Every refresh re-queries Supabase on the server; a busy live fires tracker updates every ~2s
const MIN_REFRESH_INTERVAL_MS = 8000;
// preload's onTrackerUpdate can't be unsubscribed, so attach it once per page load and
// point it at whichever Dashboard is mounted (avoids stacked listeners after a remount)
let trackerUpdateHandler: (() => void) | null = null;
let isTrackerUpdateListenerAttached = false;

const playGiftAudio = async (item: SoundQueueItem, isQueueMode: boolean) => {
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (sharedAudioCtx.state === 'suspended') {
      await sharedAudioCtx.resume();
    }
    
    let buffer = audioBufferCache.get(item.src);
    if (!buffer) {
      const res = await fetch(item.src);
      const arrayBuffer = await res.arrayBuffer();
      buffer = await sharedAudioCtx.decodeAudioData(arrayBuffer);
      audioBufferCache.set(item.src, buffer);
    }

    const source = sharedAudioCtx.createBufferSource();
    source.buffer = buffer;

    const gainNode = sharedAudioCtx.createGain();
    gainNode.gain.value = item.volumePercent / 100;
    
    source.connect(gainNode);
    gainNode.connect(sharedAudioCtx.destination);
    
    source.onended = () => {
      if (isQueueMode) {
        playNextInQueue();
      }
    };

    currentGiftPlayingSource = source;
    source.start(0);
  } catch (e) {
    console.error("Audio Queue Error:", e);
    if (isQueueMode) {
      playNextInQueue();
    }
  }
};

const playNextInQueue = async () => {
  if (soundQueue.length === 0) {
    isSoundQueuePlaying = false;
    return;
  }
  isSoundQueuePlaying = true;
  const item = soundQueue.shift();
  if (!item) {
    isSoundQueuePlaying = false;
    return;
  }
  playGiftAudio(item, true);
};

function playWithGain(src: string, volumePercent: number): { play: () => Promise<void> } {
  return {
    play: async () => {
      const mode = typeof window !== 'undefined' ? (window as any).giftSoundMode || 'queue' : 'queue';
      
      if (mode === 'queue') {
        const sameSoundCount = soundQueue.filter(i => i.src === src).length;
        if (sameSoundCount >= 5) return; 

        soundQueue.push({ src, volumePercent });
        if (!isSoundQueuePlaying) {
          playNextInQueue();
        }
      } else if (mode === 'overlap') {
        playGiftAudio({ src, volumePercent }, false);
      } else if (mode === 'interrupt') {
        if (currentGiftPlayingSource) {
           try { currentGiftPlayingSource.stop(); } catch(e) {}
        }
        playGiftAudio({ src, volumePercent }, false);
      }
    }
  };
}


// --- Siri Queue System ---
interface SiriQueueItem {
  text: string;
  vol: number;
  timestamp: number;
}
const siriQueue: SiriQueueItem[] = [];
let isSiriPlaying = false;

const processSiriQueue = async () => {
  if (isSiriPlaying) return;
  if (siriQueue.length === 0) return;

  isSiriPlaying = true;
  
  let item = siriQueue.shift();
  // Drop items older than 5 seconds
  while (item && (Date.now() - item.timestamp > 5000)) {
    console.log("Siri queue item dropped due to timeout:", item.text);
    item = siriQueue.shift();
  }

  if (!item) {
    isSiriPlaying = false;
    return;
  }

  try {
    let audio: HTMLAudioElement | null = null;
    if (window.electron && window.electron.fetchTTS) {
      const base64Audio = await window.electron.fetchTTS(item.text);
      if (base64Audio) {
        audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
      }
    } 
    
    if (!audio) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(item.text)}&tl=th&client=tw-ob`;
      audio = new Audio(url);
    }

    audio.volume = item.vol / 100;
    
    audio.onended = () => {
      isSiriPlaying = false;
      processSiriQueue();
    };
    audio.onerror = () => {
      console.error("Siri Play Error");
      isSiriPlaying = false;
      processSiriQueue();
    };

    await audio.play();
  } catch (e) {
    console.error("Siri Error:", e);
    isSiriPlaying = false;
    processSiriQueue();
  }
};

// --- Countdown Hook ---
interface CountdownParts { days: number; hours: number; minutes: number; seconds: number; }

function useCountdown() {
  const [daily, setDaily] = useState<CountdownParts>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [weekly, setWeekly] = useState<CountdownParts>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [eventCountdown, setEventCountdown] = useState<CountdownParts>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [eventStatus, setEventStatus] = useState<'upcoming' | 'ongoing' | 'ended'>('upcoming');
  const [longHolidayCountdown, setLongHolidayCountdown] = useState<CountdownParts>({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [longHolidayStatus, setLongHolidayStatus] = useState<'upcoming' | 'ongoing' | 'ended'>('upcoming');

  const toParts = (ms: number): CountdownParts => {
    if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const totalSec = Math.floor(ms / 1000);
    return {
      days: Math.floor(totalSec / 86400),
      hours: Math.floor((totalSec % 86400) / 3600),
      minutes: Math.floor((totalSec % 3600) / 60),
      seconds: totalSec % 60,
    };
  };

  const tick = useCallback(() => {
    const now = new Date();
    const thOffset = 7 * 60 * 60 * 1000;
    const nowTH = new Date(now.getTime() + thOffset);

    // Daily: next midnight Thailand time
    const nextDailyTH = new Date(Date.UTC(
      nowTH.getUTCFullYear(), nowTH.getUTCMonth(), nowTH.getUTCDate() + 1
    ));
    setDaily(toParts(nextDailyTH.getTime() - thOffset - now.getTime()));

    // Weekly: next Monday 00:00 Thailand time
    const dayOfWeek = nowTH.getUTCDay();
    // ถ้าเป็นวันจันทร์ (1) ให้เหลือ 7 วัน, วันอื่นๆ ให้เอา (8 - วันปัจจุบัน) แบบ modulo 7
    // วันจันทร์ (1) -> 7, วันอังคาร (2) -> 6, ..., วันเสาร์ (6) -> 2, วันอาทิตย์ (0) -> 1
    const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 || 7;
    const nextMondayTH = new Date(Date.UTC(
      nowTH.getUTCFullYear(), nowTH.getUTCMonth(), nowTH.getUTCDate() + daysUntilMonday
    ));
    setWeekly(toParts(nextMondayTH.getTime() - thOffset - now.getTime()));

    // Special Event: Weekend Event (Saturday 00:00 - Monday 00:00)
    // ถ้าวันนี้เป็นวันอาทิตย์ (0) ให้โยงไปหาวันเสาร์ที่ผ่านมาคือ -1 วัน
    const daysToSat = dayOfWeek === 6 ? 0 : (dayOfWeek === 0 ? -1 : 6 - dayOfWeek);
    const eventStartTH = new Date(Date.UTC(
      nowTH.getUTCFullYear(), nowTH.getUTCMonth(), nowTH.getUTCDate() + daysToSat, 0, 0, 0
    ));
    // สิ้นสุดเช้าวันจันทร์เวลา 00:00 (วันเสาร์ + 2 วัน)
    const eventEndTH = new Date(Date.UTC(
      nowTH.getUTCFullYear(), nowTH.getUTCMonth(), nowTH.getUTCDate() + daysToSat + 2, 0, 0, 0
    ));

    const startTimeActual = eventStartTH.getTime() - thOffset;
    const endTimeActual = eventEndTH.getTime() - thOffset;
    const nowTimeActual = now.getTime();

    if (nowTimeActual < startTimeActual) {
      setEventStatus('upcoming');
      setEventCountdown(toParts(startTimeActual - nowTimeActual));
    } else if (nowTimeActual < endTimeActual) {
      setEventStatus('ongoing');
      setEventCountdown(toParts(endTimeActual - nowTimeActual));
    } else {
      setEventStatus('ended');
      setEventCountdown(toParts(0));
    }

    // Special Event 2: Long Holiday Event (หยุดยาวไฟลุก: 28-30 ก.ค. 2026)
    // เริ่ม 28 ก.ค. 2026 00:00:00 TH (27 ก.ค. 17:00:00 UTC)
    // สิ้นสุด 30 ก.ค. 2026 23:59:59 TH (คือ 31 ก.ค. 2026 00:00:00 TH หรือ 30 ก.ค. 17:00:00 UTC)
    const longHolidayStartTH = new Date(Date.UTC(2026, 6, 28, 0, 0, 0));
    const longHolidayEndTH = new Date(Date.UTC(2026, 6, 31, 0, 0, 0));
    const lhStartTimeActual = longHolidayStartTH.getTime() - thOffset;
    const lhEndTimeActual = longHolidayEndTH.getTime() - thOffset;

    if (nowTimeActual < lhStartTimeActual) {
      setLongHolidayStatus('upcoming');
      setLongHolidayCountdown(toParts(lhStartTimeActual - nowTimeActual));
    } else if (nowTimeActual < lhEndTimeActual) {
      setLongHolidayStatus('ongoing');
      setLongHolidayCountdown(toParts(lhEndTimeActual - nowTimeActual));
    } else {
      setLongHolidayStatus('ended');
      setLongHolidayCountdown(toParts(0));
    }
  }, []);

  useEffect(() => {
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [tick]);

  return { daily, weekly, eventCountdown, eventStatus, longHolidayCountdown, longHolidayStatus };
}

// --- Countdown Display Component ---
function CountdownBoxes({ parts, color = 'zinc', showDays = true }: { parts: CountdownParts; color?: 'zinc' | 'indigo' | 'amber' | 'pink' | 'fuchsia' | 'rose' | 'orange'; showDays?: boolean }) {
  const allUnits = [
    { label: 'วัน', value: parts.days },
    { label: 'ชั่วโมง', value: parts.hours },
    { label: 'นาที', value: parts.minutes },
    { label: 'วินาที', value: parts.seconds },
  ];
  const units = showDays ? allUnits : allUnits.slice(1);
  const styles = {
    zinc: { box: 'bg-zinc-800/80 border-zinc-700/60 text-zinc-300', sep: 'text-zinc-500' },
    indigo: { box: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300', sep: 'text-yellow-400' },
    amber: { box: 'bg-amber-500/10 border-amber-500/40 text-amber-300', sep: 'text-amber-500' },
    pink: { box: 'bg-amber-500/10 border-amber-500/40 text-amber-300', sep: 'text-amber-500' },
    fuchsia: { box: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-300', sep: 'text-yellow-500' },
    rose: { box: 'bg-rose-500/10 border-rose-500/40 text-rose-300', sep: 'text-rose-500' },
    orange: { box: 'bg-amber-500/15 border-amber-500/40 text-amber-300', sep: 'text-amber-500' },
  };
  const s = styles[color];
  return (
    <div className="flex items-center gap-1">
      {units.map((u, i) => (
        <div key={u.label} className="flex items-center gap-1">
          <div className={`flex flex-col items-center px-1.5 py-0.5 rounded border ${s.box} min-w-[30px]`}>
            <span className="font-mono text-[13px] font-bold leading-tight">{String(u.value).padStart(2, '0')}</span>
            <span className="text-[8px] opacity-60 leading-tight">{u.label}</span>
          </div>
          {i < units.length - 1 && <span className={`text-[11px] font-bold opacity-40 ${s.sep}`}>:</span>}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ user, sessionUser }: { user: any, sessionUser: any }) {
  const [view, setView] = useState<'dashboard' | 'counter' | 'game' | 'gifts' | 'admin' | 'sound' | 'keyboard_sound' | 'decoration'>('dashboard');
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminFilterApp, setAdminFilterApp] = useState('all');
  const [adminFilterGroup, setAdminFilterGroup] = useState('all');
  const [contextMenu, setContextMenu] = useState<{ userId: string, x: number, y: number } | null>(null);
  const [permissionModal, setPermissionModal] = useState<{ userId: string, duration: number | null, apps: string[], games: string[], roblox_games: string[], minecraft_games: string[], other_games: string[], custom_expirations: Record<string, string | null> } | null>(null);
  const { daily, weekly, eventCountdown, eventStatus, longHolidayCountdown, longHolidayStatus } = useCountdown();

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const fetchAdminUsers = async () => {
    setIsLoadingAdmin(true);
    try {
      const res = await fetch(`/api/admin/users?t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setAdminUsers(data.users);
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoadingAdmin(false);
  };

  const updateUserAccess = async (discordId: string, days: number | null) => {
    try {
      let expiresAt = null;
      if (days !== null) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        expiresAt = date.toISOString();
      }

      const res = await fetch('/api/admin/users/update-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_id: discordId, access_expires_at: expiresAt })
      });
      const data = await res.json();
      if (data.success) {
        fetchAdminUsers(); // Refresh list
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveDetailedPermissions = async (discordId: string, durationDays: number | null, apps: string[], games: string[], roblox_games: string[], minecraft_games: string[], other_games: string[], custom_expirations: Record<string, string | null>) => {
    try {
      let expiresAt = null;
      if (durationDays !== null) {
        const date = new Date();
        date.setDate(date.getDate() + durationDays);
        expiresAt = date.toISOString();
      }

      const currentRole = String(adminUsers.find(u => u.discord_id === discordId)?.role || '').toLowerCase();
      const keepsRole = discordId === '279905202277187584' || ['admin', 'ttv', 'ttv_star'].includes(currentRole);

      const res = await fetch('/api/admin/users/update-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_id: discordId,
          access_expires_at: expiresAt,
          // Keep owner/admin/TTV roles; only plain users switch between user and customize
          ...(keepsRole ? {} : { role: durationDays === null ? 'user' : 'customize' }),
          permissions: { apps, games, roblox_games, minecraft_games, other_games, custom_expirations }
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchAdminUsers();
        setPermissionModal(null);
      } else {
        Swal.fire(data.error || 'Failed to update permissions');
      }
    } catch (e) {
      console.error(e);
      Swal.fire('Error updating permissions');
    }
  };

  const updateUserRole = async (discordId: string, role: string) => {
    try {
      const res = await fetch('/api/admin/users/update-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_id: discordId, role })
      });
      const data = await res.json();
      if (data.success) {
        fetchAdminUsers();
      } else {
        Swal.fire(data.error || 'Failed to update role');
      }
    } catch (e) {
      console.error(e);
      Swal.fire('Error updating role');
    }
  };

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [installedGames, setInstalledGames] = useState<Record<string, boolean>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [localVersions, setLocalVersions] = useState<Record<string, string>>({});
  const [latestVersions, setLatestVersions] = useState<Record<string, string>>({});
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron && window.electron.checkStandaloneGame) {
      window.electron.checkStandaloneGame('block_pvp').then((result: any) => {
        const isInstalled = typeof result === 'object' ? result.installed : result;
        const version = typeof result === 'object' ? result.version : '1.0.0';
        setInstalledGames(prev => ({ ...prev, block_pvp: isInstalled }));
        if (isInstalled) {
            setLocalVersions(prev => ({ ...prev, block_pvp: version }));
        }
      }).catch(console.error);

      window.electron.checkStandaloneGame('pirate_wars').then((result: any) => {
        const isInstalled = typeof result === 'object' ? result.installed : result;
        const version = typeof result === 'object' ? result.version : '1.0.0';
        setInstalledGames(prev => ({ ...prev, pirate_wars: isInstalled }));
        if (isInstalled) {
            setLocalVersions(prev => ({ ...prev, pirate_wars: version }));
        }
      }).catch(console.error);

      window.electron.checkStandaloneGame('spouge_bob').then((result: any) => {
        const isInstalled = typeof result === 'object' ? result.installed : result;
        const version = typeof result === 'object' ? result.version : '1.0.4';
        setInstalledGames(prev => ({ ...prev, spouge_bob: isInstalled }));
        if (isInstalled) {
            setLocalVersions(prev => ({ ...prev, spouge_bob: version }));
        }
      }).catch(console.error);
    }
    
    if (typeof window !== 'undefined' && window.electron && window.electron.onStandaloneDownloadProgress) {
        window.electron.onStandaloneDownloadProgress((gameId: string, progress: number) => {
            setDownloadProgress(prev => ({ ...prev, [gameId]: progress }));
        });
    }
    
    fetch('https://api.github.com/repos/katozztv/BlockGame-Game/releases/latest')
      .then(res => res.json())
      .then(data => {
         if (data && data.tag_name) {
            setLatestVersions(prev => ({ ...prev, block_pvp: data.tag_name }));
            if (data.assets && data.assets.length > 0) {
                const zipAsset = data.assets.find((a: any) => a.name.endsWith('.zip'));
                if (zipAsset) {
                    setDownloadUrls(prev => ({ ...prev, block_pvp: zipAsset.browser_download_url }));
                }
            }
         }
      })
      .catch(console.error);

    fetch('https://api.github.com/repos/katozztv/PirateWars-Game/releases/latest')
      .then(res => res.json())
      .then(data => {
         if (data && data.tag_name) {
            setLatestVersions(prev => ({ ...prev, pirate_wars: data.tag_name }));
            if (data.assets && data.assets.length > 0) {
                const zipAsset = data.assets.find((a: any) => a.name.endsWith('.zip'));
                if (zipAsset) {
                    setDownloadUrls(prev => ({ ...prev, pirate_wars: zipAsset.browser_download_url }));
                }
            }
         }
      })
      .catch(console.error);

    fetch('https://api.github.com/repos/katozztv/Bed-Spouge/releases/latest')
      .then(res => res.json())
      .then(data => {
         if (data && data.tag_name) {
            setLatestVersions(prev => ({ ...prev, spouge_bob: data.tag_name }));
            if (data.assets && data.assets.length > 0) {
                const zipAsset = data.assets.find((a: any) => a.name.endsWith('.zip'));
                if (zipAsset) {
                    setDownloadUrls(prev => ({ ...prev, spouge_bob: zipAsset.browser_download_url }));
                }
            }
         }
      })
      .catch(console.error);
  }, []);

  const [installStatuses, setInstallStatuses] = useState<Record<string, 'not_installed' | 'installing' | 'installed'>>({});
  const [calcWinAmount, setCalcWinAmount] = useState<number>(10);
  const [timeLeft, setTimeLeft] = useState<{ days: number, hours: number, minutes: number, seconds: number } | null>(null);
  const [trackerStatus, setTrackerStatus] = useState<string>("กำลังรอเชื่อมต่อระบบ...");
  const [v1Status, setV1Status] = useState<string>("Disconnected");
  const [connectedUsername, setConnectedUsername] = useState<string>("");
  const [v2TestUsername, setV2TestUsername] = useState<string>("");

  // Counter UI State
  const [counterSettings, setCounterSettings] = useState({
    count: 0, maxCount: 5, strokeSize: 5, shadowSize: 6, letterSpacing: 5, fontFamily: 'Komikax', isRunning: false,
    hotkeyDecrease: { modifier: 'alt', key: 52 },
    hotkeyIncrease: { modifier: 'alt', key: 53 },
    soundDecrease: null as string | null,
    volumeDecrease: 50,
    soundIncrease: null as string | null,
    volumeIncrease: 50
  });
  const [availableFonts, setAvailableFonts] = useState<string[]>(['Arial', 'Verdana', 'Tahoma']);
  const [isCopied, setIsCopied] = useState(false);
  const [isRouletteServerRunning, setIsRouletteServerRunning] = useState(true);
  const [isRouletteCopied, setIsRouletteCopied] = useState(false);
  const [jarSettings, setJarSettings] = useState({ jarSize: 50, giftSize: 50, isRunning: false });
  const [isJarCopied, setIsJarCopied] = useState(false);
  const [jarTestGiftId, setJarTestGiftId] = useState('');
  
  const [timerSettings, setTimerSettings] = useState({ isRunning: false, hours: 0, minutes: 0, seconds: 0 });
  const [isTimerCopied, setIsTimerCopied] = useState(false);

  const [likesMilestoneSettings, setLikesMilestoneSettings] = useState({
    prefixText: 'บอลไฟ',
    baseTarget: 5000,
    increment: 5000,
    fontFamily: 'KOMIKAX',
    textColor: '#ffffff',
    strokeColor: '#000000',
    strokeSize: 5,
    showProgressBar: true,
    progressTemplate: 'template1',
    activeRules: [] as string[],
    isRunning: false
  });
  const [isLikesMilestoneCopied, setIsLikesMilestoneCopied] = useState(false);
  const [isLikesMilestoneActionModalOpen, setIsLikesMilestoneActionModalOpen] = useState(false);


  // Minecraft State
  const [minecraftSettings, setMinecraftSettings] = useState({
    ip: '127.0.0.1',
    port: 4567,
    password: 'change_me'
  });
  const [isMinecraftModalOpen, setIsMinecraftModalOpen] = useState(false);
  const [mcTestStatus, setMcTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // Minecraft Built-in Server State
  type McServerStatus = 'checking' | 'not_installed' | 'installing' | 'stopped' | 'running' | 'needs_update';
  const [mcServers, setMcServers] = useState<Record<'farm' | 'snowball' | 'havest' | 'parkour' | 'fishing_pig' | 'diamond_classic' | 'diamond_3x3x3', { status: McServerStatus, logs: string[], command: string, progress: number, zipUrl?: string, latestVersion?: string }>>({
    farm: { status: 'checking', logs: [], command: '', progress: 0 },
    snowball: { status: 'checking', logs: [], command: '', progress: 0 },
    havest: { status: 'checking', logs: [], command: '', progress: 0 },
    parkour: { status: 'checking', logs: [], command: '', progress: 0 },
    fishing_pig: { status: 'checking', logs: [], command: '', progress: 0 },
    diamond_classic: { status: 'checking', logs: [], command: '', progress: 0 },
    diamond_3x3x3: { status: 'checking', logs: [], command: '', progress: 0 }
  });
  const [isMcStartingModalOpen, setIsMcStartingModalOpen] = useState(false);
  const [mcStartupStatus, setMcStartupStatus] = useState<'starting' | 'success'>('starting');
  const [mcStartupProgress, setMcStartupProgress] = useState(0);
  const [activeMcTab, setActiveMcTab] = useState<'farm' | 'snowball' | 'havest' | 'parkour' | 'fishing_pig' | 'diamond_classic' | 'diamond_3x3x3'>('fishing_pig');
  // ป้าย NEW หมดอายุเอง (เช็กหลัง mount เพื่อไม่ให้ SSR กับ Client ไม่ตรงกัน)
  const [showNewBadge, setShowNewBadge] = useState(false);
  useEffect(() => { setShowNewBadge(Date.now() < NEW_BADGE_UNTIL); }, []);

  // Gift Presets State
  const [customListenUsername, setCustomListenUsername] = useState('');
  const [giftPresets, setGiftPresets] = useState<any[]>([]);
  const [activeGiftPresetId, setActiveGiftPresetId] = useState<string | null>(null);
  const [showNewPresetModal, setShowNewPresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [showRenamePresetModal, setShowRenamePresetModal] = useState(false);
  const [renamePresetName, setRenamePresetName] = useState('');
  const [giftSoundMode, setGiftSoundMode] = useState<'queue' | 'overlap' | 'interrupt'>(typeof window !== 'undefined' ? ((window as any).giftSoundMode || 'queue') : 'queue');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('giftSoundMode') as 'queue' | 'overlap' | 'interrupt';
      if (savedMode) {
        setGiftSoundMode(savedMode);
        (window as any).giftSoundMode = savedMode;
      }
    }
  }, []);

  const handleGiftSoundModeChange = (mode: 'queue' | 'overlap' | 'interrupt') => {
    setGiftSoundMode(mode);
    if (typeof window !== 'undefined') {
      (window as any).giftSoundMode = mode;
      localStorage.setItem('giftSoundMode', mode);
    }
  };

  // Role Simulation State (For Owner Debugging)
  const [simulatedRole, setSimulatedRole] = useState<'owner' | 'ttv' | 'customize' | 'user' | null>(null);

  // Siri Chat Reader State
  const [isSiriEnabled, setIsSiriEnabled] = useState(false);
  const [siriMinFanLevel, setSiriMinFanLevel] = useState(0);
  const [siriVolume, setSiriVolume] = useState(100);
  const [siriTestText, setSiriTestText] = useState('สวัสดีจ้า');
  const [siriVoices, setSiriVoices] = useState<any[]>([]);

  // Load/Save Siri Settings and Init Voices
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const loadVoices = () => {
        setSiriVoices(window.speechSynthesis.getVoices());
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    const savedEnabled = localStorage.getItem('siriEnabled');
    if (savedEnabled !== null) setIsSiriEnabled(savedEnabled === 'true');
    const savedLevel = localStorage.getItem('siriMinFanLevel');
    if (savedLevel !== null) setSiriMinFanLevel(parseInt(savedLevel, 10));
    const savedVol = localStorage.getItem('siriVolume');
    if (savedVol !== null) setSiriVolume(parseInt(savedVol, 10));
  }, []);

  useEffect(() => {
    localStorage.setItem('siriEnabled', isSiriEnabled.toString());
    localStorage.setItem('siriMinFanLevel', siriMinFanLevel.toString());
    localStorage.setItem('siriVolume', siriVolume.toString());
  }, [isSiriEnabled, siriMinFanLevel, siriVolume]);

  // Use useCallback so we can safely add it to the chat-message listener dependency if needed
  const speakSiri = useCallback((text: string, vol: number) => {
    siriQueue.push({ text, vol, timestamp: Date.now() });
    processSiriQueue();
  }, []);

  // Sound System State
  const playingAudioRef = useRef<Record<string, HTMLAudioElement>>({});
  const [playingState, setPlayingState] = useState<Record<string, boolean>>({});
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRuleIdx, setUploadingRuleIdx] = useState<number | null>(null);
  const [isSoundLibraryModalOpen, setIsSoundLibraryModalOpen] = useState(false);
  const [soundSearchQuery, setSoundSearchQuery] = useState('');
  const [soundLibraryFiles, setSoundLibraryFiles] = useState<any[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [selectingLibraryRuleIdx, setSelectingLibraryRuleIdx] = useState<number | null>(null);
  const playingLibraryAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingLibraryFileUrl, setPlayingLibraryFileUrl] = useState<string | null>(null);

  const getDisplayFileName = (urlOrName: string) => {
    if (!urlOrName) return 'ยังไม่มีไฟล์เสียง';
    let name = urlOrName.startsWith('http') ? urlOrName.split('/').pop() || '' : urlOrName;
    try {
      name = decodeURIComponent(name);
    } catch(e) {}
    name = name.replace(/^\d{13}-/, '');
    if (name.length > 25) {
      const extMatch = name.match(/\.[0-9a-z]+$/i);
      const ext = extMatch ? extMatch[0] : '';
      name = name.substring(0, 15) + '...' + ext;
    }
    return name;
  };

  const handleSupabaseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadingRuleIdx === null || !activeGiftPresetId) return;

    if (file.size > 1 * 1024 * 1024) {
      Swal.fire('ไฟล์มีขนาดเกิน 1 MB กรุณาเลือกไฟล์ที่เล็กกว่านี้ครับ');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploadingSound(true);
    try {
      const fileName = `${Date.now()}-${file.name}`;
      const filePath = `${fileName}`;

      const { data, error } = await supabase.storage
        .from('sounds')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (error) {
        throw error;
      }

      const { data: publicUrlData } = supabase.storage
        .from('sounds')
        .getPublicUrl(filePath);

      const publicUrl = publicUrlData.publicUrl;

      const updatedPresets = giftPresets.map(p => {
        if (p.id === activeGiftPresetId) {
          const newSoundRules = [...(p.soundRules || [])];
          newSoundRules[uploadingRuleIdx].soundFile = publicUrl;
          return { ...p, soundRules: newSoundRules };
        }
        return p;
      });
      setGiftPresets(updatedPresets);
      updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);

      Swal.fire('อัปโหลดเสียงสำเร็จ!');
    } catch (err: any) {
      console.error('Upload Error:', err);
      Swal.fire('เกิดข้อผิดพลาดในการอัปโหลดไฟล์: ' + err.message);
    } finally {
      setIsUploadingSound(false);
      setUploadingRuleIdx(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fetchSoundLibrary = async () => {
    setIsLoadingLibrary(true);
    try {
      const { data, error } = await supabase.storage.from('sounds').list('', {
        limit: 100,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' }
      });

      if (error) {
        throw error;
      }

      if (data) {
        const files = data.filter(f => f.name !== '.emptyFolderPlaceholder').map(file => {
          const { data: publicUrlData } = supabase.storage.from('sounds').getPublicUrl(file.name);
          return {
            name: file.name,
            url: publicUrlData.publicUrl,
            created_at: file.created_at
          };
        });
        setSoundLibraryFiles(files);
      }
    } catch (err: any) {
      console.error('Fetch Library Error:', err);
      Swal.fire('เกิดข้อผิดพลาดในการโหลดคลังเสียง: ' + err.message);
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  useEffect(() => {
    if (activeGiftPresetId && giftPresets.length > 0) {
      const currentPreset = giftPresets.find(p => p.id === activeGiftPresetId);
      if (currentPreset && currentPreset.soundRules) {
        currentPreset.soundRules.forEach((rule: any) => {
          if (rule.enabled && rule.soundFile) {
            const audioSrc = rule.soundFile.startsWith('http') 
              ? rule.soundFile 
              : `http://localhost:9001/sounds/${rule.soundFile}`;
            preloadAudio(audioSrc);
          }
        });
      }
    }
  }, [giftPresets, activeGiftPresetId]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron && window.electron.onChatMessage) {
      window.electron.onChatMessage((data: any) => {
        // Siri Chat Reader Logic
        if (isSiriEnabled) {
          if (siriMinFanLevel === 0 || (data.fanLevel && data.fanLevel >= siriMinFanLevel)) {
            speakSiri(data.comment, siriVolume);
          }
        }
      });
    }

    if (typeof window !== 'undefined' && window.electron && window.electron.onGiftReceived) {
      window.electron.onGiftReceived((data: any) => {
        const { giftName } = data;
        if (!giftName || !activeGiftPresetId) return;
        const currentPreset = giftPresets.find(p => p.id === activeGiftPresetId);
        if (!currentPreset || !currentPreset.soundRules) return;

        const matchedRules = currentPreset.soundRules.filter((r: any) => 
          r.enabled && 
          r.giftName && 
          r.soundFile && 
          giftName.toLowerCase() === r.giftName.toLowerCase()
        );
        matchedRules.forEach((rule: any) => {
          const audioSrc = rule.soundFile.startsWith('http') 
            ? rule.soundFile 
            : `http://localhost:9001/sounds/${rule.soundFile}`;
          const audio = playWithGain(audioSrc, rule.volume ?? 100);
          audio.play().catch(e => console.error("Sound System Error:", e));
        });
      });
    }
  }, [giftPresets, activeGiftPresetId, isSiriEnabled, siriMinFanLevel, siriVolume, speakSiri]);

  // TikTok Gifts State
  const [tiktokGifts, setTiktokGifts] = useState<any[]>([]);
  const [isGiftSelectorOpen, setIsGiftSelectorOpen] = useState(false);
  const [isVirtualKeyboardOpen, setIsVirtualKeyboardOpen] = useState(false);
  const [macroToast, setMacroToast] = useState<{ show: boolean, message: string }>({ show: false, message: '' });
  const [selectingRuleId, setSelectingRuleId] = useState<string | null>(null);
  const [selectingSoundRuleId, setSelectingSoundRuleId] = useState<string | null>(null);
  const [selectingRouletteTriggerGiftId, setSelectingRouletteTriggerGiftId] = useState<string | null>(null);
  const [editingRouletteTriggerSettingsId, setEditingRouletteTriggerSettingsId] = useState<string | null>(null);
  const [giftSearchQuery, setGiftSearchQuery] = useState('');
  const [giftSortOrder, setGiftSortOrder] = useState<'asc' | 'desc'>('asc');

  const THAI_BANKS = [
    { id: 'promptpay', name: 'พร้อมเพย์ (PromptPay)' },
    { id: 'kbank', name: 'ธนาคารกสิกรไทย (KBANK)' },
    { id: 'bbl', name: 'ธนาคารกรุงเทพ (BBL)' },
    { id: 'ktb', name: 'ธนาคารกรุงไทย (KTB)' },
    { id: 'scb', name: 'ธนาคารไทยพาณิชย์ (SCB)' },
    { id: 'bay', name: 'ธนาคารกรุงศรีอยุธยา (BAY)' },
    { id: 'ttb', name: 'ธนาคารทหารไทยธนชาต (TTB)' },
    { id: 'gsb', name: 'ธนาคารออมสิน (GSB)' },
    { id: 'baac', name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (BAAC)' },
    { id: 'ghb', name: 'ธนาคารอาคารสงเคราะห์ (GHB)' },
    { id: 'uob', name: 'ธนาคารยูโอบี (UOB)' },
    { id: 'cimb', name: 'ธนาคารซีไอเอ็มบีไทย (CIMB)' },
  ];

  const HOTKEY_MODIFIERS = [
    { value: 'none', label: 'ไม่มี (None)' },
    { value: 'alt', label: 'Alt' },
    { value: 'ctrl', label: 'Ctrl' },
    { value: 'shift', label: 'Shift' }
  ];

  const HOTKEY_KEYS = [
    { value: 2, label: '1' }, { value: 3, label: '2' }, { value: 4, label: '3' }, { value: 5, label: '4' },
    { value: 6, label: '5' }, { value: 7, label: '6' }, { value: 8, label: '7' }, { value: 9, label: '8' },
    { value: 10, label: '9' }, { value: 11, label: '0' },
    { value: 30, label: 'A' }, { value: 48, label: 'B' }, { value: 46, label: 'C' }, { value: 32, label: 'D' },
    { value: 18, label: 'E' }, { value: 33, label: 'F' }, { value: 34, label: 'G' }, { value: 35, label: 'H' },
    { value: 23, label: 'I' }, { value: 36, label: 'J' }, { value: 37, label: 'K' }, { value: 38, label: 'L' },
    { value: 50, label: 'M' }, { value: 49, label: 'N' }, { value: 24, label: 'O' }, { value: 25, label: 'P' },
    { value: 16, label: 'Q' }, { value: 19, label: 'R' }, { value: 31, label: 'S' }, { value: 20, label: 'T' },
    { value: 22, label: 'U' }, { value: 47, label: 'V' }, { value: 17, label: 'W' }, { value: 45, label: 'X' },
    { value: 21, label: 'Y' }, { value: 44, label: 'Z' },
    { value: 52, label: '. (Period)' }, { value: 53, label: '/ (Slash)' },
    { value: 51, label: ', (Comma)' }, { value: 39, label: '; (Semicolon)' },
    { value: 26, label: '[ (LBracket)' }, { value: 27, label: '] (RBracket)' },
    { value: 12, label: '- (Minus)' }, { value: 13, label: '= (Equal)' }
  ];

  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isPtsHistoryOpen, setIsPtsHistoryOpen] = useState(false);
  const [paymentData, setPaymentData] = useState(() => {
    try {
      if (user?.payment_info) {
        const parsed = JSON.parse(user.payment_info);
        if (parsed.bank) return parsed;
      }
    } catch (e) { }
    // If invalid JSON or empty, use fallback or raw text
    return { bank: 'promptpay', account_no: user?.payment_info || '', account_name: '' };
  });
  const [selectedCoupon, setSelectedCoupon] = useState<{ name: string, points: number } | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemMessage, setRedeemMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  // Parse History
  const [redeemHistory, setRedeemHistory] = useState<any[]>(() => {
    try {
      if (user?.redeem_history) {
        let parsed = typeof user.redeem_history === 'string' ? JSON.parse(user.redeem_history) : user.redeem_history;
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { }
    return [];
  });

  // Filter history to ONLY show this month's data
  const currentMonthHistory = redeemHistory.filter(item => {
    if (!item.date) return false;
    const itemDate = new Date(item.date);
    const now = new Date();
    // Use local time (Thai timezone is fine)
    return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear();
  });

  const router = useRouter();

  const coupons = [
    { name: "คูปอง 200 ฿", points: 420 },
    { name: "คูปอง 400 ฿", points: 840 },
    { name: "คูปอง 600 ฿", points: 1260 },
    { name: "คูปอง 800 ฿", points: 1680 },
    { name: "คูปอง 1,000 ฿", points: 2100 },
  ];

  const handleRedeem = async () => {
    if (!selectedCoupon) {
      setRedeemMessage({ type: 'error', text: 'กรุณาเลือกคูปองที่ต้องการแลก' });
      return;
    }
    if (!paymentData.account_no.trim() || !paymentData.account_name.trim()) {
      setRedeemMessage({ type: 'error', text: 'กรุณากรอกข้อมูลเลขบัญชีและชื่อบัญชีให้ครบถ้วน' });
      return;
    }
    if ((user.total_points || 0) < selectedCoupon.points) {
      setRedeemMessage({ type: 'error', text: 'Points ของคุณไม่เพียงพอ' });
      return;
    }

    setIsRedeeming(true);
    setRedeemMessage(null);

    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tiktokUsername: user.tiktok_username,
          pointsToDeduct: selectedCoupon.points,
          couponName: selectedCoupon.name,
          paymentInfo: JSON.stringify(paymentData),
          discordPaymentText: "ธนาคาร: " + (THAI_BANKS.find(b => b.id === paymentData.bank)?.name || paymentData.bank) + "\
เลขบัญชี: " + paymentData.account_no + "\
ชื่อบัญชี: " + paymentData.account_name
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการแลกรางวัล');

      setRedeemMessage({ type: 'success', text: 'แลกรางวัลสำเร็จ! รอแอดมินโอนเงินเข้าบัญชีได้เลยครับ' });

      // Update local state temporarily (it will refresh on next poll)
      user.total_points = data.newPoints;
      user.payment_info = JSON.stringify(paymentData);
      if (data.newHistory) {
        user.redeem_history = data.newHistory;
        setRedeemHistory(data.newHistory);
      }

      setTimeout(() => {
        setIsRedeemOpen(false);
        setRedeemMessage(null);
        setSelectedCoupon(null);
        router.refresh();
      }, 3000);

    } catch (err: any) {
      setRedeemMessage({ type: 'error', text: err.message });
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleClearHistory = async () => {
    if (sessionUser?.id !== '279905202277187584') return;
    
    const confirm = await Swal.fire({
      title: 'ยืนยันการลบประวัติ?',
      text: "ระบบจะทำการลบประวัติการแลกทั้งหมด และลบข้อความใน Discord ด้วย (ยกเว้นข้อความสรุปยอด)",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'ลบประวัติ',
      cancelButtonText: 'ยกเลิก'
    });

    if (!confirm.isConfirmed) return;

    setIsClearingHistory(true);
    try {
      const res = await fetch('/api/admin/clear-redeem', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear history');
      
      Swal.fire(
        'ลบสำเร็จ!',
        `ลบประวัติผู้ใช้ ${data.clearedUsers} คน และลบข้อความ Discord ไป ${data.deletedMessages} ข้อความ`,
        'success'
      );
      setRedeemHistory([]);
      user.redeem_history = '[]';
    } catch (err: any) {
      Swal.fire('Error', err.message, 'error');
    } finally {
      setIsClearingHistory(false);
    }
  };

  const lastRefreshAtRef = useRef(0);
  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh at most once per MIN_REFRESH_INTERVAL_MS; requests inside the window collapse into one trailing refresh
  const requestRefresh = useCallback(() => {
    if (pendingRefreshRef.current) return;
    const runRefresh = () => {
      pendingRefreshRef.current = null;
      lastRefreshAtRef.current = Date.now();
      router.refresh();
    };
    const wait = lastRefreshAtRef.current + MIN_REFRESH_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      runRefresh();
    } else {
      pendingRefreshRef.current = setTimeout(runRefresh, wait);
    }
  }, [router]);

  useEffect(() => {
    // Auto refresh data from server every 30 seconds as fallback
    const interval = setInterval(requestRefresh, 30000);
    return () => {
      clearInterval(interval);
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
    };
  }, [requestRefresh]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electron || !window.electron.onTrackerUpdate) return;
    trackerUpdateHandler = requestRefresh;
    if (!isTrackerUpdateListenerAttached) {
      isTrackerUpdateListenerAttached = true;
      // Refresh when a gift is processed (throttled via requestRefresh)
      window.electron.onTrackerUpdate(() => trackerUpdateHandler?.());
    }
    return () => {
      if (trackerUpdateHandler === requestRefresh) trackerUpdateHandler = null;
    };
  }, [requestRefresh]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron) {
      // Load Counter Settings if in desktop app
      if (window.electron && window.electron.getFonts) {
        window.electron.getFonts().then((fonts: string[]) => {
          // Pin Komikax เป็น option แรกเสมอ แม้เครื่องไม่มีติดตั้ง
          const pinned = ['Komikax'];
          const rest = fonts.filter(f => !pinned.includes(f));
          setAvailableFonts([...pinned, ...rest]);
        });
      }
      if (window.electron.getCounterSettings) {
        window.electron.getCounterSettings().then((settings: any) => setCounterSettings(settings));
        window.electron.onCounterSettingsUpdated((settings: any) => setCounterSettings(settings));
      }
      if (window.electron.getMinecraftSettings) {
        window.electron.getMinecraftSettings().then((settings: any) => setMinecraftSettings(settings));
      }
      if (window.electron.getGiftPresets) {
        window.electron.getGiftPresets().then((data: any) => {
          setGiftPresets(data.presets || []);
          setActiveGiftPresetId(data.activePresetId || null);
        });
      }
      if (window.electron.getTikTokGifts) {
        window.electron.getTikTokGifts().then((gifts: any[]) => {
          setTiktokGifts(gifts);
        });
      }
      if (window.electron.getSoundSettings) {
        window.electron.getSoundSettings().then((rules: any[]) => {
          setSoundRules(rules || []);
        });
      }
      if (window.electron.getJarSettings) {
        window.electron.getJarSettings().then((settings: any) => setJarSettings(settings));
      }
      if (window.electron.getLikesMilestoneSettings) {
        window.electron.getLikesMilestoneSettings().then((settings: any) => setLikesMilestoneSettings(settings));
      }
      if (window.electron.onActivePresetChanged) {
        window.electron.onActivePresetChanged((presetId: string) => {
          setActiveGiftPresetId(presetId);
          // Also fetch presets again just in case the name was updated or new ones were bundled
          if (window.electron.getGiftPresets) {
            window.electron.getGiftPresets().then((data: any) => {
              setGiftPresets(data.presets || []);
            });
          }
        });
      }

      // Minecraft Built-in Server Event Listeners
      if (window.electron.checkMinecraftServer) {
        const checkServer = (type: 'farm' | 'snowball' | 'havest' | 'parkour' | 'fishing_pig' | 'diamond_classic' | 'diamond_3x3x3') => {
          window.electron.checkMinecraftServer(type).then((isInstalled: boolean) => {
            if (window.electron.checkMinecraftUpdate) {
              window.electron.checkMinecraftUpdate(type).then((updateInfo: any) => {
                if (!isInstalled) {
                  setMcServers(prev => ({ ...prev, [type]: { ...prev[type], status: 'not_installed', zipUrl: updateInfo.zipUrl, latestVersion: updateInfo.latestVersion } }));
                } else if (updateInfo.needsUpdate) {
                  setMcServers(prev => ({ ...prev, [type]: { ...prev[type], status: 'needs_update', zipUrl: updateInfo.zipUrl, latestVersion: updateInfo.latestVersion } }));
                } else {
                  setMcServers(prev => ({ ...prev, [type]: { ...prev[type], status: 'stopped', zipUrl: updateInfo.zipUrl, latestVersion: updateInfo.latestVersion } }));
                }
              });
            } else {
               setMcServers(prev => ({ ...prev, [type]: { ...prev[type], status: isInstalled ? 'stopped' : 'not_installed' } }));
            }
          });
        };
        checkServer('farm');
        checkServer('snowball');
        checkServer('havest');
        checkServer('parkour');
        checkServer('fishing_pig');
        checkServer('diamond_classic');
        checkServer('diamond_3x3x3');
      }
      if (window.electron.onMinecraftConsoleOutput) {
        window.electron.onMinecraftConsoleOutput((serverType: 'farm' | 'snowball' | 'havest' | 'parkour' | 'fishing_pig' | 'diamond_classic' | 'diamond_3x3x3', data: string) => {
          setMcServers(prev => {
            const newLogs = [...prev[serverType].logs, data.trim()].slice(-100);
            return {
              ...prev,
              [serverType]: { ...prev[serverType], logs: newLogs, status: 'running' }
            };
          });
          
          // Note: Startup progress parsing is left intact but may need separate state if we care about it per server.
          // For now, we update the global startup progress.
          if (data.includes('Done (') || data.includes('For help, type "help"')) {
            setMcStartupStatus('success');
            setMcStartupProgress(100);
          } else {
            if (data.includes('Loading libraries, please wait')) {
              setMcStartupProgress(10);
            } else if (data.includes('Starting minecraft server version')) {
              setMcStartupProgress(25);
            } else if (data.includes('Loading properties')) {
              setMcStartupProgress(40);
            } else if (data.includes('Default game type')) {
              setMcStartupProgress(55);
            } else if (data.includes('Preparing level "world"')) {
              setMcStartupProgress(70);
            } else if (data.includes('Preparing start region for dimension')) {
              setMcStartupProgress(80);
            }

            const match = data.match(/Preparing spawn area:\s+(\d+)%/);
            if (match && match[1]) {
              const percent = parseInt(match[1]);
              setMcStartupProgress(80 + Math.round(percent * 0.2));
            }
          }
        });
      }
      if (window.electron.onMinecraftDownloadProgress) {
        window.electron.onMinecraftDownloadProgress((serverType: 'farm' | 'snowball' | 'havest' | 'parkour' | 'fishing_pig' | 'diamond_classic' | 'diamond_3x3x3', progress: number) => {
          setMcServers(prev => ({ ...prev, [serverType]: { ...prev[serverType], progress: progress } }));
        });
      }
      if (window.electron.onMinecraftServerStopped) {
        window.electron.onMinecraftServerStopped((serverType: 'farm' | 'snowball' | 'havest' | 'parkour' | 'fishing_pig' | 'diamond_classic' | 'diamond_3x3x3') => {
          setMcServers(prev => ({ ...prev, [serverType]: { ...prev[serverType], status: 'stopped' } }));
        });
      }
    }
  }, [router]);
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isMcStartingModalOpen && mcStartupStatus === 'starting') {
      interval = setInterval(() => {
        setMcStartupProgress(prev => {
          // Pause if downloading
          if (mcServers[activeMcTab].logs.length > 0) {
            const lastLog = mcServers[activeMcTab].logs[mcServers[activeMcTab].logs.length - 1] || '';
            if (lastLog.includes('Downloading')) {
              return prev;
            }
          }
          if (prev < 85) return prev + 1;
          return prev;
        });
      }, 1000); // 1% every 1s -> reaches 85% in ~85 seconds
    }
    return () => clearInterval(interval);
  }, [isMcStartingModalOpen, mcStartupStatus, mcServers[activeMcTab].logs]);


  const updateCounterSetting = (key: string, value: any) => {
    const newSettings = { ...counterSettings, [key]: value };
    setCounterSettings(newSettings);
    if (window.electron && window.electron.updateCounterSettings) {
      window.electron.updateCounterSettings({ [key]: value });
    }
  };

  const updateMinecraftSetting = (key: string, value: any) => {
    const newSettings = { ...minecraftSettings, [key]: value };
    setMinecraftSettings(newSettings);
    if (window.electron && window.electron.updateMinecraftSettings) {
      window.electron.updateMinecraftSettings({ [key]: value });
    }
  };

  const testMinecraftConn = async () => {
    if (window.electron && window.electron.testMinecraftConnection) {
      setMcTestStatus('testing');
      const success = await window.electron.testMinecraftConnection(minecraftSettings);
      setMcTestStatus(success ? 'success' : 'error');
      setTimeout(() => setMcTestStatus('idle'), 3000);
    }
  };

  const updateGiftPresetsBackend = (newPresets: any[], newActiveId: string | null) => {
    if (window.electron && window.electron.saveGiftPresets) {
      window.electron.saveGiftPresets({ presets: newPresets, activePresetId: newActiveId });
    }
  };

  const toggleCounterServer = () => {
    const newStatus = !counterSettings.isRunning;
    if (window.electron && window.electron.toggleCounterServer) {
      window.electron.toggleCounterServer(newStatus);
    } else {
      Swal.fire('กรุณากรอก Username TikTok ของแอคเคาท์หลักของคุณ');
    }
  };

  const updateJarSetting = (key: string, value: any) => {
    const newSettings = { ...jarSettings, [key]: value };
    setJarSettings(newSettings);
    if (window.electron && window.electron.updateJarSettings) {
      window.electron.updateJarSettings({ [key]: value });
    }
  };

  const toggleJarServer = () => {
    const newStatus = !jarSettings.isRunning;
    const newSettings = { ...jarSettings, isRunning: newStatus };
    setJarSettings(newSettings);
    if (window.electron && window.electron.toggleJarServer) {
      window.electron.toggleJarServer(newStatus);
    } else {
      Swal.fire('กรุณากรอก Username TikTok ของแอคเคาท์หลักของคุณ');
    }
  };

  const testJarGift = (amount: number) => {
    if (!jarTestGiftId) return Swal.fire('กรุณาเลือกของขวัญก่อนทดสอบ');
    const gift = tiktokGifts.find(g => g.id === jarTestGiftId);
    if (!gift) return;

    if (window.electron && window.electron.testJarGift) {
      window.electron.testJarGift({
        giftName: gift.name,
        repeatCount: amount,
        diamondCount: gift.coin,
        image: gift.image
      });
    }
  };

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date();
      // คำนวณเวลาไทย (UTC+7)
      const bkkTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (7 * 3600000));

      const nextMonday = new Date(bkkTime);
      // หาจำนวนวันที่ต้องบวกเพื่อไปให้ถึงวันจันทร์หน้า
      nextMonday.setDate(bkkTime.getDate() + (1 + 7 - bkkTime.getDay()) % 7);

      // ถ้าเป็นวันจันทร์เป๊ะๆ (และเลยเวลา 00:00 มาแล้ว) ให้บวกไปอีก 7 วัน
      if (bkkTime.getDay() === 1 && (bkkTime.getHours() > 0 || bkkTime.getMinutes() > 0 || bkkTime.getSeconds() > 0)) {
        nextMonday.setDate(bkkTime.getDate() + 7);
      }

      nextMonday.setHours(0, 0, 0, 0);

      const difference = nextMonday.getTime() - bkkTime.getTime();

      if (difference > 0) {
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60)
        });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, []);

  const actualIsOwner = sessionUser?.id === '279905202277187584';
  const isOwner = simulatedRole && actualIsOwner ? (simulatedRole === 'owner') : actualIsOwner;
  const isAdmin = simulatedRole && actualIsOwner ? (simulatedRole === 'owner') : (user.role === 'admin');
  const isCustomize = simulatedRole && actualIsOwner ? (simulatedRole === 'customize') : (user.role?.toLowerCase() === 'customize');
  const isGeneralUser = simulatedRole && actualIsOwner ? (simulatedRole === 'user') : (!user.role || user.role.toLowerCase() === 'user');
  
  let realIsLocked;
  if (simulatedRole && actualIsOwner) {
    if (simulatedRole === 'owner') realIsLocked = false;
    else if (simulatedRole === 'ttv') realIsLocked = false;
    else realIsLocked = true; // 'user' and 'customize' mode
  } else {
    if (user.role?.toLowerCase() === 'customize') {
      realIsLocked = true;
    } else {
      realIsLocked = !isOwner && !isAdmin && !['ttv', 'ttv_star'].includes((user.role || '').toLowerCase()) &&
        (!user.access_expires_at || new Date(user.access_expires_at) < new Date());
    }
  }
  
  const isLocked = realIsLocked;
  const isTrackerLocked = isCustomize ? false : isLocked;

  useEffect(() => {
    if (user?.tiktok_username) {
      setCustomListenUsername(user.tiktok_username);
    }
    // Check if we are running in the Electron Desktop App
    if (typeof window !== 'undefined' && window.electron && user?.tiktok_username && !isTrackerLocked) {
      window.electron.startTracking({ listenUsername: user.tiktok_username, creditUsername: user.tiktok_username });
      window.electron.onTrackerStatus((status: string) => {
        if (status.includes('|')) {
          const [stat, user] = status.split('|');
          setTrackerStatus(stat);
          setConnectedUsername(user);
        } else {
          setTrackerStatus(status);
        }
      });
      if (window.electron.onV1Status) {
        window.electron.onV1Status((status: string) => {
          setV1Status(status);
        });
      }
    } else {
      if (isTrackerLocked) {
        setTrackerStatus("ไม่มีสิทธิ์เชื่อมต่อ (Locked)");
      } else {
        setTrackerStatus("ใช้งานผ่านเว็บ (ไม่มีระบบ Tracker)");
      }
    }
  }, [user?.tiktok_username, isTrackerLocked]);

  // Level Logic
  const totalLp = user.lp || 0;
  const getLevelInfo = (lp: number) => {
    if (lp >= 1500) return { level: 4, current: lp - 1500, max: 750, isMax: true };
    if (lp >= 750) return { level: 3, current: lp - 750, max: 750, isMax: false };
    if (lp >= 250) return { level: 2, current: lp - 250, max: 500, isMax: false };
    return { level: 1, current: lp, max: 250, isMax: false };
  };
  const levelInfo = getLevelInfo(totalLp);

  const getDiscountPercent = (level: number) => {
    if (level >= 4) return 20;
    if (level === 3) return 10;
    if (level === 2) return 5;
    return 0;
  };
  const discountPercent = getDiscountPercent(levelInfo.level);

  const checkCustomExp = (itemId: string) => {
    if (user.permissions?.custom_expirations && user.permissions.custom_expirations[itemId] !== undefined) {
      const exp = user.permissions.custom_expirations[itemId];
      if (exp === null) return true;
      return new Date(exp) > new Date();
    }
    // Fallback to global access
    return !(!isOwner && !isAdmin && !['ttv', 'ttv_star'].includes((user.role || '').toLowerCase()) && (!user.access_expires_at || new Date(user.access_expires_at) < new Date()));
  };

  const hasAppPermission = (app: string) => {
    if (isOwner || isAdmin) return true;
    if (app === 'keyboard_sound' && (isGeneralUser || isCustomize)) return false;
    if (app === 'gifts' && isGeneralUser) {
      if (user.permissions?.custom_expirations?.['gifts'] !== undefined) {
         return checkCustomExp('gifts');
      }
      return false;
    }
    const defaultApps = ['ttv', 'ttv_star', 'admin', 'owner'].includes((user.role || '').toLowerCase()) ? ['counter', 'gifts', 'game', 'sound', 'keyboard_sound', 'decoration'] : ['counter', 'gifts', 'game', 'sound', 'keyboard_sound'];
    const userApps = user.permissions?.apps || defaultApps;
    if (!userApps.includes(app)) return false;
    return checkCustomExp(app);
  };

  const hasAppAccess = (app: string) => {
    if (app === 'keyboard_sound' || app === 'gifts' || app === 'game') return true;
    return hasAppPermission(app);
  };

  const hasGameAccess = (game: string) => {
    if (isOwner || isAdmin) return true;
    if (isCustomize) return true; // Let specific game checks handle the restriction
    const userGames = user.permissions?.games || ['minecraft', 'roblox', 'other'];
    if (!userGames.includes(game)) return false;
    return checkCustomExp(game);
  };

  const hasRobloxGameAccess = (gameId: string) => {
    if (isOwner || isAdmin) return true;
    if (isCustomize) {
      return user.permissions?.custom_expirations?.[gameId] !== undefined && checkCustomExp(gameId);
    }
    if (isGeneralUser && user.permissions?.custom_expirations?.[gameId] === undefined) {
      return false;
    }
    if (!hasGameAccess('roblox')) return false;
    const userRobloxGames = user.permissions?.roblox_games || ['pizza_speed', 'donkey_smash', 'build_block', 'line_up_jump'];
    if (!userRobloxGames.includes(gameId)) return false;
    return checkCustomExp(gameId);
  };

  const hasMinecraftGameAccess = (gameId: string) => {
    if (isOwner || isAdmin) return true;
    if (isCustomize) {
      return user.permissions?.custom_expirations?.[gameId] !== undefined && checkCustomExp(gameId);
    }
    if (isGeneralUser && user.permissions?.custom_expirations?.[gameId] === undefined) {
      return false;
    }
    if (!hasGameAccess('minecraft')) return false;
    let userMinecraftGames = user.permissions?.minecraft_games || ['farm', 'snowball', 'havest', 'parkour', 'fishing_pig', 'diamond_classic', 'diamond_3x3x3'];
    
    if (['ttv', 'ttv_star'].includes((user.role || '').toLowerCase())) {
      const lineupGames = ['diamond_classic', 'diamond_3x3x3'];
      userMinecraftGames = [...userMinecraftGames, ...lineupGames.filter(g => !userMinecraftGames.includes(g))];
    }

    if (!userMinecraftGames.includes(gameId)) return false;
    return checkCustomExp(gameId);
  };

  const hasOtherGameAccess = (gameId: string) => {
    if (gameId === 'stick_war') return hasStickWarAccess({ ...user,
      discord_id: simulatedRole && actualIsOwner ? '123456789012345678' : user.discord_id || sessionUser?.id,
      role: simulatedRole && actualIsOwner ? simulatedRole : user.role });
    if (isOwner || isAdmin) return true;
    if (isCustomize) {
      return user.permissions?.custom_expirations?.[gameId] !== undefined && checkCustomExp(gameId);
    }
    if (isGeneralUser && user.permissions?.custom_expirations?.[gameId] === undefined) {
      return false;
    }
    if (!hasGameAccess('other')) return false;
    let userOtherGames = user.permissions?.other_games || ['block_pvp', 'spouge_bob'];

    if (['ttv', 'ttv_star'].includes((user.role || '').toLowerCase()) && !userOtherGames.includes('spouge_bob')) {
      userOtherGames = [...userOtherGames, 'spouge_bob'];
    }

    if (!userOtherGames.includes(gameId)) return false;
    return checkCustomExp(gameId);
  };

  const isGiftsLocked = !hasAppPermission('gifts');
  const isCounterLocked = !hasAppPermission('counter');
  const isKeyboardSoundLocked = !hasAppPermission('keyboard_sound');
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron && window.electron.setGiftsLocked) {
      window.electron.setGiftsLocked(isGiftsLocked);
    }
  }, [isGiftsLocked]);

  // Bonus Logic
  const bonusThresholds = { 1: 999999, 2: 1500, 3: 4500, 4: 13500 };
  const bonusPoints = { 1: 0, 2: 4, 3: 10, 4: 20 };
  const targetBonusDiamonds = bonusThresholds[levelInfo.level as keyof typeof bonusThresholds];
  const rewardBonusPoints = bonusPoints[levelInfo.level as keyof typeof bonusPoints];

  let displayStatus = eventStatus;
  let displayCountdown = eventCountdown;
  const isEndingSoon = displayStatus === 'ongoing' && displayCountdown.days === 0 && displayCountdown.hours === 0;

  let longHolidayDisplayStatus = longHolidayStatus;
  let longHolidayDisplayCountdown = longHolidayCountdown;
  const isLongHolidayEndingSoon = longHolidayDisplayStatus === 'ongoing' && longHolidayDisplayCountdown.days === 0 && longHolidayDisplayCountdown.hours === 0;

  const filteredAdminUsers = adminUsers.filter(u => {
    if (adminSearchQuery) {
      const q = adminSearchQuery.toLowerCase();
      const match = (u.discord_username || '').toLowerCase().includes(q) ||
                    (u.discord_id || '').toLowerCase().includes(q) ||
                    (u.tiktok_username || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    if (adminFilterApp !== 'all') {
      const defaultApps = ['ttv', 'ttv_star', 'admin', 'owner'].includes((u.role || '').toLowerCase()) ? ['counter', 'gifts', 'game', 'sound', 'keyboard_sound', 'decoration'] : ['counter', 'gifts', 'game', 'sound', 'keyboard_sound'];
      const apps = u.permissions?.apps || defaultApps;
      const games = u.permissions?.games || ['minecraft', 'roblox', 'other'];
      
      if (['counter', 'gifts', 'sound'].includes(adminFilterApp)) {
        if (!apps.includes(adminFilterApp)) return false;
      }
      if (['minecraft', 'roblox', 'other'].includes(adminFilterApp)) {
        if (!apps.includes('game') || !games.includes(adminFilterApp)) return false;
      }
    }
    return true;
  });

  const ownerAdminGroup = filteredAdminUsers.filter(u => u.discord_id === '279905202277187584' || u.role === 'admin');
  const lineupGroup = filteredAdminUsers.filter(u => u.discord_id !== '279905202277187584' && u.role !== 'admin' && ['ttv', 'ttv_star'].includes((u.role || '').toLowerCase()));
  const hasValidExpiration = (u: any) => {
    if (u.access_expires_at && new Date(u.access_expires_at) >= new Date()) return true;
    if (u.permissions?.custom_expirations) {
      return Object.values(u.permissions.custom_expirations).some(exp => exp === null || new Date(exp as string) > new Date());
    }
    return false;
  };
  const customizeGroup = filteredAdminUsers.filter(u => u.discord_id !== '279905202277187584' && u.role !== 'admin' && !['ttv', 'ttv_star'].includes((u.role || '').toLowerCase()) && hasValidExpiration(u));
  const noAccessGroup = filteredAdminUsers.filter(u => u.discord_id !== '279905202277187584' && u.role !== 'admin' && !['ttv', 'ttv_star'].includes((u.role || '').toLowerCase()) && !hasValidExpiration(u));

  const navItems = ([
    { id: 'dashboard', icon: '🏠', label: 'หน้าหลัก', show: true, isNew: false },
    { id: 'counter', icon: '🎯', label: 'นับวิน', show: hasAppAccess('counter'), isNew: false },
    { id: 'gifts', icon: '🎁', label: 'ระบบของขวัญ', show: hasAppAccess('gifts'), isNew: false },
    { id: 'game', icon: '🎮', label: 'เกม', show: hasAppAccess('game'), isNew: showNewBadge },
    { id: 'sound', icon: '🔊', label: 'ระบบเสียง', show: hasAppAccess('sound'), isNew: false },
    { id: 'keyboard_sound', icon: '🎹', label: 'เสียงคีย์บอร์ด', show: hasAppAccess('keyboard_sound'), isNew: false },
    { id: 'decoration', icon: '✨', label: 'ตกแต่ง', show: hasAppAccess('decoration'), isNew: false },
    { id: 'admin', icon: '🛡️', label: 'จัดการสิทธิ์', show: isOwner || isAdmin, isNew: false },
  ] as const).filter(item => item.show);
  const openView = (id: typeof view) => {
    setView(id);
    if (id === 'admin') fetchAdminUsers();
    document.getElementById('ttv-main')?.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-screen bg-[#050505] relative overflow-hidden text-white flex">
      {/* Background gradients */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-yellow-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-amber-600/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Sidebar */}
      <aside className="w-60 flex flex-col py-6 px-4 gap-1 border-r border-yellow-400/10 bg-black z-20 shrink-0">
        <div className="px-3 mb-6">
          <div className="text-3xl font-black tracking-tight leading-none">
            <span className="text-yellow-400">TTV</span> <span className="text-white">APP</span>
          </div>
          <div className="mt-1 h-1 w-12 rounded-full bg-yellow-400" />
        </div>

        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => openView(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left font-bold transition-all ${view === item.id ? 'bg-yellow-400 text-black shadow-[0_0_20px_rgba(250,204,21,0.25)]' : 'text-zinc-400 hover:bg-yellow-400/10 hover:text-yellow-300'}`}
          >
            <span className="text-xl w-7 text-center">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.isNew && <span className="px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-black rounded animate-pulse leading-none">NEW</span>}
          </button>
        ))}

        <div className="mt-auto pt-4 border-t border-yellow-400/10">
          <div className="flex items-center gap-3 px-2 mb-3">
            {sessionUser.image ? (
              <img src={sessionUser.image} alt={sessionUser.name} className="w-10 h-10 rounded-full border-2 border-yellow-400" />
            ) : (
              <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center">
                <UserCircle className="w-7 h-7 text-black" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">{sessionUser.name}</div>
              <TtvBadge role={user.role} />
            </div>
          </div>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-400 hover:text-black hover:bg-yellow-400 border border-yellow-400/20 transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div id="ttv-main" className="flex-1 p-8 overflow-y-auto h-screen relative z-10">
        <div className="w-full h-full">
          {view !== 'dashboard' && (
            <button
              onClick={() => openView('dashboard')}
              className="mb-6 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-black transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
              กลับหน้าหลัก
            </button>
          )}
          <div className={view === 'keyboard_sound' ? 'block w-full h-full relative' : 'hidden'}>
            {isKeyboardSoundLocked && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-auto">
                <div className="bg-black/80 px-8 py-6 flex flex-col items-center justify-center border border-red-500/40 rounded-3xl shadow-[0_0_30px_rgba(239,68,68,0.3)] backdrop-blur-xl transform transition-transform hover:scale-105">
                  <span className="text-5xl mb-3 drop-shadow-lg">🔒</span>
                  <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 mb-1">ฟีเจอร์ถูกล็อก</h2>
                  <p className="text-zinc-300 text-sm font-medium">ต้องได้รับสิทธิ์ TTV เพื่อใช้งานส่วนนี้</p>
                </div>
              </div>
            )}
            <div className={`w-full h-full ${isKeyboardSoundLocked ? 'pointer-events-none blur-[3px] opacity-50' : ''}`}>
              <KeyboardSoundSystem />
            </div>
          </div>
          {view === 'dashboard' && (
            <>
              <header className="flex items-center justify-between mb-10 bg-gradient-to-r from-yellow-400 to-amber-500 p-6 rounded-3xl text-black shadow-[0_0_40px_rgba(250,204,21,0.15)]">
                <div className="flex items-center gap-4">
                  {sessionUser.image ? (
                    <img src={sessionUser.image} alt={sessionUser.name} className="w-14 h-14 rounded-full border-4 border-black" />
                  ) : (
                    <div className="w-14 h-14 bg-black rounded-full flex items-center justify-center">
                      <UserCircle className="w-9 h-9 text-yellow-400" />
                    </div>
                  )}
                  <div>
                    <h1 className="text-2xl font-black">สวัสดี, {sessionUser.name}</h1>
                    <p className="text-sm font-medium text-black/70">เลือกเมนูด้านซ้ายเพื่อเริ่มใช้งาน</p>
                  </div>
                </div>
                <div className="px-4 py-2 rounded-xl bg-black text-yellow-400 font-black tracking-wide">
                  {ttvBadgeLabel(user.role) ? `${ttvBadgeLabel(user.role) === 'TTV STAR' ? '★ ' : ''}${ttvBadgeLabel(user.role)}` : 'ยังไม่มียศ'}
                </div>

              </header>



              {/* Special Event: Long Holiday Event (28-30 Jul) */}
              {longHolidayDisplayStatus !== 'ended' && (
                <div className="mb-6 relative overflow-hidden rounded-3xl">
                  {isLocked && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center border border-red-500/20 rounded-3xl">
                      <span className="text-4xl mb-2">🔒</span>
                      <h2 className="text-xl font-bold text-white mb-1">ไม่มีสิทธิ์เข้าร่วมกิจกรรม</h2>
                      <p className="text-zinc-300 text-sm text-center">ต้องได้รับสิทธิ์ TTV ก่อน</p>
                    </div>
                  )}
                  <div className={isLocked ? "pointer-events-none blur-sm" : ""}>
                    <div className={`backdrop-blur-md border p-8 rounded-3xl relative overflow-hidden group transition-all duration-500 ${
                      longHolidayDisplayStatus === 'ongoing'
                        ? isLongHolidayEndingSoon
                          ? 'bg-gradient-to-r from-red-600/20 via-amber-600/20 to-amber-600/20 border-red-500/50 shadow-[0_0_35px_rgba(239,68,68,0.3)]'
                          : 'bg-gradient-to-r from-amber-600/15 via-amber-600/15 to-red-600/15 border-amber-500/40 shadow-[0_0_35px_rgba(245,158,11,0.25)] hover:shadow-[0_0_50px_rgba(245,158,11,0.35)]'
                        : 'bg-gradient-to-r from-amber-950/30 via-amber-950/30 to-red-950/30 border-amber-500/30 hover:border-amber-500/50 shadow-[0_0_25px_rgba(245,158,11,0.15)]'
                    }`}>
                      {/* Background elements */}
                      <div className="absolute top-0 right-0 p-8 opacity-15 group-hover:opacity-25 transition-all duration-700 transform group-hover:rotate-12 group-hover:scale-110 pointer-events-none">
                        <Flame className={`w-48 h-48 ${longHolidayDisplayStatus === 'ongoing' ? (isLongHolidayEndingSoon ? 'text-red-400' : 'text-amber-400') : 'text-zinc-500'}`} />
                      </div>

                      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3 flex-wrap">
                            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
                              longHolidayDisplayStatus === 'ongoing'
                                ? isLongHolidayEndingSoon
                                  ? 'bg-red-500/20 text-red-400 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.3)] animate-pulse'
                                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                            }`}>
                              <Flame className="w-3.5 h-3.5 animate-bounce" />
                              Special Event
                            </span>
                            <span className="text-zinc-300 text-sm font-medium flex items-center gap-1.5 bg-black/30 px-3 py-1 rounded-full border border-white/5">
                              <Timer className="w-4 h-4 text-amber-400" /> เฉพาะวันที่ 28 - 30 ก.ค. นี้เท่านั้น
                            </span>
                          </div>

                          <h3 className={`text-3xl sm:text-4xl font-black text-transparent bg-clip-text drop-shadow-sm mb-3 ${
                            longHolidayDisplayStatus === 'ongoing'
                              ? isLongHolidayEndingSoon
                                ? 'bg-gradient-to-r from-red-400 via-amber-400 to-amber-300'
                                : 'bg-gradient-to-r from-amber-300 via-amber-400 to-red-400'
                              : 'bg-gradient-to-r from-zinc-300 to-zinc-500'
                          }`}>
                            หยุดยาวไฟลุก 🔥
                          </h3>

                          <p className="text-zinc-300 flex items-center gap-2 text-sm sm:text-base flex-wrap">
                            รับคะแนนพิเศษจากของขวัญไลฟ์ในช่วงหยุดยาว! <span className={`font-bold px-3 py-1 rounded-lg border shadow-sm ${
                              longHolidayDisplayStatus === 'ongoing'
                                ? 'text-amber-300 bg-amber-500/15 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                : 'text-zinc-300 bg-zinc-800 border-zinc-700'
                            }`}>100 เพชร = 1 Point</span>
                          </p>
                        </div>

                        <div className={`border rounded-2xl p-6 w-full lg:w-72 backdrop-blur-sm relative overflow-hidden transition-all duration-500 shrink-0 ${
                          longHolidayDisplayStatus === 'ongoing'
                            ? isLongHolidayEndingSoon
                              ? 'bg-red-950/50 border-red-500/40 shadow-inner'
                              : 'bg-amber-950/50 border-amber-500/40 shadow-inner'
                            : 'bg-amber-950/40 border-amber-500/30'
                        }`}>
                          {longHolidayDisplayStatus === 'upcoming' && (
                            <div className="flex flex-col items-center">
                              <Timer className="w-8 h-8 text-amber-400 mb-3 animate-pulse" />
                              <span className="text-amber-400 font-bold mb-4 text-sm">กิจกรรมกำลังจะเริ่มใน</span>
                              <CountdownBoxes parts={longHolidayDisplayCountdown} color="amber" showDays={true} />
                            </div>
                          )}

                          {longHolidayDisplayStatus === 'ongoing' && !isLongHolidayEndingSoon && (
                            <div className="flex flex-col items-center">
                              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-amber-500 via-amber-500 to-red-500"></div>
                              <Flame className="w-8 h-8 text-amber-400 mb-3 animate-bounce filter drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                              <span className="text-amber-300 font-bold mb-4 flex items-center gap-2 text-sm">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                                </span>
                                กิจกรรมกำลังจัดขึ้น!
                              </span>
                              <div className="text-[11px] text-amber-200/70 mb-2 font-medium">สิ้นสุดใน</div>
                              <CountdownBoxes parts={longHolidayDisplayCountdown} color="orange" showDays={true} />

                              <div className="mt-5 pt-4 border-t border-amber-500/20 w-full text-center">
                                <div className="text-[11px] text-amber-200/70 mb-1 font-medium">แต้มสะสมจากกิจกรรมวันนี้</div>
                                <div className="text-2xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-amber-400 to-red-400">
                                  +{Math.floor((user.daily_diamonds || 0) / 100)} <span className="text-sm font-sans text-amber-400">PTS</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {longHolidayDisplayStatus === 'ongoing' && isLongHolidayEndingSoon && (
                            <div className="flex flex-col items-center">
                              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-red-500 to-amber-500 animate-pulse"></div>
                              <Timer className="w-8 h-8 text-red-400 mb-3 animate-pulse filter drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                              <span className="text-red-400 font-bold mb-4 flex items-center gap-2 text-sm">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                </span>
                                กิจกรรมกำลังจะจบลง!
                              </span>
                              <div className="text-[11px] text-red-200/70 mb-2 font-medium">สิ้นสุดใน</div>
                              <CountdownBoxes parts={longHolidayDisplayCountdown} color="rose" showDays={true} />

                              <div className="mt-5 pt-4 border-t border-red-500/20 w-full text-center">
                                <div className="text-[11px] text-red-200/70 mb-1 font-medium">แต้มสะสมจากกิจกรรมวันนี้</div>
                                <div className="text-2xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-amber-400">
                                  +{Math.floor((user.daily_diamonds || 0) / 100)} <span className="text-sm font-sans text-red-400">PTS</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Special Event Card (Sat Only) */}
              <div className="mb-6 relative overflow-hidden rounded-3xl">
                {isLocked && (
                  <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center border border-red-500/20 rounded-3xl">
                    <span className="text-4xl mb-2">🔒</span>
                    <h2 className="text-xl font-bold text-white mb-1">ไม่มีสิทธิ์เข้าร่วมกิจกรรม</h2>
                    <p className="text-zinc-300 text-sm text-center">ต้องได้รับสิทธิ์ TTV ก่อน</p>
                  </div>
                )}
                <div className={isLocked ? "pointer-events-none blur-sm" : ""}>
                  <div className={`backdrop-blur-md border p-8 rounded-3xl relative overflow-hidden group transition-all duration-500 ${displayStatus === 'ongoing'
                    ? isEndingSoon
                      ? 'bg-gradient-to-r from-rose-600/10 via-red-600/10 to-amber-600/10 border-rose-500/40 shadow-[0_0_30px_rgba(244,63,94,0.15)]'
                      : 'bg-gradient-to-r from-yellow-600/10 via-amber-600/10 to-rose-600/10 border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.15)]'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}>
                    {/* Background elements */}
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-all duration-700 transform group-hover:rotate-12 group-hover:scale-110 pointer-events-none">
                      <Sparkles className={`w-48 h-48 ${displayStatus === 'ongoing' ? (isEndingSoon ? 'text-rose-400' : 'text-amber-400') : 'text-zinc-500'}`} />
                    </div>

                    <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <span className={`text-xs font-bold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${displayStatus === 'ongoing'
                            ? isEndingSoon
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                              : 'bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}>
                            <Sparkles className="w-3.5 h-3.5" />
                            Special Event
                          </span>
                          <span className="text-zinc-400 text-sm font-medium flex items-center gap-1.5">
                            <Timer className="w-4 h-4" /> ทุกวัน เสาร์-อาทิตย์
                          </span>
                        </div>

                        <h3 className={`text-3xl font-black text-transparent bg-clip-text drop-shadow-sm mb-3 ${displayStatus === 'ongoing'
                          ? isEndingSoon
                            ? 'bg-gradient-to-r from-rose-400 to-amber-400'
                            : 'bg-gradient-to-r from-yellow-400 to-amber-400'
                          : 'bg-gradient-to-r from-zinc-300 to-zinc-500'
                          }`}>
                          สุดสัปดาห์ล่า Point 🔥
                        </h3>

                        <p className="text-zinc-300 flex items-center gap-2 text-sm sm:text-base">
                          รับคะแนนพิเศษจากของขวัญไลฟ์! <span className={`font-bold px-2.5 py-1 rounded-lg border ${displayStatus === 'ongoing'
                            ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                            : 'text-zinc-300 bg-zinc-800 border-zinc-700'
                            }`}>100 เพชร = 1 Point</span>
                        </p>

                        {/* Dev mode toggles removed */}
                      </div>

                      <div className={`border rounded-2xl p-6 w-full lg:w-72 backdrop-blur-sm relative overflow-hidden transition-all duration-500 shrink-0 ${displayStatus === 'ongoing'
                        ? isEndingSoon
                          ? 'bg-rose-950/40 border-rose-500/30'
                          : 'bg-amber-950/40 border-amber-500/30'
                        : 'bg-black/40 border-white/5'
                        }`}>
                        {displayStatus === 'upcoming' && (
                          <div className="flex flex-col items-center">
                            <Timer className="w-8 h-8 text-amber-400 mb-3" />
                            <span className="text-amber-400 font-bold mb-4 text-sm">กิจกรรมกำลังจะเริ่มใน</span>
                            <CountdownBoxes parts={displayCountdown} color="amber" showDays={true} />
                          </div>
                        )}

                        {displayStatus === 'ongoing' && !isEndingSoon && (
                          <div className="flex flex-col items-center">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-500 to-amber-500"></div>
                            <Flame className="w-8 h-8 text-amber-500 mb-3 animate-bounce" />
                            <span className="text-amber-400 font-bold mb-4 flex items-center gap-2">
                              <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                              </span>
                              กิจกรรมกำลังจัดขึ้น!
                            </span>
                            <div className="text-[11px] text-amber-300/70 mb-2 font-medium">สิ้นสุดใน</div>
                            <CountdownBoxes parts={displayCountdown} color="pink" showDays={false} />

                            <div className="mt-5 pt-4 border-t border-amber-500/20 w-full text-center">
                              <div className="text-[11px] text-amber-300/70 mb-1 font-medium">แต้มสะสมจากกิจกรรมวันนี้</div>
                              <div className="text-2xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-rose-400">
                                +{Math.floor((user.daily_diamonds || 0) / 100)} <span className="text-sm font-sans text-amber-500">PTS</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {displayStatus === 'ongoing' && isEndingSoon && (
                          <div className="flex flex-col items-center">
                            <div className="absolute top-0 left-0 w-full h-1 bg-rose-500 animate-pulse"></div>
                            <Timer className="w-8 h-8 text-rose-500 mb-3 animate-pulse" />
                            <span className="text-rose-400 font-bold mb-4 flex items-center gap-2">
                              <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                              </span>
                              กิจกรรมกำลังจะจบลง!
                            </span>
                            <CountdownBoxes parts={displayCountdown} color="rose" showDays={false} />

                            <div className="mt-5 pt-4 border-t border-rose-500/20 w-full text-center">
                              <div className="text-[11px] text-rose-300/70 mb-1 font-medium">แต้มสะสมจากกิจกรรมวันนี้</div>
                              <div className="text-2xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-amber-400">
                                +{Math.floor((user.daily_diamonds || 0) / 100)} <span className="text-sm font-sans text-rose-500">PTS</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {displayStatus === 'ended' && (
                          <div className="flex flex-col items-center opacity-60 py-4">
                            <Box className="w-10 h-10 text-zinc-500 mb-3" />
                            <span className="text-zinc-400 font-bold">กิจกรรมจบลงแล้ว</span>
                            <div className="mt-5 pt-4 border-t border-white/10 w-full text-center">
                              <div className="text-[11px] text-zinc-500 mb-1 font-medium">สรุปแต้มที่ได้จากกิจกรรม</div>
                              <div className="text-xl font-mono font-bold text-zinc-400">
                                +{Math.floor((user.daily_diamonds || 0) / 100)} PTS
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <h2 className="text-lg font-black text-yellow-400 mb-3">บัญชีของฉัน และการเชื่อมต่อ TikTok</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-8 rounded-3xl hover:bg-white/10 transition-colors flex flex-col">
                  <div>
                    <div className="flex justify-between items-center mb-4 gap-2 flex-wrap">
                      <h3 className="text-lg font-medium text-zinc-400">โปรไฟล์</h3>
                      {actualIsOwner && (
                        <div className="flex gap-1.5 flex-wrap">
                          <button onClick={() => setSimulatedRole(null)} className={`px-2 py-1 text-[10px] sm:text-xs rounded border transition-colors ${!simulatedRole ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50' : 'bg-black/30 text-zinc-500 border-white/10 hover:text-zinc-300'}`}>OWNER&Admin</button>
                          <button onClick={() => setSimulatedRole('ttv')} className={`px-2 py-1 text-[10px] sm:text-xs rounded border transition-colors ${simulatedRole === 'ttv' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-black/30 text-zinc-500 border-white/10 hover:text-zinc-300'}`}>ผู้ใช้งาน LINE UP</button>
                          <button onClick={() => setSimulatedRole('customize')} className={`px-2 py-1 text-[10px] sm:text-xs rounded border transition-colors ${simulatedRole === 'customize' ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-black/30 text-zinc-500 border-white/10 hover:text-zinc-300'}`}>Customize</button>
                          <button onClick={() => setSimulatedRole('user')} className={`px-2 py-1 text-[10px] sm:text-xs rounded border transition-colors ${simulatedRole === 'user' ? 'bg-zinc-700/50 text-zinc-300 border-zinc-500/50' : 'bg-black/30 text-zinc-500 border-white/10 hover:text-zinc-300'}`}>ผู้ใช้งาน (ทั่วไป)</button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-4">
                        {sessionUser.image ? (
                          <img src={sessionUser.image} alt={sessionUser.name} className="w-16 h-16 rounded-full border-2 border-yellow-500/50" />
                        ) : (
                          <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-amber-500 rounded-full flex items-center justify-center">
                            <UserCircle className="w-10 h-10 text-white/80" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-3xl font-bold truncate max-w-full" title={sessionUser.name}>{sessionUser.name}</p>
                          <p className="text-sm text-zinc-500 mt-1">ID: {sessionUser.id}</p>
                        </div>
                      </div>

                      {/* Shield UI */}
                      <div className="relative">
                        {isLocked && (
                          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center border border-red-500/20 rounded-xl cursor-not-allowed">
                            <span className="text-lg">🔒</span>
                          </div>
                        )}
                        <div className={`flex flex-col items-center justify-center bg-black/20 p-2 px-3 rounded-xl border border-white/5 shadow-inner shrink-0 ${isLocked ? 'blur-sm' : ''}`}>
                          <div className="relative">
                            <Shield className="w-8 h-8 text-yellow-400" />
                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white pt-0.5">x{user.shields || 0}</span>
                          </div>
                          <span className="text-[9px] text-zinc-400 mt-1">โล่ป้องกันหัก LP</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Level System UI */}
                  <div className="mt-auto pt-6 relative">
                    {isLocked && (
                      <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center border border-red-500/20 rounded-xl cursor-not-allowed mt-4">
                        <span className="text-2xl">🔒 ล็อกสิทธิ์</span>
                      </div>
                    )}
                    <div className={isLocked ? 'blur-sm' : ''}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 relative group cursor-help">
                          <div className={`p-1.5 rounded-lg ${levelInfo.isMax ? 'bg-amber-500/20 text-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-rose-500/20 text-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]'}`}>
                            <Flame className="w-5 h-5" />
                          </div>
                          <span className="font-bold text-lg text-white">LEVEL {levelInfo.level} {levelInfo.isMax && 'MAX'}</span>

                          {/* Tooltip */}
                          <div className="absolute bottom-full left-0 mb-3 w-80 bg-zinc-900 border border-zinc-700/50 rounded-xl p-4 shadow-2xl opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-50 translate-y-2 group-hover:translate-y-0">
                            <h5 className="font-semibold text-white mb-2 flex items-center gap-1.5">
                              <Trophy className="w-4 h-4 text-amber-400" />
                              เป้าหมายโบนัสรายวัน
                            </h5>
                            <ul className="space-y-2 text-sm">
                              <li className="flex justify-between items-center text-zinc-300">
                                <span>Level 2 (1,500 เพชร)</span>
                                <div>
                                  <span className="text-emerald-400 font-medium">+4 PTS</span>
                                  <span className="text-yellow-400 font-medium ml-2 text-[10px] bg-yellow-500/20 px-1.5 py-0.5 rounded">คูปอง -5%</span>
                                </div>
                              </li>
                              <li className="flex justify-between items-center text-zinc-300">
                                <span>Level 3 (4,500 เพชร)</span>
                                <div>
                                  <span className="text-emerald-400 font-medium">+10 PTS</span>
                                  <span className="text-yellow-400 font-medium ml-2 text-[10px] bg-yellow-500/20 px-1.5 py-0.5 rounded">คูปอง -10%</span>
                                </div>
                              </li>
                              <li className="flex justify-between items-center text-zinc-300">
                                <span>Level 4 (13,500 เพชร)</span>
                                <div>
                                  <span className="text-emerald-400 font-medium">+20 PTS</span>
                                  <span className="text-yellow-400 font-medium ml-2 text-[10px] bg-yellow-500/20 px-1.5 py-0.5 rounded">คูปอง -20%</span>
                                </div>
                              </li>
                            </ul>
                            <div className="absolute -bottom-2 left-6 w-4 h-4 bg-zinc-900 border-b border-r border-zinc-700/50 transform rotate-45"></div>
                          </div>
                        </div>
                        {!levelInfo.isMax && (
                          <span className="text-sm text-zinc-400 font-medium">{levelInfo.current} / {levelInfo.max} LP</span>
                        )}
                        {levelInfo.isMax && (
                          <span className="text-sm text-amber-400 font-medium">{totalLp} LP</span>
                        )}
                      </div>
                    </div>
                    <div className="h-3 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${levelInfo.isMax ? 'bg-gradient-to-r from-amber-400 to-yellow-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]' : 'bg-gradient-to-r from-rose-500 to-amber-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'}`}
                        style={{ width: levelInfo.isMax ? '100%' : `${Math.min((levelInfo.current / levelInfo.max) * 100, 100)}%` }}
                      ></div>
                    </div>
                    <div className="mt-3 flex items-center text-[11px] text-zinc-500">
                      <span>⚠️ หากทำภารกิจรายวันขั้นต่ำไม่สำเร็จ จะถูกหัก <span className="text-red-400 font-medium">-100 LP</span></span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-amber-500/10 to-yellow-500/10 backdrop-blur-md border border-amber-500/20 p-8 rounded-3xl hover:from-amber-500/20 hover:to-yellow-500/20 transition-all flex flex-col justify-between relative overflow-hidden">
                  {isTrackerLocked && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center border border-red-500/20 rounded-3xl">
                      <span className="text-4xl mb-2">🔒</span>
                      <h2 className="text-xl font-bold text-white mb-1">ไม่มีสิทธิ์เชื่อมต่อ</h2>
                      <p className="text-zinc-300 text-sm text-center">ต้องได้รับสิทธิ์ TTV ก่อน</p>
                    </div>
                  )}
                  <div className={isTrackerLocked ? "pointer-events-none blur-sm" : ""}>
                    <h3 className="text-lg font-medium text-zinc-400 mb-2">บัญชี TikTok ที่เชื่อมต่อ</h3>
                    <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-400">
                      @{user.tiktok_username}
                    </p>

                  </div>

                  <div className="flex flex-col gap-4 bg-black/30 rounded-xl p-4 border border-white/5 mt-5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-300 flex items-center gap-2">
                        <Video className={`w-4 h-4 ${(trackerStatus.includes('Connected') || trackerStatus.includes('กำลังส่อง')) && connectedUsername === user.tiktok_username ? 'text-rose-400' : 'text-zinc-400'}`} />
                        {(trackerStatus.includes('Connected') || trackerStatus.includes('กำลังส่อง')) && connectedUsername === user.tiktok_username ? 'กำลังไลฟ์' : trackerStatus}
                      </span>
                    </div>

                    <div className="flex items-center justify-end mt-2">
                      {(trackerStatus.includes('Connected') || trackerStatus.includes('กำลังส่อง')) && connectedUsername === user.tiktok_username ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (typeof window !== 'undefined' && window.electron && window.electron.manualConnectV1) {
                                window.electron.manualConnectV1();
                              }
                            }}
                            disabled={v1Status === 'Connected' || v1Status === 'Connecting'}
                            className={`text-xs font-bold px-4 py-1.5 rounded-lg text-white transition-colors flex items-center gap-2 border ${
                              v1Status === 'Connected' ? 'bg-emerald-500 border-emerald-400 cursor-not-allowed' :
                              v1Status === 'Connecting' ? 'bg-amber-500 border-amber-400 cursor-not-allowed' :
                              v1Status === 'Suspended' ? 'bg-red-500 hover:bg-red-600 border-red-400' :
                              v1Status === 'Disconnected' ? 'bg-zinc-500 hover:bg-zinc-600 border-zinc-400/30' :
                              'bg-yellow-500/80 hover:bg-yellow-600 border-yellow-400/30'
                            }`}
                          >
                            {v1Status === 'Connected' ? 'เชื่อมต่อแล้ว' :
                             v1Status === 'Connecting' ? 'กำลังเชื่อมต่อ...' :
                             v1Status === 'Suspended' ? 'ถูกระงับ' : 
                             v1Status === 'Disconnected' ? 'หลุดเชื่อมต่อ' : 'เชื่อมต่อ (สำรอง)'}
                          </button>
                          <span className="text-rose-400 border-rose-500/20 bg-rose-500/10 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 border">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"></span>
                            </span>
                            LIVE
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 border-emerald-500/20 bg-emerald-500/10 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 border">
                            <span className="relative flex h-2 w-2">
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
                            </span>
                            พร้อม
                          </span>
                          <button
                            onClick={() => {
                              if (typeof window !== 'undefined' && window.electron && window.electron.manualConnectV1) {
                                window.electron.manualConnectV1();
                              }
                            }}
                            disabled={v1Status === 'Connected' || v1Status === 'Connecting'}
                            className={`text-xs font-bold px-4 py-2 rounded-lg text-white transition-colors flex items-center gap-2 border ${
                              v1Status === 'Connected' ? 'bg-emerald-500 border-emerald-400 cursor-not-allowed' :
                              v1Status === 'Connecting' ? 'bg-amber-500 border-amber-400 cursor-not-allowed' :
                              v1Status === 'Suspended' ? 'bg-red-500 hover:bg-red-600 border-red-400' :
                              v1Status === 'Disconnected' ? 'bg-zinc-500 hover:bg-zinc-600 border-zinc-400/30' :
                              'bg-yellow-500/80 hover:bg-yellow-600 border-yellow-400/30'
                            }`}
                          >
                            {v1Status === 'Connected' ? 'เชื่อมต่อแล้ว' :
                             v1Status === 'Connecting' ? 'กำลังเชื่อมต่อ...' :
                             v1Status === 'Suspended' ? 'ถูกระงับ' : 
                             v1Status === 'Disconnected' ? 'หลุดเชื่อมต่อ' : 'เชื่อมต่อ'}
                          </button>
                          <button
                            onClick={() => {
                              if (typeof window !== 'undefined' && window.electron && user?.tiktok_username) {
                                window.electron.startTracking({
                                  listenUsername: user.tiktok_username,
                                  creditUsername: user.tiktok_username
                                });
                              }
                            }}
                            className="text-xs font-bold px-4 py-2 rounded-lg text-white transition-colors flex items-center gap-2 bg-rose-500 hover:bg-rose-600"
                          >
                            Connect Scraper
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Second Row: Points and Mission */}
              <h2 className="text-lg font-black text-yellow-400 mt-10 mb-3">แต้มและภารกิจ</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Points Card */}
                <div className="bg-gradient-to-r from-amber-500/10 to-amber-500/10 backdrop-blur-md border border-amber-500/20 p-8 rounded-3xl relative overflow-hidden group hover:border-amber-500/40 transition-all flex flex-col justify-center">
                  {isLocked && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center border border-red-500/20 rounded-3xl">
                      <span className="text-4xl mb-2">🔒</span>
                      <h2 className="text-xl font-bold text-white mb-1">ไม่มีสิทธิ์ดูคะแนน</h2>
                      <p className="text-zinc-300 text-sm text-center">ต้องได้รับสิทธิ์ TTV ก่อน</p>
                    </div>
                  )}
                  <div className={isLocked ? "pointer-events-none blur-sm" : ""}>
                    <div className="absolute -top-10 -right-10 opacity-10 group-hover:opacity-20 transition-opacity transform group-hover:scale-110 duration-500">
                      <Trophy className="w-64 h-64 text-amber-500" />
                    </div>
                    <div className="relative z-10">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-xl font-medium text-amber-400">คะแนนสะสมของคุณ</h3>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => setIsRedeemOpen(true)}
                            className="bg-gradient-to-r from-amber-500 to-amber-500 hover:from-amber-400 hover:to-amber-400 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)] px-4 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all transform hover:scale-105 active:scale-95"
                          >
                            <Gift className="w-4 h-4" /> แลกของรางวัล
                          </button>
                          <button
                            onClick={() => setIsHistoryOpen(true)}
                            className="bg-black/30 hover:bg-black/50 border border-white/10 px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-300 flex items-center justify-center gap-1.5 transition-all"
                          >
                            <span>📜</span> ประวัติการแลก
                          </button>
                          <button
                            onClick={() => setIsPtsHistoryOpen(true)}
                            className="bg-black/30 hover:bg-black/50 border border-white/10 px-4 py-2 rounded-xl text-xs font-medium text-amber-400 hover:text-amber-300 flex items-center justify-center gap-1.5 transition-all mt-1"
                          >
                            <span>⭐</span> ประวัติการรับแต้ม
                          </button>
                        </div>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 drop-shadow-[0_0_20px_rgba(245,158,11,0.4)]">
                          {user.total_points || 0}
                        </span>
                        <span className="text-2xl text-amber-500/70 font-bold tracking-wider">PTS</span>
                      </div>

                      {/*
              <div className="mt-6 pt-4 border-t border-amber-500/20">
                <p className="text-xs text-amber-500/70 uppercase tracking-wider mb-2">รีเซ็ตคะแนนในอีก</p>
                {timeLeft ? (
                  <div className="flex gap-2 text-amber-400 font-mono text-lg font-bold">
                    <div className="bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 text-center min-w-[3rem]">
                      {timeLeft.days.toString().padStart(2, '0')}
                      <span className="block text-[10px] text-amber-500/50 uppercase font-sans mt-0.5">วัน</span>
                    </div>
                    <span className="self-center">:</span>
                    <div className="bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 text-center min-w-[3rem]">
                      {timeLeft.hours.toString().padStart(2, '0')}
                      <span className="block text-[10px] text-amber-500/50 uppercase font-sans mt-0.5">ชม.</span>
                    </div>
                    <span className="self-center">:</span>
                    <div className="bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 text-center min-w-[3rem]">
                      {timeLeft.minutes.toString().padStart(2, '0')}
                      <span className="block text-[10px] text-amber-500/50 uppercase font-sans mt-0.5">นาที</span>
                    </div>
                    <span className="self-center">:</span>
                    <div className="bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 text-center min-w-[3rem]">
                      {timeLeft.seconds.toString().padStart(2, '0')}
                      <span className="block text-[10px] text-amber-500/50 uppercase font-sans mt-0.5">วิ.</span>
                    </div>
                  </div>
                ) : (
                  <div className="h-[52px] flex items-center text-sm text-zinc-500">กำลังคำนวณเวลา...</div>
                )}
              </div>
              */}
                    </div>
                  </div>
                </div>

                {/* Mission Card */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-8 rounded-3xl hover:bg-white/10 transition-colors flex flex-col justify-center relative overflow-hidden">
                  {isLocked && (
                    <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center border border-red-500/20 rounded-3xl">
                      <span className="text-4xl mb-2">🔒</span>
                      <h2 className="text-xl font-bold text-white mb-1">ไม่มีสิทธิ์เข้าถึงภารกิจ</h2>
                      <p className="text-zinc-300 text-sm text-center">ต้องได้รับสิทธิ์ TTV ก่อน</p>
                    </div>
                  )}
                  <div className={isLocked ? "pointer-events-none blur-sm" : ""}>
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <h4 className="font-medium text-zinc-300 flex items-center gap-2 whitespace-nowrap">
                          <Target className="w-5 h-5 text-amber-400" />
                          ภารกิจประจำวัน
                        </h4>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-amber-400 text-xs font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 whitespace-nowrap">
                            ขั้นต่ำ: +20 Point
                          </span>
                          <span className="text-amber-400 text-xs font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 flex items-center gap-1 whitespace-nowrap">
                            <Flame className="w-3 h-3" /> +50 LP
                          </span>
                          {levelInfo.level > 1 && (
                            <span className="text-rose-400 text-xs font-semibold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 flex items-center gap-1 whitespace-nowrap">
                              โบนัส: +{rewardBonusPoints} Point
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-amber-600/70 whitespace-nowrap">รีเซ็ตใน</span>
                        <CountdownBoxes parts={daily} color="amber" showDays={false} />
                        {user.mission_completed_today ? (
                          <span className="bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full font-medium border border-emerald-500/30 flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.3)] whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3" /> สำเร็จแล้ว! (+20 PTS, +50 LP{user.bonus_claimed_today ? `, โบนัส +${rewardBonusPoints} PTS` : ''})
                          </span>
                        ) : (
                          <span className="bg-zinc-800 text-zinc-400 text-xs px-3 py-1.5 rounded-full font-medium border border-zinc-700 whitespace-nowrap">
                            กำลังดำเนินการ
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-5">
                      {/* Weekly Mission Progress */}
                      <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-2xl relative overflow-hidden mb-2">
                        <div className="absolute top-0 right-0 p-3 opacity-20"><Shield className="w-12 h-12 text-yellow-400" /></div>
                        <div className="flex justify-between items-start text-sm mb-3 relative z-10">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-yellow-400 font-semibold flex items-center gap-1.5">
                                <Shield className="w-4 h-4" /> ภารกิจสัปดาห์
                              </span>
                              <span className="text-amber-400 text-xs font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 whitespace-nowrap">
                                +300 Point
                              </span>
                              <span className="text-yellow-400 text-xs font-semibold bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 whitespace-nowrap flex items-center gap-1">
                                +1 <Shield className="w-3 h-3" />
                              </span>
                            </div>
                            <span className="text-[11px] text-yellow-300/80">ทำภารกิจรายวันให้ครบ 5 ภายใน 1 อาทิตย์</span>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="font-mono text-yellow-400 font-bold bg-yellow-500/10 px-2 py-1 rounded-lg border border-yellow-500/20">
                              {user.weekly_mission_count || 0} / 5 ครั้ง
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-yellow-400/50 whitespace-nowrap">รีเซ็ตใน</span>
                              <CountdownBoxes parts={weekly} color="indigo" />
                            </div>
                          </div>
                        </div>
                        <div className="h-2.5 w-full bg-black/50 rounded-full overflow-hidden border border-white/5 relative z-10">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${user.weekly_mission_completed ? 'bg-yellow-500 shadow-[0_0_10px_rgba(250,204,21,0.8)]' : 'bg-gradient-to-r from-yellow-500 to-amber-500'}`}
                            style={{ width: `${Math.min(((user.weekly_mission_count || 0) / 5) * 100, 100)}%` }}
                          ></div>
                        </div>
                        {user.weekly_mission_completed && (
                          <div className="mt-3 text-xs text-yellow-300 font-medium flex items-center gap-1 relative z-10">
                            <CheckCircle2 className="w-3.5 h-3.5" /> ยินดีด้วย! คุณได้รับรางวัลประจำสัปดาห์แล้ว
                          </div>
                        )}
                      </div>

                      {/* Base Diamonds Progress */}
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-zinc-400">💎 ผ่านเกณฑ์ขั้นต่ำ (500 เพชร)</span>
                          <span className="font-mono text-emerald-400">
                            {user.daily_diamonds || 0} / 500
                          </span>
                        </div>
                        <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                            style={{ width: `${Math.min(((user.daily_diamonds || 0) / 500) * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Bonus Diamonds Progress (Level 2+) */}
                      {levelInfo.level > 1 && (
                        <div>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-rose-400/80 flex items-center gap-1"><Flame className="w-4 h-4" /> โบนัสเลเวล {levelInfo.level} ({targetBonusDiamonds.toLocaleString()} เพชร)</span>
                            <span className="font-mono text-rose-400">
                              {user.daily_diamonds || 0} / {targetBonusDiamonds.toLocaleString()}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
                            <div
                              className="h-full bg-rose-500 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(244,63,94,0.5)]"
                              style={{ width: `${Math.min(((user.daily_diamonds || 0) / targetBonusDiamonds) * 100, 100)}%` }}
                            ></div>
                          </div>
                        </div>
                      )}

                      {/* Live Minutes Progress */}
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-zinc-400">เวลาไลฟ์ (60 นาที) ใน 1 ไลฟ์</span>
                          <span className={`font-medium ${user.daily_live_minutes >= 60 ? 'text-emerald-400' : 'text-white'}`}>
                            {Math.min(user.daily_live_minutes || 0, 60)} / 60
                          </span>
                        </div>
                        <div className="h-2.5 w-full bg-black/50 rounded-full overflow-hidden border border-white/5">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${user.daily_live_minutes >= 60 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-gradient-to-r from-rose-500 to-amber-500'}`}
                            style={{ width: `${Math.min(((user.daily_live_minutes || 0) / 60) * 100, 100)}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Removed Live Status from here */}
                    </div>
                  </div>
                </div>
              </div>


              {/* Redeem Modal */}
              {isRedeemOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                    <button
                      onClick={() => setIsRedeemOpen(false)}
                      className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors bg-black/50 p-2 rounded-full"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-2">
                      <Gift className="w-6 h-6 text-amber-500" /> แลกของรางวัล
                    </h2>
                    <p className="text-zinc-400 text-sm mb-6">แต้มสะสมของคุณ: <span className="text-amber-400 font-bold">{user.total_points || 0} PTS</span></p>

                    {redeemMessage && (
                      <div className={`p-4 rounded-xl mb-6 text-sm font-medium border ${redeemMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                        {redeemMessage.text}
                      </div>
                    )}

                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-3">1. เลือกคูปองที่ต้องการแลก</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {coupons.map((coupon, idx) => {
                            const discountedPoints = Math.round(coupon.points * (1 - discountPercent / 100));
                            const canAfford = (user.total_points || 0) >= discountedPoints;
                            const isSelected = selectedCoupon?.name === coupon.name;
                            return (
                              <button
                                key={idx}
                                disabled={!canAfford || isRedeeming}
                                onClick={() => setSelectedCoupon({ ...coupon, points: discountedPoints })}
                                className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${isSelected
                                  ? 'bg-amber-500/20 border-amber-500 text-white shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                  : !canAfford
                                    ? 'bg-black/40 border-zinc-800/50 text-zinc-600 cursor-not-allowed'
                                    : 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:bg-zinc-800'
                                  }`}
                              >
                                {discountPercent > 0 && (
                                  <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    ลด {discountPercent}%
                                  </div>
                                )}
                                <div className="font-bold text-lg">{coupon.name}</div>
                                <div className={`text-sm mt-1 flex items-center gap-2 ${isSelected ? 'text-amber-400' : 'text-zinc-500'}`}>
                                  {discountPercent > 0 ? (
                                    <>
                                      <span className="line-through opacity-50">{coupon.points}</span>
                                      <span className="font-bold text-amber-400">{discountedPoints} PTS</span>
                                    </>
                                  ) : (
                                    <span>ใช้ {coupon.points} PTS</span>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-3">2. ข้อมูลรับเงิน (เลือกธนาคารและกรอกเลขบัญชี)</label>
                        <div className="space-y-3">
                          <div className="relative">
                            <select
                              value={paymentData.bank}
                              onChange={(e) => setPaymentData({ ...paymentData, bank: e.target.value })}
                              disabled={isRedeeming}
                              className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white appearance-none focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all"
                            >
                              {THAI_BANKS.map((bank) => (
                                <option key={bank.id} value={bank.id} className="bg-zinc-900 text-white">
                                  {bank.name}
                                </option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400">
                              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                            </div>
                          </div>
                          <input
                            type="text"
                            value={paymentData.account_no}
                            onChange={(e) => setPaymentData({ ...paymentData, account_no: e.target.value })}
                            disabled={isRedeeming}
                            placeholder={paymentData.bank === 'promptpay' ? "เลขบัญชี พร้อมเพย์" : "เลขบัญชีธนาคาร"}
                            className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all"
                          />
                          <input
                            type="text"
                            value={paymentData.account_name}
                            onChange={(e) => setPaymentData({ ...paymentData, account_name: e.target.value })}
                            disabled={isRedeeming}
                            placeholder="ชื่อ - นามสกุล เจ้าของบัญชี"
                            className="w-full bg-black/50 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 transition-all"
                          />
                        </div>
                        <p className="text-xs text-zinc-500 mt-2">* ระบบจะบันทึกข้อมูลนี้ไว้ใช้ในครั้งต่อไปให้อัตโนมัติ</p>
                      </div>

                      <button
                        onClick={handleRedeem}
                        disabled={isRedeeming || !selectedCoupon || !paymentData.account_no.trim() || !paymentData.account_name.trim()}
                        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${isRedeeming || !selectedCoupon || !paymentData.account_no.trim() || !paymentData.account_name.trim()
                          ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-amber-500 to-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:from-amber-400 hover:to-amber-400 hover:scale-[1.02] active:scale-[0.98]'
                          }`}
                      >
                        {isRedeeming ? (
                          <>
                            <span className="animate-spin h-5 w-5 border-2 border-white/20 border-t-white rounded-full"></span>
                            กำลังดำเนินการ...
                          </>
                        ) : (
                          <>
                            ยืนยันการแลกรางวัล
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* History Modal */}
              {/* Points History Modal */}
              {isPtsHistoryOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                    <button
                      onClick={() => setIsPtsHistoryOpen(false)}
                      className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors bg-black/50 p-2 rounded-full"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-6">
                      <Star className="w-6 h-6 text-amber-500" /> ประวัติการรับแต้ม
                    </h2>

                    <div className="space-y-3">
                      {(() => {
                        let history: any[] = [];
                        try {
                          if (user.pts_history) {
                            history = typeof user.pts_history === 'string'
                              ? JSON.parse(user.pts_history)
                              : user.pts_history;
                          }
                        } catch (e) { }

                        if (!Array.isArray(history) || history.length === 0) {
                          return (
                            <div className="text-center p-8 bg-zinc-800/30 rounded-2xl border border-zinc-800/50">
                              <Star className="w-12 h-12 text-zinc-600 mx-auto mb-3 opacity-50" />
                              <p className="text-zinc-400 font-medium">ยังไม่มีประวัติการรับแต้ม</p>
                              <p className="text-zinc-500 text-sm mt-1">แต้มที่ได้จากภารกิจจะแสดงที่นี่</p>
                            </div>
                          );
                        }

                        // เรียงจากใหม่ไปเก่า
                        const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                        return sortedHistory.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/50 hover:border-amber-500/30 transition-colors">
                            <div>
                              <p className="text-white font-medium">{item.reason}</p>
                              <p className="text-zinc-400 text-xs mt-1">
                                {new Date(item.date).toLocaleString('th-TH', { 
                                  year: 'numeric', month: 'short', day: 'numeric',
                                  hour: '2-digit', minute: '2-digit'
                                })}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="text-amber-400 font-bold text-lg">+{item.points} PTS</span>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {isHistoryOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsHistoryOpen(false)}></div>
                  <div className="bg-zinc-900 border border-zinc-700/50 rounded-3xl w-full max-w-md relative z-10 overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-white/5 flex justify-between items-center bg-zinc-800/50 sticky top-0 z-20">
                      <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <span>📜</span> ประวัติการแลกรางวัลเดือนนี้
                      </h3>
                      <button
                        onClick={() => setIsHistoryOpen(false)}
                        className="p-2 bg-black/20 hover:bg-black/40 rounded-full text-zinc-400 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="p-6">
                      {currentMonthHistory.length > 0 ? (
                        <div className="space-y-3">
                          {currentMonthHistory.map((item, idx) => {
                            const dateObj = new Date(item.date);
                            const dateStr = dateObj.toLocaleDateString('th-TH', {
                              day: 'numeric', month: 'short', year: '2-digit'
                            });
                            const timeStr = dateObj.toLocaleTimeString('th-TH', {
                              hour: '2-digit', minute: '2-digit'
                            });

                            return (
                              <div key={idx} className="bg-black/30 border border-white/5 rounded-xl p-4 flex justify-between items-center transition-all hover:bg-black/40">
                                <div>
                                  <div className="text-sm font-bold text-emerald-400">{item.coupon}</div>
                                  <div className="text-[11px] text-zinc-500 mt-1">{dateStr} เวลา {timeStr} น.</div>
                                </div>
                                <div className="text-sm font-mono text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-lg border border-zinc-700/50">-{item.points} PTS</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-10">
                          <div className="text-4xl mb-4 opacity-50">📭</div>
                          <p className="text-zinc-500 font-medium">ยังไม่มีประวัติการแลกรางวัลในเดือนนี้</p>
                        </div>
                      )}
                      
                      {sessionUser?.id === '279905202277187584' && (
                        <div className="mt-6 pt-4 border-t border-white/10 flex justify-end gap-3">
                           <button 
                             onClick={async () => {
                               try {
                                 const res = await fetch('/api/cron/coupon-summary?force=1&type=start');
                                 const data = await res.json();
                                 Swal.fire('สำเร็จ', `ส่งสรุปยอดไป Discord สำเร็จ (${data.count || 0} รายการ)`, 'success');
                               } catch (e: any) {
                                 Swal.fire('Error', e.message, 'error');
                               }
                             }}
                             className="px-4 py-2 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded-xl font-bold transition-all flex items-center gap-2"
                           >
                              ทดสอบส่งสรุปยอด (ถึงวันที่ 1)
                           </button>

                           <button 
                             onClick={handleClearHistory}
                             disabled={isClearingHistory}
                             className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2"
                           >
                              {isClearingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              ลบประวัติทั้งหมด (OWNER)
                           </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* End Dashboard View */}
            </>
          )}

          {view === 'counter' && (
            <div className="animate-in fade-in zoom-in-95 duration-300 relative">
              <header className="mb-12">
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-yellow-500 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                  นับวิน
                </h1>
              </header>

              <div className="grid grid-cols-1 gap-6 max-w-xl mx-auto">
                <div className="relative flex items-center justify-center">
                  {isCounterLocked && (
                    <div className="absolute z-50 flex flex-col items-center justify-center pointer-events-auto">
                      <div className="bg-black/80 px-8 py-6 flex flex-col items-center justify-center border border-red-500/40 rounded-3xl shadow-[0_0_30px_rgba(239,68,68,0.3)] backdrop-blur-xl transform transition-transform hover:scale-105">
                        <span className="text-5xl mb-3 drop-shadow-lg">🔒</span>
                        <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 mb-1">ฟีเจอร์ถูกล็อก</h2>
                        <p className="text-zinc-300 text-sm font-medium">ต้องได้รับสิทธิ์ TTV เพื่อใช้งานส่วนนี้</p>
                      </div>
                    </div>
                  )}
                  <div className={`w-full bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl ${isCounterLocked ? 'pointer-events-none blur-[3px] opacity-50' : ''}`}>
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="font-bold text-lg">สถานะการทำงาน</h3>
                      <div className="flex items-center gap-2">
                        <span className={`relative flex h-3 w-3`}>
                          {counterSettings.isRunning && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                          <span className={`relative inline-flex rounded-full h-3 w-3 ${counterSettings.isRunning ? 'bg-emerald-500' : 'bg-zinc-600'}`}></span>
                        </span>
                        <span className={`font-bold ${counterSettings.isRunning ? 'text-emerald-400' : 'text-zinc-500'}`}>
                          {counterSettings.isRunning ? 'กำลังทำงาน' : 'ยังไม่เริ่มทำงาน'}
                        </span>
                      </div>
                    </div>

                    <div className="mb-4">
                      <label className="block text-xs font-medium text-zinc-400 mb-2">URL สำหรับนำไปใส่ในโปรแกรม LIVE:</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value="http://localhost:9001/overlay.html"
                          className="flex-1 bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-zinc-300 font-mono outline-none"
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText("http://localhost:9001/overlay.html");
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${isCopied ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300'}`}
                        >
                          {isCopied ? (
                            <>
                              <CheckCircle2 className="w-4 h-4" />
                              คัดลอกแล้ว
                            </>
                          ) : (
                            'คัดลอก'
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={toggleCounterServer}
                      className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${counterSettings.isRunning
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                        }`}
                    >
                      {counterSettings.isRunning ? 'หยุดการทำงาน' : 'เริ่มทำงานเลย!'}
                    </button>
                  </div>
                </div>
                {/* Live Preview / Counter Adjust */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl text-center relative overflow-hidden">
                  <div className="w-full">
                    <h3 className="font-bold text-lg mb-6">ตั้งค่าวินปัจจุบัน</h3>
                    <div className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-400 mb-8 drop-shadow-xl">
                      {counterSettings.count}<span className="text-zinc-600 font-light mx-2">/</span>{counterSettings.maxCount}
                    </div>

                    <div className="flex justify-center gap-4 mb-6">
                      <button
                        onClick={() => updateCounterSetting('count', counterSettings.count - 1)}
                        className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 text-3xl font-bold flex items-center justify-center hover:bg-rose-500/30 transition-all active:scale-95 shadow-[0_0_15px_rgba(244,63,94,0.2)]"
                      >
                        -
                      </button>
                      <button
                        onClick={() => updateCounterSetting('count', counterSettings.count + 1)}
                        className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-3xl font-bold flex items-center justify-center hover:bg-emerald-500/30 transition-all active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                      >
                        +
                      </button>
                    </div>

                    <div className="mb-6 bg-black/30 p-4 rounded-2xl border border-white/5">
                      <label className="block text-sm font-bold text-zinc-300 mb-3">บวกวินแบบคำนวน</label>
                      <div className="flex justify-center items-center gap-3">
                        <button
                          onClick={() => updateCounterSetting('count', counterSettings.count - calcWinAmount)}
                          className="w-12 h-12 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400 text-2xl font-bold flex items-center justify-center hover:bg-rose-500/30 transition-all active:scale-95"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={calcWinAmount}
                          onChange={(e) => setCalcWinAmount(parseInt(e.target.value) || 0)}
                          className="w-24 bg-black/50 border border-zinc-700/50 rounded-xl px-3 py-2 text-white outline-none focus:border-emerald-500/50 text-center text-lg font-bold"
                        />
                        <button
                          onClick={() => updateCounterSetting('count', counterSettings.count + calcWinAmount)}
                          className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-2xl font-bold flex items-center justify-center hover:bg-emerald-500/30 transition-all active:scale-95"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-left">
                        <label className="block text-xs font-medium text-zinc-400 mb-2">ค่าเริ่มต้น (Count):</label>
                        <input
                          type="number"
                          value={counterSettings.count}
                          onChange={(e) => updateCounterSetting('count', parseInt(e.target.value) || 0)}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="text-left">
                        <label className="block text-xs font-medium text-zinc-400 mb-2">ค่าสูงสุด (Max):</label>
                        <input
                          type="number"
                          value={counterSettings.maxCount}
                          onChange={(e) => updateCounterSetting('maxCount', parseInt(e.target.value) || 0)}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full relative flex items-center justify-center">
                  {isCounterLocked && (
                    <div className="absolute z-50 flex flex-col items-center justify-center pointer-events-auto mt-[-50px]">
                      <div className="bg-black/80 px-8 py-6 flex flex-col items-center justify-center border border-red-500/40 rounded-3xl shadow-[0_0_30px_rgba(239,68,68,0.3)] backdrop-blur-xl transform transition-transform hover:scale-105">
                        <span className="text-5xl mb-3 drop-shadow-lg">🔒</span>
                        <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 mb-1">ฟีเจอร์ถูกล็อก</h2>
                        <p className="text-zinc-300 text-sm font-medium">ต้องได้รับสิทธิ์ TTV เพื่อตั้งค่าเพิ่มเติม</p>
                      </div>
                    </div>
                  )}
                  <div className={`w-full space-y-6 ${isCounterLocked ? 'pointer-events-none blur-[3px] opacity-50' : ''}`}>
                    {/* Hotkeys Card */}
                    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                      <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <span>⌨️</span> ปุ่มลัด
                      </h3>

                      <div className="space-y-4">
                        <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                          <div className="text-zinc-300 font-bold text-sm">ลดค่าวิน (-1)</div>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={counterSettings.hotkeyDecrease?.modifier || 'alt'}
                              onChange={(e) => updateCounterSetting('hotkeyDecrease', { modifier: e.target.value, key: counterSettings.hotkeyDecrease?.key ?? 52 })}
                              className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500/50 text-sm"
                            >
                              {HOTKEY_MODIFIERS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                            <select
                              value={counterSettings.hotkeyDecrease?.key || 52}
                              onChange={(e) => updateCounterSetting('hotkeyDecrease', { modifier: counterSettings.hotkeyDecrease?.modifier || 'alt', key: parseInt(e.target.value) })}
                              className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500/50 text-sm"
                            >
                              {HOTKEY_KEYS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                          <div className="text-zinc-300 font-bold text-sm">เพิ่มค่าวิน (+1)</div>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={counterSettings.hotkeyIncrease?.modifier || 'alt'}
                              onChange={(e) => updateCounterSetting('hotkeyIncrease', { modifier: e.target.value, key: counterSettings.hotkeyIncrease?.key ?? 53 })}
                              className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500/50 text-sm"
                            >
                              {HOTKEY_MODIFIERS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                            <select
                              value={counterSettings.hotkeyIncrease?.key || 53}
                              onChange={(e) => updateCounterSetting('hotkeyIncrease', { modifier: counterSettings.hotkeyIncrease?.modifier || 'alt', key: parseInt(e.target.value) })}
                              className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500/50 text-sm"
                            >
                              {HOTKEY_KEYS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Appearance Settings */}
                    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                      <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                        <span>🎨</span> ตกแต่งสไตล์
                      </h3>

                      <div className="space-y-5">
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-2">รูปแบบ Font</label>
                          <select
                            value={counterSettings.fontFamily}
                            onChange={(e) => updateCounterSetting('fontFamily', e.target.value)}
                            className="w-full bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-white outline-none appearance-none focus:border-emerald-500/50"
                          >
                            {availableFonts.map((font, idx) => (
                              <option key={idx} value={font}>{font}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="flex justify-between mb-2">
                            <label className="text-xs font-medium text-zinc-400">ความหนาเส้นขอบ (Stroke)</label>
                            <span className="text-xs text-emerald-400 font-mono">{counterSettings.strokeSize}px</span>
                          </div>
                          <input
                            type="range" min="0" max="15" step="0.5"
                            value={counterSettings.strokeSize}
                            onChange={(e) => updateCounterSetting('strokeSize', parseFloat(e.target.value))}
                            className="w-full accent-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between mb-2">
                            <label className="text-xs font-medium text-zinc-400">ขนาดเงา (Shadow)</label>
                            <span className="text-xs text-emerald-400 font-mono">{counterSettings.shadowSize}px</span>
                          </div>
                          <input
                            type="range" min="0" max="30" step="1"
                            value={counterSettings.shadowSize}
                            onChange={(e) => updateCounterSetting('shadowSize', parseInt(e.target.value))}
                            className="w-full accent-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between mb-2">
                            <label className="text-xs font-medium text-zinc-400">ระยะห่างตัวอักษร (Spacing)</label>
                            <span className="text-xs text-emerald-400 font-mono">{counterSettings.letterSpacing}px</span>
                          </div>
                          <input
                            type="range" min="-20" max="50" step="1"
                            value={counterSettings.letterSpacing}
                            onChange={(e) => updateCounterSetting('letterSpacing', parseInt(e.target.value))}
                            className="w-full accent-emerald-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Audio Settings Card */}
                    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                      <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <span>🔊</span> เอฟเฟกต์เสียง
                      </h3>

                      <div className="space-y-4">
                        {/* Decrease Sound */}
                        <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                          <div className="text-zinc-300 font-bold text-sm">เสียงเมื่อค่าวินลดลง (-1)</div>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={async () => {
                                if (window.electron && window.electron.selectAudioFile) {
                                  const filename = await window.electron.selectAudioFile();
                                  if (filename) updateCounterSetting('soundDecrease', filename);
                                }
                              }}
                              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-white font-medium transition-colors"
                            >
                              เลือกไฟล์
                            </button>
                            <div className="text-xs text-zinc-400 truncate flex-1">
                              {counterSettings.soundDecrease ? `ไฟล์: ${counterSettings.soundDecrease}` : 'ค่าเริ่มต้น (ติ้ง.mp3)'}
                            </div>
                            {counterSettings.soundDecrease && (
                              <button
                                onClick={() => updateCounterSetting('soundDecrease', null)}
                                className="p-1 hover:bg-red-500/20 text-red-400 rounded-md transition-colors"
                                title="ลบเสียง"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-zinc-400">
                              <span>ความดังเสียง</span>
                              <span>{counterSettings.volumeDecrease ?? 50}%</span>
                            </div>
                            <input
                              type="range" min="0" max="100"
                              value={counterSettings.volumeDecrease ?? 50}
                              onChange={(e) => updateCounterSetting('volumeDecrease', parseInt(e.target.value))}
                              className="w-full accent-rose-500"
                            />
                          </div>
                        </div>

                        {/* Increase Sound */}
                        <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                          <div className="text-zinc-300 font-bold text-sm">เสียงเมื่อค่าวินเพิ่มขึ้น (+1)</div>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={async () => {
                                if (window.electron && window.electron.selectAudioFile) {
                                  const filename = await window.electron.selectAudioFile();
                                  if (filename) updateCounterSetting('soundIncrease', filename);
                                }
                              }}
                              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-lg text-sm text-white font-medium transition-colors"
                            >
                              เลือกไฟล์
                            </button>
                            <div className="text-xs text-zinc-400 truncate flex-1">
                              {counterSettings.soundIncrease ? `ไฟล์: ${counterSettings.soundIncrease}` : 'ค่าเริ่มต้น (ติ้ง.mp3)'}
                            </div>
                            {counterSettings.soundIncrease && (
                              <button
                                onClick={() => updateCounterSetting('soundIncrease', null)}
                                className="p-1 hover:bg-red-500/20 text-red-400 rounded-md transition-colors"
                                title="ลบเสียง"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-zinc-400">
                              <span>ความดังเสียง</span>
                              <span>{counterSettings.volumeIncrease ?? 50}%</span>
                            </div>
                            <input
                              type="range" min="0" max="100"
                              value={counterSettings.volumeIncrease ?? 50}
                              onChange={(e) => updateCounterSetting('volumeIncrease', parseInt(e.target.value))}
                              className="w-full accent-emerald-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}


          {view === 'gifts' && (
            <div className="animate-in fade-in zoom-in-95 duration-300">
              <header className="mb-8 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                <div>
                  <h1 className="text-4xl font-black text-yellow-400">
                    🎁 ระบบของขวัญ
                  </h1>
                  <p className="text-zinc-400 mt-2">ตั้งค่าเหตุการณ์เมื่อได้รับของขวัญ เพื่อสั่งงานปุ่มบนคีย์บอร์ด</p>
                </div>

                {user?.tiktok_username && (
                  <div className="relative">
                    {isTrackerLocked && (
                      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 rounded-2xl pointer-events-auto">
                        <span className="text-xs font-bold text-red-400 drop-shadow-md">🔒 ล็อก</span>
                      </div>
                    )}
                    <div className={`bg-white/5 border border-white/10 px-4 py-3 rounded-2xl text-sm flex flex-col items-start md:items-end gap-1 ${isTrackerLocked ? 'pointer-events-none blur-[2px] opacity-70' : ''}`}>
                      <span className="text-zinc-500 font-medium text-xs">ดักจับของขวัญจากบัญชี TikTok: @{user.tiktok_username}</span>
                      <span className={trackerStatus.includes('Connected') || trackerStatus.includes('กำลังส่อง') ? 'text-emerald-400 font-bold flex items-center gap-2' : 'text-amber-400 font-bold flex items-center gap-2'}>
                        <div className={`w-2 h-2 rounded-full ${trackerStatus.includes('Connected') || trackerStatus.includes('กำลังส่อง') ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`}></div>
                        {trackerStatus}
                      </span>
                    </div>
                  </div>
                )}
              </header>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] gap-6 items-start">
                {/* Preset Management */}
                <div className="min-w-0 space-y-6">
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                      <span>💾</span> Preset
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-2">เลือก Preset</label>
                        <div className="flex gap-2">
                          <select
                            value={activeGiftPresetId || ''}
                            onChange={(e) => {
                              const id = e.target.value;
                              setActiveGiftPresetId(id || null);
                              updateGiftPresetsBackend(giftPresets, id || null);
                            }}
                            className="flex-1 min-w-0 bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-500/50"
                          >
                            <option value="">-- ไม่ได้เลือก --</option>
                            {giftPresets.filter(p => {
                              if (isOwner || isAdmin || (['ttv', 'ttv_star'].includes((user.role || '').toLowerCase()) && (!simulatedRole || simulatedRole === 'ttv'))) return true;
                              if (isCustomize) {
                                if (p.id && String(p.id).includes('_import')) return true;
                                const n = p.name.toLowerCase();
                                if (n.includes('pizza speed')) return hasRobloxGameAccess('pizza_speed');
                                if (n.includes('คิงคอง') || n.includes('donkey')) return hasRobloxGameAccess('donkey_smash');
                                if (n.includes('ต่อตึก') || n.includes('build block')) return hasRobloxGameAccess('build_block');
                                if (n.includes('jump')) return hasRobloxGameAccess('line_up_jump');
                                
                                if (n.includes('ปลูกข้าว')) return hasMinecraftGameAccess('farm');
                                if (n.includes('สโนว์บอล')) return hasMinecraftGameAccess('snowball');
                                if (n.includes('3x3x3')) return true; // Preset เปิดให้ทุกคน (ตัวเกมล็อกไว้เฉพาะ TTV)
                                if (n.includes('ขุดเพชร')) return hasMinecraftGameAccess('havest');
                                if (n.includes('ปากัว')) return hasMinecraftGameAccess('parkour');
                                if (n.includes('ตกหมู')) return hasMinecraftGameAccess('fishing_pig');
                                if (n.includes('ขุดเพชร')) return hasMinecraftGameAccess('diamond_classic');
                                
                                if (n.includes('block game')) return hasOtherGameAccess('block_pvp');
                              }
                              return true;
                            }).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          {activeGiftPresetId && (
                            <button
                              onClick={() => {
                                const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                                if (preset) {
                                  setRenamePresetName(preset.name);
                                  setShowRenamePresetModal(true);
                                }
                              }}
                              className="w-12 flex items-center justify-center rounded-xl bg-black/50 border border-zinc-700/50 hover:bg-white/5 transition-all text-lg shrink-0"
                              title="เปลี่ยนชื่อ"
                            >
                              ✏️
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/10 flex flex-col gap-2">
                        {!isCustomize ? (
                          <button
                            onClick={() => setShowNewPresetModal(true)}
                            className="w-full py-3 rounded-xl font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all"
                          >
                            + สร้าง Preset ใหม่
                          </button>
                        ) : (
                          <div className="w-full py-3 rounded-xl font-bold bg-zinc-800 text-zinc-500 border border-zinc-700 text-center cursor-not-allowed flex items-center justify-center gap-2">
                            <span>🔒</span> สร้าง Preset ใหม่ (เฉพาะ TTV)
                          </div>
                        )}

                        {activeGiftPresetId && (
                          <>
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={async () => {
                                  if (window.electron && window.electron.exportGiftPreset) {
                                    const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                                    await window.electron.exportGiftPreset(preset);
                                  }
                                }}
                                className="flex-1 py-3 rounded-xl font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-all"
                              >
                                Export
                              </button>
                              <button
                                onClick={async () => { if (await Swal.fire({title: 'คุณแน่ใจหรือไม่ที่จะลบ Preset นี้?', icon: 'warning', showCancelButton: true, confirmButtonText: 'ใช่', cancelButtonText: 'ยกเลิก'}).then(r => r.isConfirmed)) {
                                    const updated = giftPresets.filter(p => p.id !== activeGiftPresetId);
                                    setGiftPresets(updated);
                                    setActiveGiftPresetId(updated.length > 0 ? updated[0].id : null);
                                    updateGiftPresetsBackend(updated, updated.length > 0 ? updated[0].id : null);
                                  }
                                }}
                                className="flex-1 py-3 rounded-xl font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
                              >
                                ลบทิ้ง
                              </button>
                            </div>
                          </>
                        )}

                        <button
                          onClick={async () => {
                            if (window.electron && window.electron.importGiftPreset) {
                              const imported = await window.electron.importGiftPreset();
                              if (imported && imported.id) {
                                imported.id = Date.now().toString() + "_import"; // Ensure unique ID
                                const updated = [...giftPresets, imported];
                                setGiftPresets(updated);
                                setActiveGiftPresetId(imported.id);
                                updateGiftPresetsBackend(updated, imported.id);
                              }
                            }
                          }}
                          className="w-full mt-4 py-3 rounded-xl font-bold border border-zinc-700 hover:bg-zinc-800 text-zinc-400 transition-all"
                        >
                          Import
                        </button>
                      </div>
                    </div>
                  </div>



                  {/* Roulette Settings Card */}
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl mt-6 relative">
                    {isGiftsLocked && (
                      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 rounded-3xl pointer-events-auto backdrop-blur-[2px]">
                        <span className="text-sm font-bold text-red-400 drop-shadow-md">🔒 ล็อก</span>
                      </div>
                    )}
                    <h3 className="font-bold text-lg mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 whitespace-nowrap"><span>🎰</span> สุ่มกงล้อ</div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-zinc-400 whitespace-nowrap">{isRouletteServerRunning ? 'กำลังทำงาน' : 'หยุดทำงาน'}</span>
                        <div
                          onClick={() => {
                            const newState = !isRouletteServerRunning;
                            setIsRouletteServerRunning(newState);
                            if (typeof window !== 'undefined' && (window as any).electron && (window as any).electron.toggleRouletteServer) {
                              (window as any).electron.toggleRouletteServer(newState);
                            }
                          }}
                          className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${isRouletteServerRunning ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                        >
                          <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${isRouletteServerRunning ? 'translate-x-6' : 'translate-x-0'}`} />
                        </div>
                      </div>
                    </h3>

                    <div className="space-y-4">
                      <div className="bg-black/50 border border-white/5 p-3 rounded-xl flex items-center justify-between gap-3 group">
                        <div className="truncate flex-1 font-mono text-xs text-zinc-400">http://localhost:7777/overlay.html</div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText("http://localhost:7777/overlay.html");
                            setIsRouletteCopied(true);
                            setTimeout(() => setIsRouletteCopied(false), 2000);
                          }}
                          className={`p-2 rounded-lg shrink-0 transition-all ${isRouletteCopied ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-zinc-300 hover:bg-white/20'}`}
                        >
                          {isRouletteCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>

                      {activeGiftPresetId ? (
                        <>
                          {/* ROULETTE TRIGGERS */}
                          <div className="border-t border-white/10 pt-4 pb-4">
                            <div className="flex justify-between items-center mb-3">
                              <h4 className="text-xs font-medium text-zinc-400">เงื่อนไขการสั่งหมุน (Triggers)</h4>
                              <button
                                onClick={() => {
                                  const updatedPresets = giftPresets.map(p => {
                                    if (p.id === activeGiftPresetId) {
                                      return {
                                        ...p,
                                        rouletteTriggers: [{ id: Date.now().toString(), eventType: 'gift', giftName: '', amount: 1 }, ...(p.rouletteTriggers || [])]
                                      };
                                    }
                                    return p;
                                  });
                                  setGiftPresets(updatedPresets);
                                  updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                }}
                                className="px-2 py-1 text-[10px] rounded transition-all bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30"
                              >
                                + เพิ่มเงื่อนไข
                              </button>
                            </div>

                            <div className="space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 pb-12 pt-3">
                              {giftPresets.find(p => p.id === activeGiftPresetId)?.rouletteTriggers?.length > 0 ? (
                                giftPresets.find(p => p.id === activeGiftPresetId)?.rouletteTriggers.map((rule: any) => (
                                  <div key={rule.id} className="p-2 rounded-lg bg-black/20 border border-white/5 space-y-2 relative group mt-1">
                                    <button
                                      onClick={() => {
                                        const updatedPresets = giftPresets.map(p => {
                                          if (p.id === activeGiftPresetId) {
                                            return { ...p, rouletteTriggers: p.rouletteTriggers.filter((r: any) => r.id !== rule.id) };
                                          }
                                          return p;
                                        });
                                        setGiftPresets(updatedPresets);
                                        updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                      }}
                                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                                    >
                                      <X size={12} />
                                    </button>

                                    <select
                                      value={rule.eventType || 'gift'}
                                      onChange={(e) => {
                                        const updatedPresets = giftPresets.map(p => {
                                          if (p.id === activeGiftPresetId) {
                                            return { ...p, rouletteTriggers: p.rouletteTriggers.map((r: any) => r.id === rule.id ? { ...r, eventType: e.target.value } : r) };
                                          }
                                          return p;
                                        });
                                        setGiftPresets(updatedPresets);
                                        updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                      }}
                                      className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-2 py-1 text-white outline-none focus:border-amber-500/50 text-xs"
                                    >
                                      <option value="gift">🎁 ของขวัญ (Gift)</option>
                                      <option value="like">❤️ กดใจ (ต่อคน)</option>
                                      <option value="total_like">🔥 กดใจรวม (ทั้งไลฟ์)</option>
                                      <option value="follow">👤 กดติดตาม (Follow)</option>
                                      <option value="member">🚶 คนเข้าไลฟ์ (คนผ่าน)</option>
                                    </select>

                                    {(!rule.eventType || rule.eventType === 'gift') && (
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => {
                                            setSelectingRouletteTriggerGiftId(rule.id);
                                            setIsGiftSelectorOpen(true);
                                          }}
                                          className="flex-1 bg-amber-600 hover:bg-amber-500 text-black font-medium rounded-lg px-3 py-2 text-sm transition-colors flex items-center justify-center gap-2 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                        >
                                          {rule.giftName ? (
                                            <>
                                              <Gift size={16} /> <span>{rule.giftName === '__EVENT_FOLLOW__' ? 'ผู้ติดตาม (Follow)' : rule.giftName}</span>
                                            </>
                                          ) : (
                                            <>
                                              <Gift size={16} /> <span>เลือกการ์ดของขวัญ</span>
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    )}

                                    {rule.eventType === 'member' && (
                                      <p className="text-xs text-zinc-400 bg-black/40 p-2 rounded-lg border border-white/5">ทำงานทุกครั้งที่มีคนเข้าไลฟ์ (คนเดิมเข้าซ้ำภายใน 1 นาทีจะไม่นับ)</p>
                                    )}
                                    {(rule.eventType === 'like' || rule.eventType === 'total_like') && (
                                      <div className="flex gap-2 items-center bg-black/40 p-1.5 rounded-lg border border-white/5">
                                        <span className="text-[10px] text-zinc-400 whitespace-nowrap">เป้าหมาย</span>
                                        <input
                                          type="number"
                                          value={rule.amount || 1}
                                          onChange={(e) => {
                                            const updatedPresets = giftPresets.map(p => {
                                              if (p.id === activeGiftPresetId) {
                                                return { ...p, rouletteTriggers: p.rouletteTriggers.map((r: any) => r.id === rule.id ? { ...r, amount: parseInt(e.target.value) || 1 } : r) };
                                              }
                                              return p;
                                            });
                                            setGiftPresets(updatedPresets);
                                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                          }}
                                          className="flex-1 bg-black/50 border border-zinc-700/50 rounded-lg px-2 py-1 text-white outline-none focus:border-amber-500/50 text-xs"
                                          min="1"
                                        />
                                      </div>
                                    )}

                                    <div className="flex gap-2 pt-2 border-t border-white/5">
                                      <button
                                        onClick={() => setEditingRouletteTriggerSettingsId(rule.id)}
                                        className="flex-1 py-2 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg text-xs font-bold hover:bg-yellow-500/30 transition-all flex justify-center items-center gap-1"
                                      >
                                        <Settings size={14} /> ตั้งค่า %
                                      </button>

                                      <button
                                        onClick={() => {
                                          const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                                          if (!isRouletteServerRunning) {
                                            setMacroToast({ show: true, message: 'กรุณาเปิดเซิร์ฟเวอร์ Roulette ก่อน!' });
                                            setTimeout(() => setMacroToast({ show: false, message: '' }), 3000);
                                            return;
                                          }
                                          let total = 0;
                                          preset?.rules?.forEach((r: any) => { total += rule.rouletteSettings?.[r.id] || 0; });
                                          if (total <= 0) {
                                            setMacroToast({ show: true, message: 'กรุณาตั้งค่า % อย่างน้อย 1 รายการ!' });
                                            setTimeout(() => setMacroToast({ show: false, message: '' }), 3000);
                                            return;
                                          }

                                          setMacroToast({ show: true, message: 'กำลังสุ่ม... ดูผลที่ Overlay' });
                                          setTimeout(() => setMacroToast({ show: false, message: '' }), 3000);

                                          if (typeof window !== 'undefined' && (window as any).electron && (window as any).electron.triggerRouletteSpin) {
                                            (window as any).electron.triggerRouletteSpin({
                                              preset: preset,
                                              settings: rule.rouletteSettings || {}
                                            });
                                          }
                                        }}
                                        className="flex-1 py-2 bg-amber-600/80 text-black border border-amber-500/50 rounded-lg text-xs font-bold hover:bg-amber-500 transition-all flex justify-center items-center gap-1"
                                      >
                                        <Play size={14} /> Test Spin
                                      </button>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="text-center text-xs text-zinc-500 py-2">ยังไม่มีเงื่อนไขสั่งหมุน</div>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-center text-xs text-zinc-500 py-4">โปรดสร้างหรือเลือก Preset ก่อน</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Rules Editor */}
                <div className="min-w-0 relative">
                  {isGiftsLocked && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-auto">
                      <div className="bg-black/80 px-8 py-6 flex flex-col items-center justify-center border border-red-500/40 rounded-3xl shadow-[0_0_30px_rgba(239,68,68,0.3)] backdrop-blur-xl transform transition-transform hover:scale-105">
                        <span className="text-5xl mb-3 drop-shadow-lg">🔒</span>
                        <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 mb-1">ฟีเจอร์ถูกล็อก</h2>
                        <p className="text-zinc-300 text-sm font-medium">ต้องได้รับสิทธิ์ TTV เพื่อตั้งค่า Event</p>
                      </div>
                    </div>
                  )}
                  <div className={`w-full bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl min-h-[400px] ${isGiftsLocked ? 'pointer-events-none blur-[3px] opacity-50' : ''}`}>
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="font-bold text-xl flex items-center gap-2">
                        <span>⚡</span> Event&Action
                      </h3>
                      {activeGiftPresetId && (
                        <button
                          onClick={() => {
                            const updatedPresets = giftPresets.map(p => {
                              if (p.id === activeGiftPresetId) {
                                return {
                                  ...p,
                                  rules: [{ id: Date.now().toString(), eventType: 'gift', giftName: '', amount: 1, actionType: 'keypress', actionKey: '' }, ...(p.rules || [])]
                                };
                              }
                              return p;
                            });
                            setGiftPresets(updatedPresets);
                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                          }}
                          className="px-4 py-2 rounded-lg transition-all bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                        >
                          +เพิ่มคำสั่ง
                        </button>
                      )}
                    </div>

                    {!activeGiftPresetId ? (
                      <div className="flex items-center justify-center h-40 text-zinc-500">
                        กรุณาเลือกหรือสร้าง Preset ก่อนเพื่อเพิ่มกฎ
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {giftPresets.find(p => p.id === activeGiftPresetId)?.rules?.map((rule: any) => (
                          <div key={rule.id} className="bg-black/30 border border-white/5 p-4 rounded-2xl flex flex-col gap-3 relative group">

                            <div className="w-full mb-2">
                              <label className="block text-xs font-medium text-zinc-400 mb-1">ชื่อ</label>
                              <input
                                type="text"
                                value={rule.ruleName || ''}
                                onChange={(e) => {
                                  const updatedPresets = giftPresets.map(p => {
                                    if (p.id === activeGiftPresetId) {
                                      return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, ruleName: e.target.value } : r) };
                                    }
                                    return p;
                                  });
                                  setGiftPresets(updatedPresets);
                                  updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                }}
                                placeholder="ตั้งชื่อเช่น TTV"
                                className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white font-medium outline-none focus:border-amber-500/50 text-sm placeholder-zinc-600"
                              />
                            </div>

                            <div className="flex flex-wrap items-start gap-3 w-full">

                              <div className="flex-1 min-w-[200px]">
                                <label className="block text-xs font-medium text-zinc-400 mb-1">เลือก Event</label>
                                <select
                                  value={rule.eventType || 'gift'}
                                  onChange={(e) => {
                                    const updatedPresets = giftPresets.map(p => {
                                      if (p.id === activeGiftPresetId) {
                                        return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, eventType: e.target.value } : r) };
                                      }
                                      return p;
                                    });
                                    setGiftPresets(updatedPresets);
                                    updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                  }}
                                  className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-500/50 text-sm mb-2"
                                >
                                  <option value="gift">🎁 ของขวัญ (Gift)</option>
                                  <option value="like">❤️ กดใจ (ต่อคน)</option>
                                  <option value="total_like">🔥 กดใจรวม (ทั้งไลฟ์)</option>
                                  <option value="follow">👤 กดติดตาม (Follow)</option>
                                  <option value="member">🚶 คนเข้าไลฟ์ (คนผ่าน)</option>
                                </select>

                                {(!rule.eventType || rule.eventType === 'gift') && (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        setSelectingRuleId(rule.id);
                                        setIsGiftSelectorOpen(true);
                                      }}
                                      className="flex-1 bg-amber-600 hover:bg-amber-500 text-black font-medium rounded-lg px-3 py-2 text-sm transition-colors flex items-center justify-center gap-2 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                    >
                                      {rule.giftName ? (
                                        <>
                                          <Gift size={16} /> <span>{rule.giftName === '__EVENT_FOLLOW__' ? 'ผู้ติดตาม (Follow)' : rule.giftName}</span>
                                        </>
                                      ) : (
                                        <>
                                          <Gift size={16} /> <span>เลือกการ์ดของขวัญ</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                )}

                                {rule.eventType === 'member' && (
                                  <p className="text-xs text-zinc-400 bg-black/40 p-2 rounded-lg border border-white/5">ทำงานทุกครั้งที่มีคนเข้าไลฟ์ (คนเดิมเข้าซ้ำภายใน 1 นาทีจะไม่นับ)</p>
                                )}
                                {(rule.eventType === 'like' || rule.eventType === 'total_like') && (
                                  <div className="flex gap-2 items-center bg-black/40 p-2 rounded-lg border border-white/5">
                                    <span className="text-sm text-zinc-400 whitespace-nowrap">เป้าหมาย: </span>
                                    <input
                                      type="number"
                                      value={rule.amount || 1}
                                      onChange={(e) => {
                                        const updatedPresets = giftPresets.map(p => {
                                          if (p.id === activeGiftPresetId) {
                                            return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, amount: parseInt(e.target.value) || 1 } : r) };
                                          }
                                          return p;
                                        });
                                        setGiftPresets(updatedPresets);
                                        updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                      }}
                                      className="flex-1 bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-white outline-none focus:border-amber-500/50 text-sm"
                                      min="1"
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="w-40 shrink-0">
                                <label className="block text-xs font-medium text-zinc-400 mb-1">ประเภท</label>
                                <select
                                  value={rule.actionType || 'keypress'}
                                  onChange={(e) => {
                                    const updatedPresets = giftPresets.map(p => {
                                      if (p.id === activeGiftPresetId) {
                                        return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, actionType: e.target.value } : r) };
                                      }
                                      return p;
                                    });
                                    setGiftPresets(updatedPresets);
                                    updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                  }}
                                  className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-500/50"
                                >
                                  <option value="keypress">ปุ่มกด</option>
                                  <option value="win_counter">นับวิน</option>
                                  <option value="minecraft">Minecraft</option>
                                  <option value="timer">บวกลบเวลา</option>
                                  <option value="webhook">Webhook</option>
                                  <option value="random">สุ่ม</option>
                                </select>
                              </div>

                              <div className="flex-1 min-w-[250px]">
                                <label className="block text-xs font-medium text-zinc-400 mb-1">
                                  {!rule.actionType || rule.actionType === 'keypress' ? 'Key' : rule.actionType === 'minecraft' ? 'คำสั่ง' : rule.actionType === 'webhook' ? 'Webhook URL' : rule.actionType === 'random' ? 'เลือกรายการที่ต้องการสุ่ม' : 'ตั้งค่าบวกลบวิน'}
                                </label>
                                <div className="flex gap-2">
                                  {(!rule.actionType || rule.actionType === 'keypress') && (
                                    <>
                                      <input
                                        type="text"
                                        value={rule.actionKey}
                                        placeholder="เช่น A, [ENTER] หรือ กด Ctrl+B ได้เลย"
                                        onKeyDown={(e) => {
                                          // ดักจับ Modifier + Key แล้วเติม [CTRL+B] ให้อัตโนมัติ
                                          if (e.ctrlKey || e.altKey || e.shiftKey) {
                                            const key = e.key;
                                            // ข้ามถ้ากดแค่ modifier เดี่ยวๆ (ยังไม่มีปุ่มหลัก)
                                            if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

                                            e.preventDefault();
                                            const parts: string[] = [];
                                            if (e.ctrlKey) parts.push('CTRL');
                                            if (e.altKey) parts.push('ALT');
                                            if (e.shiftKey) parts.push('SHIFT');

                                            // แปลงชื่อปุ่มพิเศษ
                                            let keyName = key.length === 1 ? key.toUpperCase() : key.toUpperCase();
                                            if (key === ' ') keyName = 'SPACE';
                                            else if (key === 'Enter') keyName = 'ENTER';
                                            else if (key === 'Backspace') keyName = 'BACKSPACE';
                                            else if (key === 'Tab') keyName = 'TAB';
                                            else if (key === 'Escape') keyName = 'ESC';
                                            else if (key === 'Delete') keyName = 'DELETE';
                                            else if (key === 'ArrowUp') keyName = 'UP';
                                            else if (key === 'ArrowDown') keyName = 'DOWN';
                                            else if (key === 'ArrowLeft') keyName = 'LEFT';
                                            else if (key === 'ArrowRight') keyName = 'RIGHT';

                                            parts.push(keyName);
                                            const combo = '[' + parts.join('+') + ']';

                                            const newValue = (rule.actionKey || '') + combo;
                                            const updatedPresets = giftPresets.map(p => {
                                              if (p.id === activeGiftPresetId) {
                                                return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, actionKey: newValue } : r) };
                                              }
                                              return p;
                                            });
                                            setGiftPresets(updatedPresets);
                                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                          }
                                        }}
                                        onChange={(e) => {
                                          const updatedPresets = giftPresets.map(p => {
                                            if (p.id === activeGiftPresetId) {
                                              return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, actionKey: e.target.value } : r) };
                                            }
                                            return p;
                                          });
                                          setGiftPresets(updatedPresets);
                                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                        }}
                                        className="w-full bg-black/50 border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-400 outline-none focus:border-emerald-500/50"
                                      />
                                      <button
                                        onClick={() => {
                                          setSelectingRuleId(rule.id);
                                          setIsVirtualKeyboardOpen(true);
                                        }}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-lg transition-colors border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)] flex items-center justify-center shrink-0"
                                        title="เปิด Virtual Keyboard"
                                      >
                                        ⌨️
                                      </button>

                                      <button
                                        onClick={() => {
                                          setMacroToast({ show: true, message: 'กำลังทำงานในอีก 3 วินาที' });
                                          setTimeout(() => {
                                            setMacroToast({ show: false, message: '' });
                                          }, 3000);

                                          setTimeout(() => {
                                            if (typeof window !== 'undefined' && window.electron && window.electron.triggerKeyAction) {
                                              window.electron.triggerKeyAction(rule.actionKey);
                                            }
                                          }, 3000);
                                        }}
                                        className="bg-yellow-600 hover:bg-yellow-500 text-black p-2 rounded-lg transition-colors border border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.3)] flex items-center justify-center shrink-0"
                                        title="ทดสอบมาโคร"
                                      >
                                        <Play className="w-5 h-5" />
                                      </button>
                                    </>
                                  )}

                                  {rule.actionType === 'timer' && (
                                    <div className="flex flex-col gap-2 w-full">
                                      <div className="flex bg-black/50 rounded-lg overflow-hidden border border-amber-500/30 w-fit">
                                        <button
                                          onClick={() => {
                                            const updatedPresets = giftPresets.map(p => {
                                              if (p.id === activeGiftPresetId) {
                                                return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, timerAction: 'add' } : r) };
                                              }
                                              return p;
                                            });
                                            setGiftPresets(updatedPresets);
                                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                          }}
                                          className={`px-4 py-1.5 text-sm font-bold transition-colors ${(!rule.timerAction || rule.timerAction === 'add') ? 'bg-amber-500 text-black' : 'text-zinc-500 hover:text-white'}`}
                                        >
                                          + บวกเวลา
                                        </button>
                                        <button
                                          onClick={() => {
                                            const updatedPresets = giftPresets.map(p => {
                                              if (p.id === activeGiftPresetId) {
                                                return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, timerAction: 'subtract' } : r) };
                                              }
                                              return p;
                                            });
                                            setGiftPresets(updatedPresets);
                                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                          }}
                                          className={`px-4 py-1.5 text-sm font-bold transition-colors ${rule.timerAction === 'subtract' ? 'bg-red-500 text-white' : 'text-zinc-500 hover:text-white'}`}
                                        >
                                          - ลบเวลา
                                        </button>
                                      </div>
                                      <div className="flex gap-2">
                                        <div className="flex-1">
                                          <input
                                            type="number"
                                            min="0"
                                            placeholder="ชม."
                                            value={rule.timerHours || ''}
                                            onChange={(e) => {
                                              const updatedPresets = giftPresets.map(p => {
                                                if (p.id === activeGiftPresetId) {
                                                  return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, timerHours: e.target.value } : r) };
                                                }
                                                return p;
                                              });
                                              setGiftPresets(updatedPresets);
                                              updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                            }}
                                            className="w-full bg-black/50 border border-amber-500/30 rounded-lg px-2 py-2 text-amber-400 outline-none focus:border-amber-500/50 text-sm"
                                          />
                                        </div>
                                        <div className="flex-1">
                                          <input
                                            type="number"
                                            min="0"
                                            max="59"
                                            placeholder="น."
                                            value={rule.timerMinutes || ''}
                                            onChange={(e) => {
                                              const updatedPresets = giftPresets.map(p => {
                                                if (p.id === activeGiftPresetId) {
                                                  return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, timerMinutes: e.target.value } : r) };
                                                }
                                                return p;
                                              });
                                              setGiftPresets(updatedPresets);
                                              updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                            }}
                                            className="w-full bg-black/50 border border-amber-500/30 rounded-lg px-2 py-2 text-amber-400 outline-none focus:border-amber-500/50 text-sm"
                                          />
                                        </div>
                                        <div className="flex-1">
                                          <input
                                            type="number"
                                            min="0"
                                            max="59"
                                            placeholder="วิ."
                                            value={rule.timerSeconds || ''}
                                            onChange={(e) => {
                                              const updatedPresets = giftPresets.map(p => {
                                                if (p.id === activeGiftPresetId) {
                                                  return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, timerSeconds: e.target.value } : r) };
                                                }
                                                return p;
                                              });
                                              setGiftPresets(updatedPresets);
                                              updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                            }}
                                            className="w-full bg-black/50 border border-amber-500/30 rounded-lg px-2 py-2 text-amber-400 outline-none focus:border-amber-500/50 text-sm"
                                          />
                                        </div>
                                        <button
                                          onClick={() => {
                                            if (window.electron && window.electron.testTimerAction) {
                                              window.electron.testTimerAction({
                                                action: rule.timerAction || 'add',
                                                hours: rule.timerHours || 0,
                                                minutes: rule.timerMinutes || 0,
                                                seconds: rule.timerSeconds || 0
                                              });
                                            }
                                          }}
                                          className="bg-amber-600 hover:bg-amber-500 text-black w-10 h-[38px] rounded-lg transition-colors border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.3)] flex items-center justify-center shrink-0"
                                          title="ทดสอบบวกลบเวลา"
                                        >
                                          <Play className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {rule.actionType === 'win_counter' && (
                                    <>
                                      <input
                                        type="number"
                                        min="1"
                                        value={rule.counterAmount || 1}
                                        onChange={(e) => {
                                          const updatedPresets = giftPresets.map(p => {
                                            if (p.id === activeGiftPresetId) {
                                              return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, counterAmount: parseInt(e.target.value) || 1 } : r) };
                                            }
                                            return p;
                                          });
                                          setGiftPresets(updatedPresets);
                                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                        }}
                                        className="w-full bg-black/50 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-400 outline-none focus:border-yellow-500/50"
                                        placeholder="ใส่จำนวน"
                                      />
                                      <button
                                        onClick={() => {
                                          const updatedPresets = giftPresets.map(p => {
                                            if (p.id === activeGiftPresetId) {
                                              return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, counterAction: 'add' } : r) };
                                            }
                                            return p;
                                          });
                                          setGiftPresets(updatedPresets);
                                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                        }}
                                        className={`w-10 h-10 shrink-0 font-black text-xl rounded-lg transition-colors flex items-center justify-center ${(!rule.counterAction || rule.counterAction === 'add') ? 'bg-emerald-600 text-white border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-white/5 text-zinc-500 hover:bg-white/10 border border-white/10'}`}
                                        title="บวกเพิ่ม"
                                      >
                                        +
                                      </button>
                                      <button
                                        onClick={() => {
                                          const updatedPresets = giftPresets.map(p => {
                                            if (p.id === activeGiftPresetId) {
                                              return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, counterAction: 'subtract' } : r) };
                                            }
                                            return p;
                                          });
                                          setGiftPresets(updatedPresets);
                                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                        }}
                                        className={`w-10 h-10 shrink-0 font-black text-xl rounded-lg transition-colors flex items-center justify-center ${rule.counterAction === 'subtract' ? 'bg-red-600 text-white border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'bg-white/5 text-zinc-500 hover:bg-white/10 border border-white/10'}`}
                                        title="หักลบ"
                                      >
                                        -
                                      </button>
                                      <button
                                        onClick={() => {
                                          setMacroToast({ show: true, message: 'กำลังทำงานในอีก 3 วินาที' });
                                          setTimeout(() => {
                                            setMacroToast({ show: false, message: '' });
                                          }, 3000);

                                          setTimeout(() => {
                                            if (typeof window !== 'undefined' && window.electron && window.electron.triggerKeyAction) {
                                              window.electron.triggerKeyAction({ type: 'win_counter', action: rule.counterAction || 'add', amount: rule.counterAmount || 1 });
                                            }
                                          }, 3000);
                                        }}
                                        className="bg-yellow-600 hover:bg-yellow-500 text-black p-2 rounded-lg transition-colors border border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.3)] flex items-center justify-center shrink-0"
                                        title="ทดสอบมาโคร"
                                      >
                                        <Play className="w-5 h-5" />
                                      </button>
                                    </>
                                  )}

                                  {rule.actionType === 'minecraft' && (
                                    <>
                                      <input
                                        type="text"
                                        value={rule.minecraftCommand || ''}
                                        onChange={(e) => {
                                          const updatedPresets = giftPresets.map(p => {
                                            if (p.id === activeGiftPresetId) {
                                              return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, minecraftCommand: e.target.value } : r) };
                                            }
                                            return p;
                                          });
                                          setGiftPresets(updatedPresets);
                                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                        }}
                                        className="w-full bg-black/50 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-400 outline-none focus:border-amber-500/50"
                                        placeholder="เช่น tnt หรือ give @a diamond"
                                      />
                                      <button
                                        onClick={() => {
                                          setMacroToast({ show: true, message: 'กำลังทำงานในอีก 3 วินาที' });
                                          setTimeout(() => {
                                            setMacroToast({ show: false, message: '' });
                                          }, 3000);

                                          setTimeout(() => {
                                            if (typeof window !== 'undefined' && window.electron && window.electron.triggerKeyAction) {
                                              window.electron.triggerKeyAction({ type: 'minecraft', command: rule.minecraftCommand || '' });
                                            }
                                          }, 3000);
                                        }}
                                        className="bg-yellow-600 hover:bg-yellow-500 text-black p-2 rounded-lg transition-colors border border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.3)] flex items-center justify-center shrink-0"
                                        title="ทดสอบมาโคร"
                                      >
                                        <Play className="w-5 h-5" />
                                      </button>
                                    </>
                                  )}

                                  {rule.actionType === 'webhook' && (
                                    <>
                                      <input
                                        type="text"
                                        value={rule.webhookUrl || ''}
                                        onChange={(e) => {
                                          const updatedPresets = giftPresets.map(p => {
                                            if (p.id === activeGiftPresetId) {
                                              return { ...p, rules: p.rules.map((r: any) => r.id === rule.id ? { ...r, webhookUrl: e.target.value } : r) };
                                            }
                                            return p;
                                          });
                                          setGiftPresets(updatedPresets);
                                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                        }}
                                        className="w-full bg-black/50 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-400 outline-none focus:border-yellow-500/50"
                                        placeholder="เช่น https://api.example.com/webhook"
                                      />
                                      <button
                                        onClick={() => {
                                          setMacroToast({ show: true, message: 'กำลังทำงานในอีก 3 วินาที' });
                                          setTimeout(() => {
                                            setMacroToast({ show: false, message: '' });
                                          }, 3000);

                                          setTimeout(() => {
                                            if (typeof window !== 'undefined' && window.electron && window.electron.triggerKeyAction) {
                                              window.electron.triggerKeyAction({ type: 'webhook', url: rule.webhookUrl || '' });
                                            }
                                          }, 3000);
                                        }}
                                        className="bg-yellow-600 hover:bg-yellow-500 text-black p-2 rounded-lg transition-colors border border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.3)] flex items-center justify-center shrink-0"
                                        title="ทดสอบ Webhook"
                                      >
                                        <Play className="w-5 h-5" />
                                      </button>
                                    </>
                                  )}

                                  {rule.actionType === 'random' && (
                                    <>
                                      <div className="flex flex-col gap-2 w-full bg-black/30 border border-white/5 p-3 rounded-xl max-h-48 overflow-y-auto custom-scrollbar">
                                        {giftPresets.find(p => p.id === activeGiftPresetId)?.rules
                                          ?.filter((r: any) => r.id !== rule.id && r.actionType !== 'random')
                                          .map((r: any) => (
                                            <label key={r.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer border border-transparent hover:border-white/10 transition-colors">
                                              <input
                                                type="checkbox"
                                                checked={(rule.randomRuleIds || []).includes(r.id)}
                                                onChange={(e) => {
                                                  const checked = e.target.checked;
                                                  const updatedPresets = giftPresets.map(p => {
                                                    if (p.id === activeGiftPresetId) {
                                                      return {
                                                        ...p,
                                                        rules: p.rules.map((item: any) => {
                                                          if (item.id === rule.id) {
                                                            const currentIds = item.randomRuleIds || [];
                                                            return {
                                                              ...item,
                                                              randomRuleIds: checked
                                                                ? [...currentIds, r.id]
                                                                : currentIds.filter((id: string) => id !== r.id)
                                                            };
                                                          }
                                                          return item;
                                                        })
                                                      };
                                                    }
                                                    return p;
                                                  });
                                                  setGiftPresets(updatedPresets);
                                                  updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                                }}
                                                className="w-4 h-4 rounded border-zinc-600 bg-black/50 text-amber-500 focus:ring-amber-500 focus:ring-offset-black"
                                              />
                                              <div className="flex flex-col">
                                                <span className="text-sm font-medium text-white">{r.ruleName || 'ไม่ได้ตั้งชื่อ'}</span>
                                                <span className="text-[10px] text-zinc-500">
                                                  {r.actionType === 'keypress' ? `คีย์: ${r.actionKey || '-'}` : r.actionType === 'win_counter' ? `วิน: ${r.counterAction === 'subtract' ? '-' : '+'}${r.counterAmount || 1}` : `MC: ${r.minecraftCommand || '-'}`}
                                                </span>
                                              </div>
                                            </label>
                                          ))}

                                        {giftPresets.find(p => p.id === activeGiftPresetId)?.rules?.filter((r: any) => r.id !== rule.id && r.actionType !== 'random').length === 0 && (
                                          <div className="text-xs text-zinc-500 text-center py-2">
                                            ยังไม่มีรายการอื่นให้สุ่ม (สร้างกฎอื่นก่อน)
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        onClick={() => {
                                          setMacroToast({ show: true, message: 'กำลังสุ่มในอีก 3 วินาที' });
                                          setTimeout(() => {
                                            setMacroToast({ show: false, message: '' });
                                          }, 3000);

                                          setTimeout(() => {
                                            if (typeof window !== 'undefined' && window.electron && window.electron.triggerKeyAction) {
                                              if (rule.randomRuleIds && rule.randomRuleIds.length > 0) {
                                                const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                                                if (preset && preset.rules) {
                                                  const randomIndex = Math.floor(Math.random() * rule.randomRuleIds.length);
                                                  const targetId = rule.randomRuleIds[randomIndex];
                                                  const targetRule = preset.rules.find((r: any) => r.id === targetId);
                                                  if (targetRule && targetRule.actionType !== 'random') {
                                                    if (!targetRule.actionType || targetRule.actionType === 'keypress') {
                                                      window.electron.triggerKeyAction(targetRule.actionKey);
                                                    } else if (targetRule.actionType === 'win_counter') {
                                                      window.electron.triggerKeyAction({ type: 'win_counter', action: targetRule.counterAction || 'add', amount: targetRule.counterAmount || 1 });
                                                    } else if (targetRule.actionType === 'minecraft') {
                                                      window.electron.triggerKeyAction({ type: 'minecraft', command: targetRule.minecraftCommand || '' });
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }, 3000);
                                        }}
                                        className="bg-yellow-600 hover:bg-yellow-500 text-black p-2 rounded-lg transition-colors border border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.3)] flex items-center justify-center shrink-0 h-10 self-end"
                                        title="ทดสอบสุ่ม"
                                      >
                                        <Play className="w-5 h-5" />
                                      </button>
                                    </>
                                  )}

                                  <button
                                    onClick={() => {
                                      const updatedPresets = giftPresets.map(p => {
                                        if (p.id === activeGiftPresetId) {
                                          return { ...p, rules: p.rules.filter((r: any) => r.id !== rule.id) };
                                        }
                                        return p;
                                      });
                                      setGiftPresets(updatedPresets);
                                      updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                                    }}
                                    className="bg-red-500/20 hover:bg-red-500/40 text-red-400 p-2 rounded-lg transition-colors border border-red-500/30 flex items-center justify-center shrink-0"
                                    title="ลบกฎ"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                </div>
                              </div>
                            </div>

                          </div>
                        ))}

                        {giftPresets.find(p => p.id === activeGiftPresetId)?.rules?.length === 0 && (
                          <div className="text-center py-10 text-zinc-500">
                            ยังไม่มีกฎใน Preset นี้ กดปุ่ม "+เพิ่มคำสั่ง" ด้านบนเพื่อเริ่มต้น
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}


          {view === 'game' && (
            <div className="animate-in fade-in zoom-in-95 duration-300 relative">
              <header className="mb-12">
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-500 drop-shadow-[0_0_15px_rgba(250,204,21,0.3)]">
                  เกม
                </h1>
              </header>

              {!selectedCategory ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                  {/* Roblox Card */}

                  <button
                    onClick={() => {
                      setSelectedCategory('roblox');
                    }}
                    className={`bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 hover:border-yellow-500/50 hover:shadow-[0_0_30px_rgba(250,204,21,0.2)] transition-all flex flex-col items-center group relative overflow-hidden`}
                  >
                    <div className="w-full aspect-square overflow-hidden relative">
                      <img src="/games/roblox_cover.jpg" alt="Roblox" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#050505]/90 via-transparent to-transparent"></div>
                      {!isLocked && <div className="absolute inset-0 bg-yellow-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>}
                    </div>
                    <div className="p-6 pt-0 flex flex-col items-center gap-2 -mt-8 relative z-10 w-full">
                      <h3 className="font-bold text-xl text-white drop-shadow-lg flex items-center gap-2">Roblox</h3>
                      <span className={`text-xs font-medium px-4 py-1 rounded-full border text-yellow-300 bg-yellow-500/20 border-yellow-500/30 shadow-[0_0_15px_rgba(250,204,21,0.3)]`}>
                        เปิดดูเกม
                      </span>
                    </div>
                  </button>

                  {/* Minecraft Card */}

                  <button
                    onClick={() => {
                      setSelectedCategory('minecraft');
                    }}
                    className={`bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 hover:border-green-500/50 hover:shadow-[0_0_30px_rgba(34,197,94,0.2)] transition-all flex flex-col items-center group relative overflow-hidden`}
                  >
                    {showNewBadge && <span className="absolute top-3 right-3 z-20 px-2 py-0.5 bg-red-500 text-white text-[10px] font-black rounded-full shadow-[0_0_10px_rgba(239,68,68,0.6)] animate-pulse">NEW</span>}
                    <div className="w-full aspect-square overflow-hidden relative">
                      <img src="/games/minecraft_cover.jpg" alt="Minecraft" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#050505]/90 via-transparent to-transparent"></div>
                      {!isLocked && <div className="absolute inset-0 bg-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>}
                    </div>
                    <div className="p-6 pt-0 flex flex-col items-center gap-2 -mt-8 relative z-10 w-full">
                      <h3 className="font-bold text-xl text-white drop-shadow-lg flex items-center gap-2">Minecraft</h3>
                      <span className={`text-xs font-medium px-4 py-1 rounded-full border text-green-300 bg-green-500/20 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.3)]`}>
                        เปิดดูเกม
                      </span>
                    </div>
                  </button>

                  {/* Standalone Games Card */}

                  <button
                    onClick={() => setSelectedCategory('standalone')}
                    className="bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:bg-zinc-800/50 hover:border-zinc-700 hover:shadow-[0_0_30px_rgba(245,158,11,0.1)] transition-all flex flex-col items-center group overflow-hidden cursor-pointer relative"
                  >
                    {!isLocked && <div className="absolute inset-0 bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity z-10"></div>}
                    <div className="w-full aspect-square overflow-hidden relative">
                      <img src="/games/other_cover.jpg" alt="Other Games" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/90 to-transparent"></div>
                    </div>
                    <div className="p-6 pt-0 flex flex-col items-center gap-2 -mt-8 relative z-10 w-full">
                      <h3 className="font-bold text-xl text-white drop-shadow-lg flex items-center gap-2">เกมอื่นๆ</h3>
                      <span className="text-xs font-medium px-4 py-1 rounded-full border text-amber-300 bg-amber-500/20 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.3)]">เปิดดูเกม</span>
                    </div>
                  </button>
                </div>
              ) : (
                <div className="w-full animate-in slide-in-from-right-4 duration-300">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="flex items-center gap-2 text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl mb-8 transition-all hover:scale-105 active:scale-95 text-sm font-medium"
                  >
                    <ChevronLeft className="w-4 h-4" /> กลับไปหน้าเลือกเกม
                  </button>

                  
                  {selectedCategory === 'standalone' && (
                    <div className="max-w-4xl mx-auto">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-amber-500/20 text-amber-400 rounded-xl flex items-center justify-center border border-amber-500/30">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                        <h2 className="text-2xl font-bold">เกมอื่นๆ</h2>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:bg-zinc-800/50 hover:border-amber-500/50 hover:shadow-[0_0_30px_rgba(245,158,11,0.15)] transition-all flex flex-col items-center group overflow-hidden relative">
                              <div className="w-full aspect-square overflow-hidden relative">
                                <img src="/games/block_pvp.png?v=2" alt="Block Game" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/90 to-transparent"></div>
                                
                          {installedGames['block_pvp'] && (
  <button
    onClick={() => {
                                Swal.fire({
                                  title: 'คุณแน่ใจหรือไม่ที่จะลบเกมนี้?',
                                  text: 'การถอนการติดตั้งจะไม่สามารถกู้คืนได้',
                                  icon: 'warning',
                                  showCancelButton: true,
                                  confirmButtonColor: '#3085d6',
                                  cancelButtonColor: '#d33',
                                  confirmButtonText: 'ใช่, ลบเลย',
                                  cancelButtonText: 'ยกเลิก',
                                  background: '#1f2937',
                                  color: '#fff'
                                }).then((result) => {
                                  if (result.isConfirmed) {
                                    if (window.electron && window.electron.uninstallStandaloneGame) {
                                      window.electron.uninstallStandaloneGame('block_pvp').then(() => {
                                        setInstalledGames(prev => ({ ...prev, block_pvp: false }));
                                        setDownloadProgress(prev => {
                                          const newProgress = { ...prev };
                                          delete newProgress['block_pvp'];
                                          return newProgress;
                                        });
                                      });
                                    }
                                  }
                                });
                              }}
    className="absolute top-4 right-4 z-20 p-2 text-zinc-300 hover:text-red-400 bg-black/50 hover:bg-red-500/20 backdrop-blur-sm rounded-xl transition-colors shadow-lg"
    title="ถอนการติดตั้ง"
  >
    <Trash2 className="w-5 h-5" />
                                </button>
                              )}
                              </div>
                              <div className="p-6 pt-0 flex flex-col items-center gap-4 -mt-8 relative z-10 w-full">
                                <h3 className="font-bold text-xl text-white drop-shadow-lg flex items-center gap-2">Block Game</h3>
                                <div className="w-full">
                            {!hasOtherGameAccess('block_pvp') ? (
                                <button disabled className="w-full py-3 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                  🔒 ไม่มีสิทธิ์เข้าเล่น (ต้องได้รับสิทธิ์ก่อน)
                                </button>
                              ) : downloadProgress['block_pvp'] !== undefined ? (
                              <div className="w-full flex flex-col gap-2">
                                <div className="w-full h-12 bg-zinc-800 rounded-xl overflow-hidden relative border border-zinc-700">
                                  <div
                                    className="absolute left-0 top-0 h-full bg-yellow-500 transition-all duration-300"
                                    style={{ width: `${downloadProgress['block_pvp']}%` }}
                                  ></div>
                                  <div className="absolute inset-0 flex items-center justify-center font-bold text-white shadow-sm drop-shadow-md text-sm">
                                    กำลังติดตั้ง... {downloadProgress['block_pvp']}%
                                  </div>
                                </div>
                              </div>
                            ) : installedGames['block_pvp'] ? (
                                (latestVersions['block_pvp'] && localVersions['block_pvp'] && latestVersions['block_pvp'] !== localVersions['block_pvp']) ? (
                                    <button
                                      onClick={() => {
                                        if (window.electron && window.electron.installStandaloneGame) {
                                          setDownloadProgress(prev => ({ ...prev, block_pvp: 0 }));
                                          const url = downloadUrls['block_pvp'] || 'https://github.com/katozztv/BlockGame-Game/releases/download/v1.0.0/Block.Game.PVP-1.0.0-win.zip';
                                          const ver = latestVersions['block_pvp'];
                                          window.electron.installStandaloneGame('block_pvp', url, ver)
                                            .then(() => {
                                                setInstalledGames(prev => ({ ...prev, block_pvp: true }));
                                                setLocalVersions(prev => ({ ...prev, block_pvp: ver }));
                                                setDownloadProgress(prev => {
                                                  const newProgress = { ...prev };
                                                  delete newProgress['block_pvp'];
                                                  return newProgress;
                                                });
                                            })
                                            .catch((err) => {
                                              console.error(err);
                                              alert('เกิดข้อผิดพลาดในการอัปเดต: ' + err.message);
                                              setDownloadProgress(prev => {
                                                const newProgress = { ...prev };
                                                delete newProgress['block_pvp'];
                                                return newProgress;
                                              });
                                            });
                                        }
                                      }}
                                      className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-1.36"/></svg> อัปเดตเป็น {latestVersions['block_pvp']}
                                    </button>
                                ) : (
                                <button
                                  onClick={() => {
                                    if (window.electron && window.electron.startStandaloneGame) {
                                      window.electron.startStandaloneGame('block_pvp', { username: user?.discord_username || 'PLAYER 1' });
                                    } else {
                                      alert('ไม่สามารถเปิดเกมได้ กรุณาเปิดผ่าน Launcher');
                                    }
                                  }}
                                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> เริ่มเกม
                                </button>
                              )
                            ) : (
                                <button
                                  onClick={() => {
                                    if (window.electron && window.electron.installStandaloneGame) {
                                      setDownloadProgress(prev => ({ ...prev, block_pvp: 0 }));
                                      const url = downloadUrls['block_pvp'] || 'https://github.com/katozztv/BlockGame-Game/releases/download/v1.0.0/Block.Game.PVP-1.0.0-win.zip';
                                      const ver = latestVersions['block_pvp'] || '1.0.0';
                                      window.electron.installStandaloneGame('block_pvp', url, ver)
                                        .then(() => {
                                            setInstalledGames(prev => ({ ...prev, block_pvp: true }));
                                            setLocalVersions(prev => ({ ...prev, block_pvp: ver }));
                                            setDownloadProgress(prev => {
                                              const newProgress = { ...prev };
                                              delete newProgress['block_pvp'];
                                              return newProgress;
                                            });
                                        })
                                        .catch((err) => {
                                          console.error(err);
                                          alert('เกิดข้อผิดพลาดในการดาวน์โหลด: ' + err.message);
                                          setDownloadProgress(prev => {
                                            const newProgress = { ...prev };
                                            delete newProgress['block_pvp'];
                                            return newProgress;
                                          });
                                        });
                                    } else {
                                      alert('Launcher ของคุณไม่รองรับการดาวน์โหลดเกม กรุณาอัปเดต Launcher');
                                    }
                                  }}
                                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-yellow-500/20"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> ดาวน์โหลด / ติดตั้ง
                                </button>
                              )
                            }
                          </div>
                        </div>
                      </div>

                      {/* Pirate WARS Game Card */}
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:bg-zinc-800/50 hover:border-yellow-500/50 hover:shadow-[0_0_30px_rgba(250,204,21,0.15)] transition-all flex flex-col items-center group overflow-hidden relative">
                          <div className="w-full aspect-square overflow-hidden relative flex items-center justify-center bg-zinc-800">
                            <span className="text-6xl group-hover:scale-110 transition-transform duration-500">🏴‍☠️</span>
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/90 to-transparent"></div>

                            {installedGames['pirate_wars'] && (
                              <button
                                onClick={() => {
                                  Swal.fire({
                                    title: 'คุณแน่ใจหรือไม่ที่จะลบเกมนี้?',
                                    text: 'การถอนการติดตั้งจะไม่สามารถกู้คืนได้',
                                    icon: 'warning',
                                    showCancelButton: true,
                                    confirmButtonColor: '#3085d6',
                                    cancelButtonColor: '#d33',
                                    confirmButtonText: 'ใช่, ลบเลย',
                                    cancelButtonText: 'ยกเลิก',
                                    background: '#1f2937',
                                    color: '#fff'
                                  }).then((result) => {
                                    if (result.isConfirmed) {
                                      if (window.electron && window.electron.uninstallStandaloneGame) {
                                        window.electron.uninstallStandaloneGame('pirate_wars').then(() => {
                                          setInstalledGames(prev => ({ ...prev, pirate_wars: false }));
                                          setDownloadProgress(prev => {
                                            const newProgress = { ...prev };
                                            delete newProgress['pirate_wars'];
                                            return newProgress;
                                          });
                                        });
                                      }
                                    }
                                  });
                                }}
                                className="absolute top-4 right-4 z-20 p-2 text-zinc-300 hover:text-red-400 bg-black/50 hover:bg-red-500/20 backdrop-blur-sm rounded-xl transition-colors shadow-lg"
                                title="ถอนการติดตั้ง"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                          <div className="p-6 pt-0 flex flex-col items-center gap-4 -mt-8 relative z-10 w-full">
                            <h3 className="font-bold text-xl text-white drop-shadow-lg flex items-center gap-2">Pirate WARS</h3>
                            <div className="w-full">
                              {!hasOtherGameAccess('pirate_wars') ? (
                                <button disabled className="w-full py-3 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                  🔒 ไม่มีสิทธิ์เข้าเล่น
                                </button>
                              ) : downloadProgress['pirate_wars'] !== undefined ? (
                                <div className="w-full flex flex-col gap-2">
                                  <div className="w-full h-12 bg-zinc-800 rounded-xl overflow-hidden relative border border-zinc-700">
                                    <div
                                      className="absolute left-0 top-0 h-full bg-yellow-500 transition-all duration-300"
                                      style={{ width: `${downloadProgress['pirate_wars']}%` }}
                                    ></div>
                                    <div className="absolute inset-0 flex items-center justify-center font-bold text-white shadow-sm drop-shadow-md text-sm">
                                      กำลังติดตั้ง... {downloadProgress['pirate_wars']}%
                                    </div>
                                  </div>
                                </div>
                              ) : installedGames['pirate_wars'] ? (
                                (latestVersions['pirate_wars'] && localVersions['pirate_wars'] && latestVersions['pirate_wars'] !== localVersions['pirate_wars']) ? (
                                  <button
                                    onClick={() => {
                                      if (window.electron && window.electron.installStandaloneGame) {
                                        setDownloadProgress(prev => ({ ...prev, pirate_wars: 0 }));
                                        const url = downloadUrls['pirate_wars'] || 'https://github.com/katozztv/PirateWars-Game/releases/download/v1.0.0/PirateWars.zip';
                                        const ver = latestVersions['pirate_wars'];
                                        window.electron.installStandaloneGame('pirate_wars', url, ver)
                                          .then(() => {
                                            setInstalledGames(prev => ({ ...prev, pirate_wars: true }));
                                            setLocalVersions(prev => ({ ...prev, pirate_wars: ver }));
                                            setDownloadProgress(prev => {
                                              const newProgress = { ...prev };
                                              delete newProgress['pirate_wars'];
                                              return newProgress;
                                            });
                                          })
                                          .catch((err) => {
                                            console.error(err);
                                            alert('เกิดข้อผิดพลาดในการอัปเดต: ' + err.message);
                                            setDownloadProgress(prev => {
                                              const newProgress = { ...prev };
                                              delete newProgress['pirate_wars'];
                                              return newProgress;
                                            });
                                          });
                                      }
                                    }}
                                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-1.36"/></svg> อัปเดตเป็น {latestVersions['pirate_wars']}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      if (window.electron && window.electron.startPirateWars) {
                                        window.electron.startPirateWars(user?.tiktok_username || user?.discord_username || '');
                                      } else {
                                        alert('ไม่สามารถเปิดเกมได้ กรุณาเปิดผ่านโปรแกรมที่รองรับ');
                                      }
                                    }}
                                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> เริ่มเกม
                                  </button>
                                )
                              ) : (
                                <button
                                  onClick={() => {
                                    if (window.electron && window.electron.installStandaloneGame) {
                                      setDownloadProgress(prev => ({ ...prev, pirate_wars: 0 }));
                                      const url = downloadUrls['pirate_wars'] || 'https://github.com/katozztv/PirateWars-Game/releases/download/v1.0.1/Pirate.WARS.zip';
                                      const ver = latestVersions['pirate_wars'] || '1.0.1';
                                      window.electron.installStandaloneGame('pirate_wars', url, ver)
                                        .then(() => {
                                          setInstalledGames(prev => ({ ...prev, pirate_wars: true }));
                                          setLocalVersions(prev => ({ ...prev, pirate_wars: ver }));
                                          setDownloadProgress(prev => {
                                            const newProgress = { ...prev };
                                            delete newProgress['pirate_wars'];
                                            return newProgress;
                                          });
                                        })
                                        .catch((err) => {
                                          console.error(err);
                                          alert('เกิดข้อผิดพลาดในการดาวน์โหลด: ' + err.message);
                                          setDownloadProgress(prev => {
                                            const newProgress = { ...prev };
                                            delete newProgress['pirate_wars'];
                                            return newProgress;
                                          });
                                        });
                                    } else {
                                      alert('Launcher ของคุณไม่รองรับการดาวน์โหลดเกม กรุณาอัปเดต Launcher');
                                    }
                                  }}
                                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-yellow-500/20"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> ดาวน์โหลด / ติดตั้ง
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <StickWarCard allowed={hasOtherGameAccess('stick_war')} progress={downloadProgress['stick_war']} />

                        {/* Spouge Bob LINEUP Game Card */}
                        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:bg-zinc-800/50 hover:border-yellow-500/50 hover:shadow-[0_0_30px_rgba(234,179,8,0.15)] transition-all flex flex-col items-center group overflow-hidden relative">
                          <div className="w-full aspect-square overflow-hidden relative flex items-center justify-center bg-zinc-800">
                            <span className="text-6xl group-hover:scale-110 transition-transform duration-500">🍍</span>
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/90 to-transparent"></div>

                            {installedGames['spouge_bob'] && (
                              <button
                                onClick={() => {
                                  Swal.fire({
                                    title: 'คุณแน่ใจหรือไม่ที่จะลบเกมนี้?',
                                    text: 'การถอนการติดตั้งจะไม่สามารถกู้คืนได้',
                                    icon: 'warning',
                                    showCancelButton: true,
                                    confirmButtonColor: '#3085d6',
                                    cancelButtonColor: '#d33',
                                    confirmButtonText: 'ใช่, ลบเลย',
                                    cancelButtonText: 'ยกเลิก',
                                    background: '#1f2937',
                                    color: '#fff'
                                  }).then((result) => {
                                    if (result.isConfirmed) {
                                      if (window.electron && window.electron.uninstallStandaloneGame) {
                                        window.electron.uninstallStandaloneGame('spouge_bob').then(() => {
                                          setInstalledGames(prev => ({ ...prev, spouge_bob: false }));
                                          setDownloadProgress(prev => {
                                            const newProgress = { ...prev };
                                            delete newProgress['spouge_bob'];
                                            return newProgress;
                                          });
                                        });
                                      }
                                    }
                                  });
                                }}
                                className="absolute top-4 right-4 z-20 p-2 text-zinc-300 hover:text-red-400 bg-black/50 hover:bg-red-500/20 backdrop-blur-sm rounded-xl transition-colors shadow-lg"
                                title="ถอนการติดตั้ง"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                          <div className="p-6 pt-0 flex flex-col items-center gap-4 -mt-8 relative z-10 w-full">
                            <h3 className="font-bold text-xl text-white drop-shadow-lg flex items-center gap-2">Spouge Bob LINEUP</h3>
                            <div className="w-full">
                              {!hasOtherGameAccess('spouge_bob') ? (
                                <button disabled className="w-full py-3 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                  🔒 ไม่มีสิทธิ์เข้าเล่น (ต้องได้รับสิทธิ์ก่อน)
                                </button>
                              ) : downloadProgress['spouge_bob'] !== undefined ? (
                                <div className="w-full flex flex-col gap-2">
                                  <div className="w-full h-12 bg-zinc-800 rounded-xl overflow-hidden relative border border-zinc-700">
                                    <div
                                      className="absolute left-0 top-0 h-full bg-yellow-500 transition-all duration-300"
                                      style={{ width: `${downloadProgress['spouge_bob']}%` }}
                                    ></div>
                                    <div className="absolute inset-0 flex items-center justify-center font-bold text-white shadow-sm drop-shadow-md text-sm">
                                      กำลังติดตั้ง... {downloadProgress['spouge_bob']}%
                                    </div>
                                  </div>
                                </div>
                              ) : installedGames['spouge_bob'] ? (
                                (latestVersions['spouge_bob'] && localVersions['spouge_bob'] && latestVersions['spouge_bob'] !== localVersions['spouge_bob']) ? (
                                  <button
                                    onClick={() => {
                                      if (window.electron && window.electron.installStandaloneGame) {
                                        setDownloadProgress(prev => ({ ...prev, spouge_bob: 0 }));
                                        const url = downloadUrls['spouge_bob'] || 'https://github.com/katozztv/Bed-Spouge/releases/download/v1.0.4/Spouge.Bob.LINEUP.1.0.4.zip';
                                        const ver = latestVersions['spouge_bob'];
                                        window.electron.installStandaloneGame('spouge_bob', url, ver)
                                          .then(() => {
                                              setInstalledGames(prev => ({ ...prev, spouge_bob: true }));
                                              setLocalVersions(prev => ({ ...prev, spouge_bob: ver }));
                                              setDownloadProgress(prev => {
                                                const newProgress = { ...prev };
                                                delete newProgress['spouge_bob'];
                                                return newProgress;
                                              });
                                          })
                                          .catch((err) => {
                                            console.error(err);
                                            alert('เกิดข้อผิดพลาดในการอัปเดต: ' + err.message);
                                            setDownloadProgress(prev => {
                                              const newProgress = { ...prev };
                                              delete newProgress['spouge_bob'];
                                              return newProgress;
                                            });
                                          });
                                      }
                                    }}
                                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.67-1.36"/></svg> อัปเดตเป็น {latestVersions['spouge_bob']}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      if (window.electron && window.electron.startStandaloneGame) {
                                        window.electron.startStandaloneGame('spouge_bob', { username: user?.discord_username || 'PLAYER 1' });
                                      } else {
                                        alert('ไม่สามารถเปิดเกมได้ กรุณาเปิดผ่าน Launcher');
                                      }
                                    }}
                                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> เริ่มเกม
                                  </button>
                                )
                              ) : (
                                <button
                                  onClick={async () => {
                                    if (window.electron && window.electron.installStandaloneGame) {
                                      let customDir: string | null = null;
                                      if (window.electron.chooseInstallFolder) {
                                        customDir = await window.electron.chooseInstallFolder();
                                        if (!customDir) return;
                                      }
                                      setDownloadProgress(prev => ({ ...prev, spouge_bob: 0 }));
                                      const url = downloadUrls['spouge_bob'] || 'https://github.com/katozztv/Bed-Spouge/releases/download/v1.0.4/Spouge.Bob.LINEUP.1.0.4.zip';
                                      const ver = latestVersions['spouge_bob'] || '1.0.4';
                                      window.electron.installStandaloneGame('spouge_bob', url, ver, customDir)
                                        .then(() => {
                                            setInstalledGames(prev => ({ ...prev, spouge_bob: true }));
                                            setLocalVersions(prev => ({ ...prev, spouge_bob: ver }));
                                            setDownloadProgress(prev => {
                                              const newProgress = { ...prev };
                                              delete newProgress['spouge_bob'];
                                              return newProgress;
                                            });
                                        })
                                        .catch((err) => {
                                          console.error(err);
                                          alert('เกิดข้อผิดพลาดในการดาวน์โหลด: ' + err.message);
                                          setDownloadProgress(prev => {
                                            const newProgress = { ...prev };
                                            delete newProgress['spouge_bob'];
                                            return newProgress;
                                          });
                                        });
                                    } else {
                                      alert('Launcher ของคุณไม่รองรับการดาวน์โหลดเกม กรุณาอัปเดต Launcher');
                                    }
                                  }}
                                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-yellow-500/20"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg> เลือกโฟลเดอร์ / ติดตั้ง
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}

                  {selectedCategory === 'roblox' && (
                    <div className="max-w-4xl mx-auto">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-yellow-500/20 text-yellow-400 rounded-xl flex items-center justify-center border border-yellow-500/30">
                          <Gamepad2 className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl font-bold">Roblox Games</h2>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                          { id: 'pizza_speed', name: '1. Pizza Speed', url: 'https://www.roblox.com/games/120402406091365/LINE-UP-Pizza-Speed' },
                          { id: 'donkey_smash', name: '2. Donkey Smash LINE UP', url: 'https://www.roblox.com/games/113775915836613/Donkey-Smash-LINE-UP' },
                          { id: 'build_block', name: '3. ต่อตึก By LINE UP', url: 'https://www.roblox.com/games/95989495401815/By-LINE-UP' },
                          { id: 'line_up_jump', name: '4. LINE UP JUMP', url: 'https://www.roblox.com/games/87602759309184/LINEUP-JUMP' }
                        ].map((game) => {

                          const status = installStatuses[game.id] || 'not_installed';

                          return (
                            <div key={game.id} className="relative bg-white/5 backdrop-blur-md border border-white/10 p-8 rounded-3xl hover:bg-white/10 hover:border-yellow-500/50 hover:shadow-[0_0_30px_rgba(250,204,21,0.15)] transition-all flex flex-col items-center justify-between text-center gap-6 group">

                              {status !== 'not_installed' && (
                                <button
                                  onClick={() => setInstallStatuses(prev => ({ ...prev, [game.id]: 'not_installed' }))}
                                  className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-red-400 bg-black/30 hover:bg-red-500/10 rounded-xl transition-colors"
                                  title="ถอนการติดตั้ง"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}

                              <div className="w-20 h-20 bg-yellow-500/10 text-yellow-400 rounded-2xl flex items-center justify-center border border-yellow-500/20 group-hover:scale-110 transition-transform">
                                <Gamepad2 className="w-10 h-10" />
                              </div>
                              <h3 className="font-bold text-lg text-white flex items-center justify-center gap-2">
                                {game.name}
                              </h3>

                              <div className="w-full">
                                {!hasRobloxGameAccess(game.id) ? (
                                  <button disabled className="w-full py-3 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                    🔒 ล็อกสิทธิ์
                                  </button>
                                ) : (
                                  <>
                                    {status === 'not_installed' && (
                                      <button
                                        onClick={() => {
                                          setInstallStatuses(prev => ({ ...prev, [game.id]: 'installing' }));
                                          setTimeout(() => {
                                            setInstallStatuses(prev => ({ ...prev, [game.id]: 'installed' }));
                                          }, 3000);
                                        }}
                                        className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-yellow-500/20"
                                      >
                                        <Download className="w-4 h-4" /> โหลด
                                      </button>
                                    )}

                                    {status === 'installing' && (
                                      <button disabled className="w-full py-3 bg-zinc-800 text-yellow-400 border border-yellow-500/30 rounded-xl font-bold text-sm flex items-center justify-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังติดตั้ง...
                                      </button>
                                    )}

                                    {status === 'installed' && (
                                      <button
                                        onClick={() => {
                                          if (game.url) {
                                            if (window.electron && window.electron.openExternalUrl) {
                                              window.electron.openExternalUrl(game.url);
                                            } else {
                                              window.open(game.url, '_blank');
                                            }
                                          } else {
                                            Swal.fire('เกิดข้อผิดพลาดในการโหลดคลังเสียง');
                                          }
                                        }}
                                        className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                                      >
                                        <Play className="w-4 h-4" fill="currentColor" /> เริ่มเกม
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedCategory === 'minecraft' && (
                    <div className="w-full">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 bg-green-500/20 text-green-400 rounded-xl flex items-center justify-center border border-green-500/30">
                          <Box className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl font-bold">Minecraft Built-in Server</h2>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] gap-6 items-start">
                        {/* Left: Server List */}
                        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col gap-4">
                          <h3 className="font-bold text-lg text-zinc-300">เซิร์ฟเวอร์</h3>

                          <div className="flex flex-col gap-4 max-h-[560px] overflow-y-auto custom-scrollbar px-1 pr-2 py-1">
                            {/* Diamond 3x3x3 Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 mb-4 ${activeMcTab === 'diamond_3x3x3' ? 'bg-black/40 border-yellow-500/50 shadow-[0_0_15px_rgba(250,204,21,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('diamond_3x3x3')}
                                className="w-full text-left p-4 flex items-center gap-3 relative"
                              >
                                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                                  <Box className="w-6 h-6 text-yellow-400" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight flex items-center gap-2">Minecraft ขุดเพชร 3x3x3</h4>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                    {showNewBadge && <span className="px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-black rounded-full shadow-[0_0_8px_rgba(239,68,68,0.6)] animate-pulse leading-none">NEW</span>}
                                  </div>
                                </div>
                              </button>

                              {activeMcTab === 'diamond_3x3x3' && (
                                <div className="p-4 pt-0 border-t border-yellow-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-diamond-3x3x3/releases/latest/download/Diamond.3x3x3.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('Error', res.error || 'ติดตั้งไม่สำเร็จ', 'error');
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <button
                                        onClick={() => {
                                          if (!window.electron || !window.electron.installMinecraftServer) return;
                                          setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                          const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-diamond-3x3x3/releases/latest/download/Diamond.3x3x3.zip';
                                          const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                          window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                            if (res.success) {
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัพเดทเซิร์ฟเวอร์สำเร็จ!'] } }));
                                            } else {
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                              Swal.fire('Error', res.error || 'อัพเดทไม่สำเร็จ', 'error');
                                            }
                                          });
                                        }}
                                        className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                      >
                                        <Download className="w-4 h-4" /> อัปเดต (Update)
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: [], status: 'running' } }));
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => {
                                            const result = await Swal.fire({
                                              title: 'ยืนยันการลบ',
                                              text: "ต้องการลบเซิร์ฟเวอร์ Minecraft ขุดเพชร 3x3x3 ใช่หรือไม่? (ไม่สามารถกู้คืนได้)",
                                              icon: 'warning',
                                              showCancelButton: true,
                                              confirmButtonColor: '#ef4444',
                                              cancelButtonColor: '#3f3f46',
                                              confirmButtonText: 'ลบเซิร์ฟเวอร์',
                                              cancelButtonText: 'ยกเลิก'
                                            });
                                            if (result.isConfirmed) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('ลบสำเร็จ', 'ลบเซิร์ฟเวอร์เรียบร้อยแล้ว', 'success');
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Diamond Classic Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 mb-4 ${activeMcTab === 'diamond_classic' ? 'bg-black/40 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('diamond_classic')}
                                className="w-full text-left p-4 flex items-center gap-3 relative"
                              >
                                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                  <Box className="w-6 h-6 text-amber-400" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight flex items-center gap-2">Minecraft ขุดเพชร</h4>
                                  <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                </div>
                              </button>

                              {activeMcTab === 'diamond_classic' && (
                                <div className="p-4 pt-0 border-t border-amber-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-diamond-classic-server/releases/latest/download/Diamond.Classic.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('Error', res.error || 'ติดตั้งไม่สำเร็จ', 'error');
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <button
                                        onClick={() => {
                                          if (!window.electron || !window.electron.installMinecraftServer) return;
                                          setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                          const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-diamond-classic-server/releases/latest/download/Diamond.Classic.zip';
                                          const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                          window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                            if (res.success) {
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัพเดทเซิร์ฟเวอร์สำเร็จ!'] } }));
                                            } else {
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                              Swal.fire('Error', res.error || 'อัพเดทไม่สำเร็จ', 'error');
                                            }
                                          });
                                        }}
                                        className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                      >
                                        <Download className="w-4 h-4" /> อัปเดต (Update)
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: [], status: 'running' } }));
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => {
                                            const result = await Swal.fire({
                                              title: 'ยืนยันการลบ',
                                              text: "ต้องการลบเซิร์ฟเวอร์ Minecraft ขุดเพชร ใช่หรือไม่? (ไม่สามารถกู้คืนได้)",
                                              icon: 'warning',
                                              showCancelButton: true,
                                              confirmButtonColor: '#ef4444',
                                              cancelButtonColor: '#3f3f46',
                                              confirmButtonText: 'ลบเซิร์ฟเวอร์',
                                              cancelButtonText: 'ยกเลิก'
                                            });
                                            if (result.isConfirmed) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('ลบสำเร็จ', 'ลบเซิร์ฟเวอร์เรียบร้อยแล้ว', 'success');
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Fishing Pig Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 mb-4 ${activeMcTab === 'fishing_pig' ? 'bg-black/40 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('fishing_pig')}
                                className="w-full text-left p-4 flex items-center gap-3 relative"
                              >
                                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                  <Box className="w-6 h-6 text-amber-400" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight flex items-center gap-2">Minecraft ตกหมู</h4>
                                  <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                </div>
                              </button>

                              {activeMcTab === 'fishing_pig' && (
                                <div className="p-4 pt-0 border-t border-amber-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-fishing-pig-server/releases/latest/download/Fishing.Pig.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('Error', res.error || 'ติดตั้งไม่สำเร็จ', 'error');
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <button
                                        onClick={() => {
                                          if (!window.electron || !window.electron.installMinecraftServer) return;
                                          setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                          const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-fishing-pig-server/releases/latest/download/Fishing.Pig.zip';
                                          const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                          window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                            if (res.success) {
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัพเดทเซิร์ฟเวอร์สำเร็จ!'] } }));
                                            } else {
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                              Swal.fire('Error', res.error || 'อัพเดทไม่สำเร็จ', 'error');
                                            }
                                          });
                                        }}
                                        className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                      >
                                        <Download className="w-4 h-4" /> อัปเดต (Update)
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: [], status: 'running' } }));
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => {
                                            const result = await Swal.fire({
                                              title: 'ยืนยันการลบ',
                                              text: "ต้องการลบเซิร์ฟเวอร์ Minecraft ตกหมู ใช่หรือไม่? (ไม่สามารถกู้คืนได้)",
                                              icon: 'warning',
                                              showCancelButton: true,
                                              confirmButtonColor: '#ef4444',
                                              cancelButtonColor: '#3f3f46',
                                              confirmButtonText: 'ลบเซิร์ฟเวอร์',
                                              cancelButtonText: 'ยกเลิก'
                                            });
                                            if (result.isConfirmed) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('ลบสำเร็จ', 'ลบเซิร์ฟเวอร์เรียบร้อยแล้ว', 'success');
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Parkour Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 ${activeMcTab === 'parkour' ? 'bg-black/40 border-yellow-500/50 shadow-[0_0_15px_rgba(250,204,21,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('parkour')}
                                className="w-full text-left p-4 flex items-center gap-3"
                              >
                                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/></svg>
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight flex items-center gap-2">Minecraft ปากัว</h4>
                                  <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                </div>
                              </button>

                              {activeMcTab === 'parkour' && (
                                <div className="p-4 pt-0 border-t border-yellow-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (window.electron && window.electron.installMinecraftServer) {
                                              const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-parkour-server/releases/download/v1.0.1/Parkour.zip';
                                              setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                              window.electron.installMinecraftServer(zipUrl, activeMcTab, mcServers[activeMcTab].latestVersion || '1.0.1').then((success: boolean) => {
                                                if (success) {
                                                  setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                  Swal.fire('ติดตั้งสำเร็จ', 'ติดตั้ง Minecraft Parkour เรียบร้อยแล้ว', 'success');
                                                } else {
                                                  setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                  Swal.fire('ติดตั้งล้มเหลว', 'เกิดข้อผิดพลาดในการติดตั้ง', 'error');
                                                }
                                              });
                                            }
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.installMinecraftServer) {
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-parkour-server/releases/download/v1.0.1/Parkour.zip';
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, mcServers[activeMcTab].latestVersion || '1.0.1').then((success: boolean) => {
                                              if (success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                Swal.fire('อัพเดตสำเร็จ', 'อัพเดต Minecraft Parkour เรียบร้อยแล้ว', 'success');
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                                Swal.fire('อัพเดตล้มเหลว', 'เกิดข้อผิดพลาดในการอัพเดต', 'error');
                                              }
                                            });
                                          }
                                        }}
                                        className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                      >
                                        <Download className="w-4 h-4" /> อัปเดต (Update)
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: [], status: 'running' } }));
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => {
                                            const result = await Swal.fire({
                                              title: 'ยืนยันการลบ',
                                              text: "ต้องการลบเซิร์ฟเวอร์ Minecraft ปากัว ใช่หรือไม่? (ไม่สามารถกู้คืนได้)",
                                              icon: 'warning',
                                              showCancelButton: true,
                                              confirmButtonColor: '#ef4444',
                                              cancelButtonColor: '#3f3f46',
                                              confirmButtonText: 'ลบเซิร์ฟเวอร์',
                                              cancelButtonText: 'ยกเลิก'
                                            });
                                            if (result.isConfirmed) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                Swal.fire('ลบสำเร็จ', 'ลบเซิร์ฟเวอร์เรียบร้อยแล้ว', 'success');
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Snowball Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 ${activeMcTab === 'snowball' ? 'bg-black/40 border-yellow-500/50 shadow-[0_0_15px_rgba(250,204,21,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('snowball')}
                                className="w-full text-left p-4 flex items-center gap-3"
                              >
                                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                                  <Box className="w-6 h-6 text-yellow-400" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight">Minecraft ต่อบล็อก Snowball</h4>
                                  <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                </div>
                              </button>

                              {activeMcTab === 'snowball' && (
                                <div className="p-4 pt-0 border-t border-yellow-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-snowball-server/releases/download/v1.0.2/Minecraft.Snowball.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.2';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งล้มเหลว: ' + res.error] } }));
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <div className="flex flex-col gap-2">
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-snowball-server/releases/download/v1.0.2/Minecraft.Snowball.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.2';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัปเดตเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัปเดตล้มเหลว: ' + res.error] } }));
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> อัปเดต (Update)
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'running' } }));
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => { if (await Swal.fire({title: 'แน่ใจหรือไม่ว่าต้องการลบเซิร์ฟเวอร์? ข้อมูลโลกจะหายทั้งหมด!', icon: 'warning', showCancelButton: true, confirmButtonText: 'ใช่', cancelButtonText: 'ยกเลิก'}).then(r => r.isConfirmed)) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ลบเซิร์ฟเวอร์แล้ว'] } }));
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Farm Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 ${activeMcTab === 'farm' ? 'bg-black/40 border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('farm')}
                                className="w-full text-left p-4 flex items-center gap-3"
                              >
                                <div className="w-12 h-12 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                                  <Box className="w-6 h-6 text-green-400" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight">Minecraft ขุดเพชรในฟาร์ม</h4>
                                  <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                </div>
                              </button>

                              {activeMcTab === 'farm' && (
                                <div className="p-4 pt-0 border-t border-green-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-farm-server/releases/download/v1.0.0/server.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งล้มเหลว: ' + res.error] } }));
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <div className="flex flex-col gap-2">
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-farm-server/releases/download/v1.0.0/server.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.0';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัปเดตเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัปเดตล้มเหลว: ' + res.error] } }));
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> อัปเดต (Update)
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'running' } }));
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => { if (await Swal.fire({title: 'แน่ใจหรือไม่ว่าต้องการลบเซิร์ฟเวอร์? ข้อมูลโลกจะหายทั้งหมด!', icon: 'warning', showCancelButton: true, confirmButtonText: 'ใช่', cancelButtonText: 'ยกเลิก'}).then(r => r.isConfirmed)) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ลบเซิร์ฟเวอร์แล้ว'] } }));
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Havest Server */}
                            <div className={`rounded-2xl border transition-all overflow-hidden shrink-0 ${activeMcTab === 'havest' ? 'bg-black/40 border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'bg-black/20 border-white/5 hover:bg-black/30'}`}>
                              <button
                                onClick={() => setActiveMcTab('havest')}
                                className="w-full text-left p-4 flex items-center gap-3"
                              >
                                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                                  <Box className="w-6 h-6 text-yellow-400" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-white leading-tight">Minecraft ปลูกข้าว</h4>
                                  <span className="text-[10px] text-zinc-400">เวอร์ชัน 1.21.3</span>
                                </div>
                              </button>

                              {activeMcTab === 'havest' && (
                                <div className="p-4 pt-0 border-t border-yellow-500/20 mt-2">
                                  <div className="flex flex-col gap-2 mt-4">
                                    {mcServers[activeMcTab].status === 'checking' && (
                                      <button disabled className="w-full py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบ...
                                      </button>
                                    )}

                                    {mcServers[activeMcTab].status === 'not_installed' && (
                                      !hasMinecraftGameAccess(activeMcTab) ? (
                                        <button disabled className="w-full py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                          🔒 ล็อกสิทธิ์
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-havest-farm-server/releases/download/v1.0.1/Harvest.Farm.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.1';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ติดตั้งล้มเหลว: ' + res.error] } }));
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> ติดตั้ง
                                        </button>
                                      )
                                    )}

                                    {mcServers[activeMcTab].status === 'needs_update' && (
                                      <div className="flex flex-col gap-2">
                                        <button
                                          onClick={() => {
                                            if (!window.electron || !window.electron.installMinecraftServer) return;
                                            setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'installing', progress: 0 } }));
                                            const zipUrl = mcServers[activeMcTab].zipUrl || 'https://github.com/katozztv/minecraft-havest-farm-server/releases/download/v1.0.1/Harvest.Farm.zip';
                                            const newVersion = mcServers[activeMcTab].latestVersion || '1.0.1';
                                            window.electron.installMinecraftServer(zipUrl, activeMcTab, newVersion).then((res: any) => {
                                              if (res.success) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'stopped' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัปเดตเซิร์ฟเวอร์สำเร็จ!'] } }));
                                              } else {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'needs_update' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] อัปเดตล้มเหลว: ' + res.error] } }));
                                              }
                                            });
                                          }}
                                          className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-black rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
                                        >
                                          <Download className="w-4 h-4" /> อัปเดต (Update)
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'installing' && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <button disabled className="w-full py-2 bg-yellow-500/50 text-white/50 rounded-xl text-sm font-bold flex justify-center items-center gap-2">
                                          <Loader2 className="w-4 h-4 animate-spin" /> กำลังดาวน์โหลด... {mcServers[activeMcTab].progress}%
                                        </button>
                                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-yellow-500 transition-all duration-300" style={{ width: `${mcServers[activeMcTab].progress}%` }}></div>
                                        </div>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'stopped' && (
                                      <div className="flex items-center gap-2">
                                        {!hasMinecraftGameAccess(activeMcTab) ? (
                                          <button disabled className="flex-1 py-2 bg-zinc-800 text-zinc-500 border border-zinc-700 rounded-xl text-sm font-bold flex justify-center items-center gap-2 cursor-not-allowed">
                                            🔒 ล็อกสิทธิ์
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              if (window.electron && window.electron.startMinecraftServer) {
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'running' } }));
                                                setIsMcStartingModalOpen(true);
                                                setMcStartupStatus('starting');
                                                setMcStartupProgress(0);
                                                window.electron.startMinecraftServer(activeMcTab);
                                              }
                                            }}
                                            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                                          >
                                            <Play className="w-4 h-4 fill-current" /> เล่น
                                          </button>
                                        )}
                                        <button
                                          onClick={async () => { if (await Swal.fire({title: 'แน่ใจหรือไม่ว่าต้องการลบเซิร์ฟเวอร์? ข้อมูลโลกจะหายทั้งหมด!', icon: 'warning', showCancelButton: true, confirmButtonText: 'ใช่', cancelButtonText: 'ยกเลิก'}).then(r => r.isConfirmed)) {
                                              if (window.electron && window.electron.deleteMinecraftServer) {
                                                window.electron.deleteMinecraftServer(activeMcTab);
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], status: 'not_installed' } }));
                                                setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], logs: ['[System] ลบเซิร์ฟเวอร์แล้ว'] } }));
                                              }
                                            }
                                          }}
                                          className="p-2 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl transition-colors"
                                          title="ลบเซิร์ฟเวอร์"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    )}

                                    {mcServers[activeMcTab].status === 'running' && (
                                      <button
                                        onClick={() => {
                                          if (window.electron && window.electron.stopMinecraftServer) {
                                            window.electron.stopMinecraftServer(activeMcTab);
                                          }
                                        }}
                                        className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-bold flex justify-center items-center gap-2 transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                                      >
                                        <X className="w-4 h-4" /> ปิด (Stop)
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>


                          </div>
                        </div>

                        {/* Middle: Image, Overlay Button & Console */}
                        <div className="flex flex-col gap-4 h-full">
                          {(activeMcTab === 'snowball' || activeMcTab === 'havest' || activeMcTab === 'parkour' || activeMcTab === 'fishing_pig' || activeMcTab === 'diamond_classic' || activeMcTab === 'diamond_3x3x3') && (
                            <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-4">
                              <img src={activeMcTab === 'snowball' ? "/games/minecraft_snowball.png" : activeMcTab === 'fishing_pig' ? "/games/minecraft_snowball.png" : "/games/minecraft_cover.jpg"} alt={`Minecraft ${activeMcTab}`} className="w-full h-[200px] rounded-3xl border border-white/10 shadow-lg object-cover" />

                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText('http://localhost:9987/overlay.html');
                                  Swal.fire('เริ่มต้นเปิด Overlay สำเร็จ!');
                                }}
                                className="w-full bg-yellow-500 hover:bg-yellow-600 text-black py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)]"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                ก็อปปี้ลิ้ง Overlay (http://localhost:9987/overlay.html)
                              </button>
                            </div>
                          )}
                          <div className="bg-[#0c0c0e] border border-white/10 rounded-3xl overflow-hidden flex flex-col h-[420px] shrink-0">
                            <div className="bg-white/5 border-b border-white/5 px-4 py-3 flex items-center justify-between shrink-0">
                              <h3 className="font-bold text-sm text-zinc-300 flex items-center gap-2">
                                <Activity className="w-4 h-4 text-yellow-400" /> Console
                              </h3>
                              <div className="flex items-center gap-2">
                                <span className="relative flex h-2 w-2">
                                  {mcServers[activeMcTab].status === 'running' ? (
                                    <>
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </>
                                  ) : (
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-zinc-600"></span>
                                  )}
                                </span>
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                  {mcServers[activeMcTab].status === 'running' ? 'ONLINE' : 'OFFLINE'}
                                </span>
                              </div>
                            </div>

                            <div className="flex-1 min-h-0 p-4 overflow-y-auto font-mono text-xs text-zinc-300 break-all space-y-1 flex flex-col-reverse custom-scrollbar">
                              {mcServers[activeMcTab].logs.slice().reverse().map((log, i) => (
                                <div key={i}>{log}</div>
                              ))}
                            </div>

                            <div className="p-3 bg-black/40 border-t border-white/5 shrink-0">
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  if (mcServers[activeMcTab].command.trim() && mcServers[activeMcTab].status === 'running' && window.electron && window.electron.sendMinecraftCommand) {
                                    window.electron.sendMinecraftCommand(mcServers[activeMcTab].command.trim(), activeMcTab);
                                    setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], command: '' } }));
                                  }
                                }}
                                className="flex items-center gap-2"
                              >
                                <input
                                  type="text"
                                  value={mcServers[activeMcTab].command}
                                  onChange={(e) => setMcServers(prev => ({ ...prev, [activeMcTab]: { ...prev[activeMcTab], command: e.target.value } }))}
                                  placeholder={mcServers[activeMcTab].status === 'running' ? "พิมพ์คำสั่ง (ไม่ต้องใส่ /)" : "เซิร์ฟเวอร์ยังไม่ทำงาน..."}
                                  disabled={mcServers[activeMcTab].status !== 'running'}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50"
                                />
                                <button
                                  type="submit"
                                  disabled={!mcServers[activeMcTab].command.trim() || mcServers[activeMcTab].status !== 'running'}
                                  className="bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-black rounded-lg px-4 py-2 text-sm font-bold transition-colors"
                                >
                                  ส่ง
                                </button>
                              </form>
                            </div>
                          </div>
                        </div>

                        {/* Right: Info / Commands */}
                        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col gap-4 max-h-[600px]">
                          <h3 className="font-bold text-lg text-zinc-300 shrink-0">คำสั่ง (Commands)</h3>
                          <div className="space-y-3 overflow-y-auto flex-1 min-h-0 custom-scrollbar pr-2">
                            {activeMcTab === 'diamond_3x3x3' ? (
                              [
                                { cmd: '/diamond up <จำนวน>', desc: 'เพิ่มเพชรตามจำนวน' },
                                { cmd: '/diamond down <จำนวน>', desc: 'ลดเพชรตามจำนวน (ถ้าเพชรไม่พอ จะติดหนี้)' },
                                { cmd: '/diamond help <วินาที>', desc: 'บล็อกรอบตัวกลายเป็นแร่เพชร ตามจำนวนวินาที หมดเวลาแล้วกลับเหมือนเดิม' },
                                { cmd: '/diamond creeper <จำนวน>', desc: 'เสก creeper เพชร ระเบิดแล้วได้แร่เพชรตามจำนวน (ไม่เจ็บ)' },
                                { cmd: '/diamond creeper down <จำนวน> <เพชรที่เสีย>', desc: 'เสก creeper ตัวจริงตามจำนวน ระเบิดเจ็บจริง แล้วเสียเพชร' },
                                { cmd: '/reset', desc: 'เพชรกลับเป็น 0 (หนี้หายด้วย)' },
                                { cmd: '/zombie <จำนวน> <เพชรที่เสีย>', desc: 'เสกซอมบี้ตามจำนวน แล้วเสียเพชร' },
                                { cmd: '/lava <จำนวน> <เพชรที่เสีย>', desc: 'เสกลาวาตามจำนวน แล้วเสียเพชร' },
                                { cmd: '/tnt <จำนวน> <เพชรที่เสีย>', desc: 'เสก TNT ตามจำนวน แล้วเสียเพชร' },
                                { cmd: '/gas <จำนวน> <เพชรที่เสีย>', desc: 'เสก ghast ตามจำนวน ต้องฆ่าให้หมดถึงจะขุดได้ แล้วเสียเพชร' },
                                { cmd: '/warden <จำนวน> <เพชรที่เสีย>', desc: 'เสก warden ตามจำนวน ตัวเราช้าลงและขุดไม่ได้ 7 วินาที แล้วเสียเพชร' },
                                { cmd: '/web <จำนวน> <เพชรที่เสีย>', desc: 'เสกใยแมงมุมตามจำนวน อยู่ 5 วินาทีแล้วหาย แล้วเสียเพชร' },
                                { cmd: '/fairry <จำนวน> <เพชรที่ได้>', desc: 'เสกแฟรี่ตามจำนวน บินไประเบิด แล้วได้เพชร' },
                                { cmd: '/golem <จำนวน> <เพชรที่ได้>', desc: 'เสก golem ตามจำนวน warden จะไปสู้กับ golem แทน แล้วได้เพชร' },
                                { cmd: '/stick <วินาที>', desc: 'จอบกลายเป็นไม้ ขุดได้ทีละบล็อก ตามจำนวนวินาที (ใช้ /stick กับ /god คู่กัน เวลาจะหักลบกัน)' },
                                { cmd: '/god pickaxe <วินาที>', desc: 'จอบแรงขึ้น วิ่งเร็ว 2 เท่า ขุดไกลขึ้น ตามจำนวนวินาที (ใช้ /stick กับ /god คู่กัน เวลาจะหักลบกัน)' },
                                { cmd: '/magnet on', desc: 'เพชรที่ขุดลอยเข้าตัวเอง' },
                                { cmd: '/magnet off', desc: 'เพชรไม่ลอยเข้าตัว (ตอนเริ่มเกมเป็น off)' },
                                { cmd: '/armor on', desc: 'ใส่ชุดเกราะเนเธอไรต์ครบชุด ไม่มีวันพัง' },
                                { cmd: '/armor off', desc: 'ถอดชุดเกราะออก (ตอนเริ่มเกมเป็น off)' },
                                { cmd: '/die set <จำนวน>', desc: 'ตั้งเพชรที่เสียตอนตาย (ตอนนี้ 50, ใส่ 0 = ตายแล้วไม่เสีย)' },
                                { cmd: '/win set <จำนวน>', desc: 'ตั้งเป้าเพชรที่ต้องได้ถึงจะชนะ (เริ่มต้น 1000)' },
                                { cmd: '/win time set <วินาที>', desc: 'ตั้งเวลานับถอยหลังตอนเพชรถึงเป้า นับถึง 0 = ชนะ ถ้าเพชรต่ำกว่าเป้าระหว่างนับ = ยกเลิก' },
                                { cmd: '/win diamond lock off', desc: 'เพชรเกินเป้าได้' },
                                { cmd: '/win diamond lock on', desc: 'เพชรเกินเป้าไม่ได้เลย (ขุดเองหรือใช้คำสั่งก็เกินไม่ได้)' },
                                { cmd: '/win diamond lock on cm', desc: 'ขุดเองเกินเป้าไม่ได้ แต่ใช้คำสั่งเพิ่มเกินเป้าได้' },
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-yellow-500/30 transition-colors">
                                  <code className="text-yellow-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            ) : activeMcTab === 'diamond_classic' ? (
                              [
                                { cmd: '/set <จำนวน>', desc: 'ตั้งค่าจำนวน เพชร ที่ต้องการ' },
                                { cmd: '/diamond up <จำนวน>', desc: 'เพิ่มเพชร ตามจำนวน' },
                                { cmd: '/diamond down <จำนวน>', desc: 'ลบเพชร ตามจำนวน' },
                                { cmd: '/diamond death <จำนวน>', desc: 'ตั้งค่าจำนวนเพชรที่จะถูกหักเมื่อผู้เล่นตาย' },
                                { cmd: '/delete invitory', desc: 'ลบไอเทมในกระเป๋าทั้งหมดยกเว้นเพชร' },
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-amber-500/30 transition-colors">
                                  <code className="text-amber-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            ) : activeMcTab === 'fishing_pig' ? (
                              [
                                { cmd: '/mob up <จำนวน>', desc: 'เพิ่มหมูตามจำนวน' },
                                { cmd: '/mob down <จำนวน>', desc: 'ลดหมู ตามจำนวน' },
                                { cmd: '/power up <จำนวน>', desc: 'เพิ่มความจุกระเป๋าอุ้มหมู ตามจำนวน' },
                                { cmd: '/power down <จำนวน>', desc: 'ลดความจุกระเป๋าอุ้มหมู ตามจำนวน' },
                                { cmd: '/size up <จำนวน>', desc: 'ขยาย ฟาร์ม (ไม่เพิ่มหมู)' },
                                { cmd: '/size down <จำนวน>', desc: 'ย่อ ฟาร์ม (ไม่เพิ่มหมู)' },
                                { cmd: '/village <จำนวน>', desc: 'เรียกชาวบ้านมา เคลียหมู ตามจำนวนตัว' },
                                { cmd: '/pigboom <จำนวน>', desc: 'เรียกหมูยักษ์ เสกหมูตามจำนวน' },
                                { cmd: '/win', desc: 'เคลียร์หมูทั้งหมด และเล่นฉากจบแบบชนะ' },
                                { cmd: '/lose', desc: 'เล่นฉากจบแบบแพ้และ ขยาย x15 พร้อมหมู อีก 150 ตัว' },
                                { cmd: '/reset', desc: 'รีเซ็ต' }
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-amber-500/30 transition-colors">
                                  <code className="text-amber-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            ) : activeMcTab === 'snowball' ? (
                              [
                                { cmd: '/village <จำนวน>', desc: 'เติม Block เป็น % ตามจำนวน' },
                                { cmd: '/tnt <จำนวน>', desc: 'ทำลาย Block เป็น % ตามจำนวน' },
                                { cmd: '/laser', desc: 'เติม Block 10%' },
                                { cmd: '/tnt big', desc: 'ทำลาย Block 10%' },
                                { cmd: '/size up <จำนวน>', desc: 'ขยาย ตามจำนวน' },
                                { cmd: '/size down', desc: 'ย่อ ตามจำนวน' },
                                { cmd: '/full', desc: 'เติม Block 100%' },
                                { cmd: '/dragon', desc: 'ทำลาย Block 100%' },
                                { cmd: '/win', desc: 'เติมครบ ได้วินเลย' },
                                { cmd: '/lose', desc: 'ทำลายจนหมด และ ขยาย x5' },
                                { cmd: '/reset', desc: 'รีเซ็ต' }
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-yellow-500/30 transition-colors">
                                  <code className="text-yellow-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            ) : activeMcTab === 'farm' ? (
                              [
                                { cmd: '/village <จำนวน%>', desc: 'เสกชาวบ้านทำลายบล็อกตาม%' },
                                { cmd: '/mob <จำนวน%>', desc: 'เสกซอมบี้เสกเพชรตาม%' },
                                { cmd: '/tnt', desc: 'เสก TNT ทำลาย 10%' },
                                { cmd: '/creeper', desc: 'เสก Creeper เสกเพชร 10%' },
                                { cmd: '/lightning', desc: 'เสกสายฟ้า เสกเพชร 100% และมีไฟด้านบน' },
                                { cmd: '/tnt big', desc: 'เสก TNT ทำลายทั้งหมด' },
                                { cmd: '/dragon', desc: 'เสกมังกร เสกเพชร 100% และ ขยาย และ เพิ่มชั้น' },
                                { cmd: '/win', desc: 'เสกชาวบ้านทำให้ชนะทันที' },
                                { cmd: '/size up', desc: 'ขยาย ลานเพชร' },
                                { cmd: '/size down', desc: 'ย่อ ลานเพชร' }
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-yellow-500/30 transition-colors">
                                  <code className="text-yellow-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            ) : activeMcTab === 'parkour' ? (
                              [
                                { cmd: '/tnt <จำนวน>', desc: 'เสก tnt ผลักขึ้นด้านบน ยิ่งจำนวนเยอะยิ่งแรง' },
                                { cmd: '/tnt r <จำนวน>', desc: 'สุ่มเสก tnt ผลัก ยิ่งจำนวนเยอะยิ่งแรง' },
                                { cmd: '/web', desc: 'เสกใยแมงมุมรอบตัว' },
                                { cmd: '/chicken', desc: 'ขี่ไก่ไป stage ถัดไป' },
                                { cmd: '/fly <จำนวน>', desc: 'เปิดโหมดบิน ตามจำนวนวินาที' },
                                { cmd: '/return', desc: 'กลับไป checkpoint ล่าสุด' },
                                { cmd: '/win', desc: 'เรียกมังกรออกมาสั่งไปชั้นบนสุด' },
                                { cmd: '/reset', desc: 'ฟ้าผ่ารัวๆ และ RESET กลับไปที่ checkpoint' }
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-yellow-500/30 transition-colors">
                                  <code className="text-yellow-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            ) : (
                              [
                                { cmd: '/create <ขนาด>', desc: 'สร้างฟาร์มเริ่มต้น (หรือ 35x35)' },
                                { cmd: '/size up <จำนวน>', desc: 'ขยายขนาดฟาร์มเพิ่มขึ้น' },
                                { cmd: '/size down <จำนวน>', desc: 'ย่อขนาดฟาร์มเล็กลง' },
                                { cmd: '/reset', desc: 'รีเซ็ตฟาร์มทั้งหมดกลับเป็น 35x35' },
                                { cmd: '/village <เปอร์เซ็นต์>', desc: 'ชาวนามาช่วยปลูกข้าว ตาม %' },
                                { cmd: '/mob <เปอร์เซ็นต์>', desc: 'ปล่อยหมูทำลายข้าว ตาม %' },
                                { cmd: '/break <วินาที>', desc: 'สร้างกรงเหล็กขังผู้เล่น' },
                                { cmd: '/small fairy', desc: 'แฟรี่ช่วยปลูกข้าวหย่อมเล็ก 10%' },
                                { cmd: '/small lightning', desc: 'ฟ้าผ่าทำลายข้าวหย่อมเล็ก 10%' },
                                { cmd: '/full', desc: 'ปูพรมลูกบอลหิมะ ปลูก 100%' },
                                { cmd: '/lightning', desc: 'พายุฟ้าผ่าปูพรมทำลาย 100%' },
                                { cmd: '/dragon', desc: 'มังกรทำลาย 100%' },
                                { cmd: '/win', desc: 'แสดงฉากจบ WIN ทันที' }
                              ].map((item, idx) => (
                                <div key={idx} className="bg-black/30 p-3 rounded-xl border border-white/5 hover:border-yellow-500/30 transition-colors">
                                  <code className="text-yellow-400 font-bold text-sm block mb-1">{item.cmd}</code>
                                  <p className="text-zinc-400 text-xs">{item.desc}</p>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {showRenamePresetModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-xl font-bold text-white mb-4">เปลี่ยนชื่อ Preset</h3>
              <input
                type="text"
                placeholder="ชื่อ Preset ใหม่"
                value={renamePresetName}
                onChange={(e) => setRenamePresetName(e.target.value)}
                className="w-full bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-500/50 mb-4"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowRenamePresetModal(false);
                    setRenamePresetName('');
                  }}
                  className="px-4 py-2 rounded-xl font-bold text-zinc-400 hover:bg-white/5 transition-all"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => {
                    if (renamePresetName.trim() && activeGiftPresetId) {
                      const updated = giftPresets.map(p => p.id === activeGiftPresetId ? { ...p, name: renamePresetName.trim() } : p);
                      setGiftPresets(updated);
                      updateGiftPresetsBackend(updated, activeGiftPresetId);
                      setShowRenamePresetModal(false);
                      setRenamePresetName('');
                    }
                  }}
                  className="px-4 py-2 rounded-xl font-bold bg-amber-500 hover:bg-amber-400 text-black transition-all shadow-lg shadow-amber-500/20"
                >
                  บันทึก
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewPresetModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
              <h3 className="text-xl font-bold text-white mb-4">สร้าง Preset ใหม่</h3>
              <input
                type="text"
                placeholder="ชื่อ Preset"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="w-full bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-500/50 mb-4"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowNewPresetModal(false);
                    setNewPresetName('');
                  }}
                  className="px-4 py-2 rounded-xl font-bold text-zinc-400 hover:bg-white/5 transition-all"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => {
                    if (newPresetName.trim()) {
                      const newPreset = { id: Date.now().toString(), name: newPresetName.trim(), rules: [] };
                      const updated = [...giftPresets, newPreset];
                      setGiftPresets(updated);
                      setActiveGiftPresetId(newPreset.id);
                      updateGiftPresetsBackend(updated, newPreset.id);
                      setShowNewPresetModal(false);
                      setNewPresetName('');
                    }
                  }}
                  className="px-4 py-2 rounded-xl font-bold bg-amber-500 hover:bg-amber-400 text-black transition-all shadow-lg shadow-amber-500/20"
                >
                  บันทึก
                </button>
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Gift Selector Modal */}
      {isGiftSelectorOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-white/5 flex justify-between items-center gap-4">
              <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                <Gift className="text-amber-500" /> เลือกของขวัญ
              </h3>

              <div className="flex flex-1 max-w-md gap-2">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อของขวัญ..."
                  value={giftSearchQuery}
                  onChange={(e) => setGiftSearchQuery(e.target.value)}
                  className="flex-1 bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-2 text-white outline-none focus:border-amber-500/50"
                  autoFocus
                />
                <select
                  value={giftSortOrder}
                  onChange={(e) => setGiftSortOrder(e.target.value as 'asc' | 'desc')}
                  className="bg-black/50 border border-zinc-700/50 rounded-xl px-4 py-2 text-white outline-none focus:border-amber-500/50 cursor-pointer"
                >
                  <option value="asc">ราคา: น้อยไปมาก</option>
                  <option value="desc">ราคา: มากไปน้อย</option>
                </select>
              </div>

              <button
                onClick={() => {
                  setIsGiftSelectorOpen(false);
                  setSelectingRuleId(null);
                  setSelectingSoundRuleId(null);
                  setSelectingRouletteTriggerGiftId(null);
                }}
                className="text-zinc-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              {tiktokGifts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                  <Loader2 className="animate-spin mb-2" size={32} />
                  <p>กำลังโหลดข้อมูลของขวัญ...</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                  {('ผู้ติดตาม'.includes(giftSearchQuery) || 'follow'.includes(giftSearchQuery.toLowerCase())) && (
                    <div
                      onClick={() => {
                        const fakeGiftName = '__EVENT_FOLLOW__';
                        if (selectingSoundRuleId && activeGiftPresetId) {
                          const updatedPresets = giftPresets.map(p => {
                            if (p.id === activeGiftPresetId) {
                              const newSoundRules = (p.soundRules || []).map((r: any) => r.id === selectingSoundRuleId ? { ...r, giftName: fakeGiftName } : r);
                              return { ...p, soundRules: newSoundRules };
                            }
                            return p;
                          });
                          setGiftPresets(updatedPresets);
                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                        } else if (activeGiftPresetId) {
                          if (selectingRuleId) {
                            const updatedPresets = giftPresets.map(p => {
                              if (p.id === activeGiftPresetId) {
                                return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, giftName: fakeGiftName } : r) };
                              }
                              return p;
                            });
                            setGiftPresets(updatedPresets);
                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                          } else if (selectingRouletteTriggerGiftId) {
                            const updatedPresets = giftPresets.map(p => {
                              if (p.id === activeGiftPresetId) {
                                return { ...p, rouletteTriggers: p.rouletteTriggers.map((r: any) => r.id === selectingRouletteTriggerGiftId ? { ...r, giftName: fakeGiftName } : r) };
                              }
                              return p;
                            });
                            setGiftPresets(updatedPresets);
                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                          }
                        }
                        setIsGiftSelectorOpen(false);
                        setSelectingRuleId(null);
                        setSelectingSoundRuleId(null);
                        setSelectingRouletteTriggerGiftId(null);
                        setGiftSearchQuery('');
                      }}
                      className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex flex-col items-center gap-2 cursor-pointer hover:bg-emerald-500/20 hover:border-emerald-400 hover:scale-105 transition-all group"
                    >
                      <div className="w-16 h-16 flex items-center justify-center bg-emerald-500/20 rounded-full">
                        <Users className="w-8 h-8 text-emerald-400 drop-shadow-md group-hover:drop-shadow-[0_0_10px_rgba(52,211,153,0.5)] transition-all" />
                      </div>
                      <div className="text-center w-full">
                        <div className="text-sm font-bold text-white truncate px-1">ผู้ติดตาม (Follow)</div>
                        <div className="flex items-center justify-center gap-1 mt-1 text-emerald-400">
                          <span className="text-xs font-bold">Event</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {tiktokGifts
                    .filter(g => g.name.toLowerCase().includes(giftSearchQuery.toLowerCase()))
                    .sort((a, b) => giftSortOrder === 'asc' ? a.coin - b.coin : b.coin - a.coin)
                    .map((gift) => (
                      <div
                        key={gift.id}
                        onClick={() => {
                          if (selectingSoundRuleId && activeGiftPresetId) {
                            const updatedPresets = giftPresets.map(p => {
                              if (p.id === activeGiftPresetId) {
                                const newSoundRules = (p.soundRules || []).map((r: any) => r.id === selectingSoundRuleId ? { ...r, giftName: gift.name } : r);
                                return { ...p, soundRules: newSoundRules };
                              }
                              return p;
                            });
                            setGiftPresets(updatedPresets);
                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                          } else if (activeGiftPresetId) {
                            if (selectingRuleId) {
                              const updatedPresets = giftPresets.map(p => {
                                if (p.id === activeGiftPresetId) {
                                  return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, giftName: gift.name } : r) };
                                }
                                return p;
                              });
                              setGiftPresets(updatedPresets);
                              updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                            } else if (selectingRouletteTriggerGiftId) {
                              const updatedPresets = giftPresets.map(p => {
                                if (p.id === activeGiftPresetId) {
                                  return { ...p, rouletteTriggers: p.rouletteTriggers.map((r: any) => r.id === selectingRouletteTriggerGiftId ? { ...r, giftName: gift.name } : r) };
                                }
                                return p;
                              });
                              setGiftPresets(updatedPresets);
                              updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                            }
                          }
                          setIsGiftSelectorOpen(false);
                          setSelectingRuleId(null);
                          setSelectingSoundRuleId(null);
                          setSelectingRouletteTriggerGiftId(null);
                          setGiftSearchQuery('');
                        }}
                        className="bg-black/40 border border-white/5 rounded-xl p-3 flex flex-col items-center gap-2 cursor-pointer hover:bg-white/10 hover:border-amber-500/50 hover:scale-105 transition-all group"
                      >
                        <div className="w-16 h-16 flex items-center justify-center">
                          <img src={gift.image} alt={gift.name} className="max-w-full max-h-full object-contain drop-shadow-md group-hover:drop-shadow-[0_0_10px_rgba(245,158,11,0.5)] transition-all" loading="lazy" />
                        </div>
                        <div className="text-center w-full overflow-hidden">
                          <p className="text-xs text-white font-medium truncate">{gift.name}</p>
                          <div className="flex items-center justify-center gap-1 mt-1 bg-white/5 rounded-full py-0.5 px-2 w-fit mx-auto">
                            <img src="/images/home/logo-coin.png" alt="coin" className="w-3 h-3" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                            <span className="text-[10px] text-zinc-300">{gift.coin.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Roulette Settings Modal */}
      {editingRouletteTriggerSettingsId && activeGiftPresetId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-white/5 flex justify-between items-center gap-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="text-yellow-400" /> ตั้งค่าเปอร์เซ็นต์สำหรับเงื่อนไขนี้
              </h3>
              <button
                onClick={() => setEditingRouletteTriggerSettingsId(null)}
                className="text-zinc-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-2">
              {giftPresets.find(p => p.id === activeGiftPresetId)?.rules.length > 0 ? (
                giftPresets.find(p => p.id === activeGiftPresetId)?.rules.map((r: any) => {
                  const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                  const trigger = preset?.rouletteTriggers?.find((t: any) => t.id === editingRouletteTriggerSettingsId);
                  const currentWeight = trigger?.rouletteSettings?.[r.id] ?? 0;

                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
                      <span className="text-sm font-medium text-white truncate flex-1">{r.ruleName || 'ไม่ได้ตั้งชื่อ'}</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={currentWeight}
                          onChange={(e) => {
                            let val = parseInt(e.target.value) || 0;
                            if (val < 0) val = 0;

                            const updatedPresets = giftPresets.map(p => {
                              if (p.id === activeGiftPresetId) {
                                return {
                                  ...p,
                                  rouletteTriggers: p.rouletteTriggers.map((t: any) => {
                                    if (t.id === editingRouletteTriggerSettingsId) {
                                      return {
                                        ...t,
                                        rouletteSettings: {
                                          ...(t.rouletteSettings || {}),
                                          [r.id]: val
                                        }
                                      };
                                    }
                                    return t;
                                  })
                                };
                              }
                              return p;
                            });
                            setGiftPresets(updatedPresets);
                            updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                          }}
                          className="w-16 bg-black/50 border border-zinc-700/50 rounded-lg px-2 py-1.5 text-center text-yellow-400 outline-none focus:border-yellow-500/50"
                        />
                        <span className="text-sm text-zinc-500">%</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-sm text-zinc-500 py-4">ไม่พบคำสั่ง (Events) ใน Preset นี้</div>
              )}
            </div>

            {(() => {
              const preset = giftPresets.find(p => p.id === activeGiftPresetId);
              const trigger = preset?.rouletteTriggers?.find((t: any) => t.id === editingRouletteTriggerSettingsId);
              let total = 0;
              preset?.rules?.forEach((r: any) => {
                total += trigger?.rouletteSettings?.[r.id] || 0;
              });
              return (
                <div className="p-4 border-t border-white/5 bg-black/20">
                  <div className={`text-sm font-bold flex justify-between p-3 rounded-xl ${total > 0 ? (total === 100 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20') : 'text-zinc-500'}`}>
                    <span>เปอร์เซ็นต์รวม:</span>
                    <span>{total}% {total !== 100 && total > 0 && '(ควรให้ครบ 100%)'}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Virtual Keyboard Modal */}
      {isVirtualKeyboardOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-2xl max-w-[1200px] w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                ⌨️ Virtual Keyboard
              </h3>
              <button
                onClick={() => {
                  setIsVirtualKeyboardOpen(false);
                  setSelectingRuleId(null);
                }}
                className="text-zinc-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex gap-8">
              {/* Main Keyboard */}
              <div className="flex flex-col gap-2 flex-1">
                <div className="flex gap-2">
                  {['[Escape]', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '[Backspace]'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className={`bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded p-3 text-sm text-white hover:text-black font-medium transition-colors ${key === '[Backspace]' ? 'flex-1' : 'w-12'}`}>
                      {key.replace(/\[|\]/g, '')}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {['[Tab]', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className={`bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded p-3 text-sm text-white hover:text-black font-medium transition-colors ${key === '[Tab]' ? 'w-20' : 'w-12'}`}>
                      {key.replace(/\[|\]/g, '')}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {['[Caps]', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", '[Enter]'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className={`bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded p-3 text-sm text-white hover:text-black font-medium transition-colors ${key === '[Caps]' ? 'w-24' : key === '[Enter]' ? 'flex-1' : 'w-12'}`}>
                      {key.replace(/\[|\]/g, '')}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {['[Shift]', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', '[Shift]'].map((key, i) => (
                    <button key={key + i} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className={`bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded p-3 text-sm text-white hover:text-black font-medium transition-colors ${key === '[Shift]' ? 'flex-1' : 'w-12'}`}>
                      {key.replace(/\[|\]/g, '')}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {['[Ctrl]', '[Alt]', '[Space]', '[Alt]', '[Ctrl]'].map((key, i) => (
                    <button key={key + i} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className={`bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded p-3 text-sm text-white hover:text-black font-medium transition-colors ${key === '[Space]' ? 'flex-1' : 'w-16'}`}>
                      {key.replace(/\[|\]/g, '')}
                    </button>
                  ))}
                </div>
                {/* Arrow Keys */}
                <div className="flex flex-col items-center gap-1 mt-4">
                  <button onClick={() => {
                    if (selectingRuleId && activeGiftPresetId) {
                      const updated = giftPresets.map(p => {
                        if (p.id === activeGiftPresetId) {
                          return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + '[ArrowUp]' } : r) };
                        }
                        return p;
                      });
                      setGiftPresets(updated);
                      updateGiftPresetsBackend(updated, activeGiftPresetId);
                    }
                  }} className="bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded w-16 h-10 flex items-center justify-center text-sm text-white hover:text-black font-medium transition-colors">↑</button>
                  <div className="flex gap-1">
                    {['[ArrowLeft]', '[ArrowDown]', '[ArrowRight]'].map(key => (
                      <button key={key} onClick={() => {
                        if (selectingRuleId && activeGiftPresetId) {
                          const updated = giftPresets.map(p => {
                            if (p.id === activeGiftPresetId) {
                              return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                            }
                            return p;
                          });
                          setGiftPresets(updated);
                          updateGiftPresetsBackend(updated, activeGiftPresetId);
                        }
                      }} className="bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded w-16 h-10 flex items-center justify-center text-sm text-white hover:text-black font-medium transition-colors">
                        {key === '[ArrowLeft]' ? '←' : key === '[ArrowDown]' ? '↓' : '→'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Numpad */}
              <div className="flex flex-col gap-2 bg-black/20 p-4 rounded-xl border border-white/5">

                <div className="text-zinc-500 text-xs text-center font-medium mb-1">NUMPAD</div>
                <div className="grid grid-cols-4 gap-2 w-max mx-auto bg-black/20 p-4 rounded-xl border border-white/5">
                  {/* Row 1 */}
                  {['[NumLock]', '[Num/]', '[Num*]', '[Num-]'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className="w-12 h-12 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                      {key.replace(/\[|\]|Num/g, '').replace('Lock', 'Loc')}
                    </button>
                  ))}

                  {/* Row 2 */}
                  {['[Num7]', '[Num8]', '[Num9]'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className="w-12 h-12 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                      {key.replace(/\[|\]|Num/g, '')}
                    </button>
                  ))}
                  <button onClick={() => {
                    if (selectingRuleId && activeGiftPresetId) {
                      const updated = giftPresets.map(p => {
                        if (p.id === activeGiftPresetId) {
                          return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + '[Num+]' } : r) };
                        }
                        return p;
                      });
                      setGiftPresets(updated);
                      updateGiftPresetsBackend(updated, activeGiftPresetId);
                    }
                  }} className="w-12 h-[104px] row-span-2 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                    +
                  </button>

                  {/* Row 3 */}
                  {['[Num4]', '[Num5]', '[Num6]'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className="w-12 h-12 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                      {key.replace(/\[|\]|Num/g, '')}
                    </button>
                  ))}

                  {/* Row 4 */}
                  {['[Num1]', '[Num2]', '[Num3]'].map(key => (
                    <button key={key} onClick={() => {
                      if (selectingRuleId && activeGiftPresetId) {
                        const updated = giftPresets.map(p => {
                          if (p.id === activeGiftPresetId) {
                            return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + key } : r) };
                          }
                          return p;
                        });
                        setGiftPresets(updated);
                        updateGiftPresetsBackend(updated, activeGiftPresetId);
                      }
                    }} className="w-12 h-12 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                      {key.replace(/\[|\]|Num/g, '')}
                    </button>
                  ))}
                  <button onClick={() => {
                    if (selectingRuleId && activeGiftPresetId) {
                      const updated = giftPresets.map(p => {
                        if (p.id === activeGiftPresetId) {
                          return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + '[NumEnter]' } : r) };
                        }
                        return p;
                      });
                      setGiftPresets(updated);
                      updateGiftPresetsBackend(updated, activeGiftPresetId);
                    }
                  }} className="w-12 h-[104px] row-span-2 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                    Ent
                  </button>

                  {/* Row 5 */}
                  <button onClick={() => {
                    if (selectingRuleId && activeGiftPresetId) {
                      const updated = giftPresets.map(p => {
                        if (p.id === activeGiftPresetId) {
                          return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + '[Num0]' } : r) };
                        }
                        return p;
                      });
                      setGiftPresets(updated);
                      updateGiftPresetsBackend(updated, activeGiftPresetId);
                    }
                  }} className="w-[104px] h-12 col-span-2 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                    0
                  </button>
                  <button onClick={() => {
                    if (selectingRuleId && activeGiftPresetId) {
                      const updated = giftPresets.map(p => {
                        if (p.id === activeGiftPresetId) {
                          return { ...p, rules: p.rules.map((r: any) => r.id === selectingRuleId ? { ...r, actionKey: (r.actionKey || '') + '[Num.]' } : r) };
                        }
                        return p;
                      });
                      setGiftPresets(updated);
                      updateGiftPresetsBackend(updated, activeGiftPresetId);
                    }
                  }} className="w-12 h-12 bg-zinc-800 hover:bg-amber-600 border border-white/5 rounded text-sm text-white hover:text-black font-medium transition-colors flex justify-center items-center">
                    .
                  </button>
                </div>              </div>
            </div>
          </div>
        </div>
      )}

      {/* Macro Toast Notification */}
      {macroToast.show && (
        <div className="fixed bottom-6 right-6 bg-zinc-900 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.3)] text-white px-6 py-4 rounded-xl flex items-center gap-3 z-[250] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Play className="w-4 h-4 fill-emerald-400" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-emerald-400">ทดสอบระบบ</span>
            <span className="text-sm text-zinc-300">{macroToast.message}</span>
          </div>
        </div>
      )}

      {view === 'decoration' && (
        <div className="animate-in fade-in zoom-in-95 duration-300 flex justify-center w-full px-4 relative">
          {isLocked && (
            <div className="absolute z-50 flex flex-col items-center justify-center pointer-events-auto top-32">
              <div className="bg-black/80 px-8 py-6 flex flex-col items-center justify-center border border-red-500/40 rounded-3xl shadow-[0_0_30px_rgba(239,68,68,0.3)] backdrop-blur-xl transform transition-transform hover:scale-105">
                <span className="text-5xl mb-3 drop-shadow-lg">🔒</span>
                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 mb-1">ฟีเจอร์ถูกล็อก</h2>
                <p className="text-zinc-300 text-sm font-medium">ต้องได้รับสิทธิ์ TTV เพื่อใช้งานส่วนนี้</p>
              </div>
            </div>
          )}
          <div className={`w-full max-w-6xl ${isLocked ? 'pointer-events-none blur-[3px] opacity-50' : ''}`}>
            <header className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-4xl sm:text-5xl drop-shadow-[0_0_15px_rgba(250,204,21,0.3)]">✨</span>
                <h1 className="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-500 drop-shadow-[0_0_15px_rgba(250,204,21,0.3)] text-center sm:text-left">
                  ตกแต่ง
                </h1>
              </div>
            </header>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-500 to-amber-600"></div>
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🫙</span>
                    <div>
                      <h3 className="text-xl font-bold text-yellow-400">โหลของขวัญ</h3>
                      <p className="text-sm text-zinc-400">ของขวัญที่ได้รับจะตกลงมาทับถมกันในโหลนี้</p>
                    </div>
                  </div>
                  <button
                    onClick={toggleJarServer}
                    className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors shrink-0 ${
                      jarSettings.isRunning ? 'bg-yellow-500' : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        jarSettings.isRunning ? 'translate-x-9' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className={`space-y-6 transition-opacity duration-300 ${!jarSettings.isRunning ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3 w-full">
                      <span className="text-xl">🔗</span>
                      <div className="flex-1">
                        <p className="text-xs text-zinc-500 mb-1 font-medium">นำ URL นี้ไปใส่ใน Browser Source ของ OBS</p>
                        <code className="text-yellow-300 bg-yellow-500/10 px-3 py-1.5 rounded-lg border border-yellow-500/20 text-sm font-mono block w-full truncate">
                          http://localhost:1001/overlay.html
                        </code>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('http://localhost:1001/overlay.html');
                        setIsJarCopied(true);
                        setTimeout(() => setIsJarCopied(false), 2000);
                      }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-sm font-bold border border-white/10 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      {isJarCopied ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                    </button>
                  </div>

                  <div className="bg-black/40 rounded-xl border border-white/5 overflow-hidden aspect-video relative mb-6 flex flex-col">
                    <div className="absolute top-2 left-3 z-10 px-2 py-1 bg-black/60 rounded text-[10px] text-zinc-400 font-medium tracking-widest uppercase border border-white/10">Preview</div>
                    {jarSettings.isRunning ? (
                      <iframe 
                        src="http://localhost:1001/overlay.html" 
                        className="w-full h-full absolute inset-0 pointer-events-none"
                        style={{ border: 'none', background: 'transparent' }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-600 font-medium text-sm flex-col gap-2">
                        <span className="text-3xl opacity-50">🫙</span>
                        <span>กรุณาเปิดสวิตช์โหลของขวัญเพื่อดูพรีวิว</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-medium text-zinc-300">ขนาดโหล (ความกว้าง)</label>
                        <span className="text-yellow-400 font-bold">{jarSettings.jarSize}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={jarSettings.jarSize}
                        onChange={(e) => updateJarSetting('jarSize', parseInt(e.target.value))}
                        className="w-full accent-yellow-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-medium text-zinc-300">ขนาดของขวัญ (ตั้งต้น)</label>
                        <span className="text-yellow-400 font-bold">{jarSettings.giftSize}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={jarSettings.giftSize}
                        onChange={(e) => updateJarSetting('giftSize', parseInt(e.target.value))}
                        className="w-full accent-yellow-500"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10">
                    <label className="block text-sm font-medium text-zinc-300 mb-3">ทดสอบระบบโหลของขวัญ</label>
                    <div className="flex flex-wrap items-center gap-4">
                      <select
                        value={jarTestGiftId}
                        onChange={(e) => setJarTestGiftId(e.target.value)}
                        className="flex-1 min-w-[200px] bg-zinc-950 border border-zinc-800 text-white text-sm rounded-xl px-4 py-3 outline-none focus:border-yellow-500"
                      >
                        <option value="">-- เลือกของขวัญ --</option>
                        {tiktokGifts.map((g) => (
                          <option key={g.id} value={g.id}>{g.name} ({g.coin} เพชร)</option>
                        ))}
                      </select>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => testJarGift(1)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold border border-white/10">x1</button>
                        <button onClick={() => testJarGift(10)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold border border-white/10">x10</button>
                        <button onClick={() => testJarGift(100)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold border border-white/10">x100</button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10">
                    <button 
                      onClick={() => {
                        if (window.electron && window.electron.resetJar) {
                          window.electron.resetJar();
                        }
                      }}
                      className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-4 py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="text-xl">🗑️</span>
                      รีเซ็ตโหล (ล้างของขวัญทั้งหมด)
                    </button>
                  </div>

                </div>
              </div>
              
              <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-yellow-600"></div>
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">⏱️</span>
                    <div>
                      <h3 className="text-xl font-bold text-amber-400">นับเวลาถอยหลัง</h3>
                      <p className="text-sm text-zinc-400">ใช้กับระบบของขวัญได้ บวกลบเวลาได้</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const newState = !timerSettings.isRunning;
                      setTimerSettings(prev => ({ ...prev, isRunning: newState }));
                      if (window.electron && window.electron.toggleTimerServer) {
                        window.electron.toggleTimerServer(newState);
                      }
                    }}
                    className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors shrink-0 ${
                      timerSettings.isRunning ? 'bg-amber-500' : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        timerSettings.isRunning ? 'translate-x-9' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className={`space-y-6 transition-opacity duration-300 ${!timerSettings.isRunning ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3 w-full">
                      <span className="text-xl">🔗</span>
                      <div className="flex-1">
                        <p className="text-xs text-zinc-500 mb-1 font-medium">นำ URL นี้ไปใส่ใน Browser Source ของ OBS</p>
                        <code className="text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20 text-sm font-mono block w-full truncate">
                          http://localhost:1002/overlay.html
                        </code>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('http://localhost:1002/overlay.html');
                        setIsTimerCopied(true);
                        setTimeout(() => setIsTimerCopied(false), 2000);
                      }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-sm font-bold border border-white/10 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      {isTimerCopied ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                    </button>
                  </div>

                  <div className="bg-black/40 rounded-xl border border-white/5 overflow-hidden aspect-video relative flex flex-col">
                    <div className="absolute top-2 left-3 z-10 px-2 py-1 bg-black/60 rounded text-[10px] text-zinc-400 font-medium tracking-widest uppercase border border-white/10">Preview</div>
                    {timerSettings.isRunning ? (
                      <iframe 
                        src="http://localhost:1002/overlay.html" 
                        className="w-full h-full absolute inset-0 pointer-events-none"
                        style={{ border: 'none', background: 'transparent' }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-600 font-medium text-sm flex-col gap-2">
                        <span className="text-3xl opacity-50">⏱️</span>
                        <span>กรุณาเปิดสวิตช์เวลานับถอยหลังเพื่อดูพรีวิว</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-4 border-t border-white/10">
                    <label className="block text-sm font-medium text-zinc-300 mb-3">ตั้งค่าเวลา (เริ่มนับทันที)</label>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-500 mb-1">ชั่วโมง</label>
                        <input
                          type="number"
                          min="0"
                          value={timerSettings.hours}
                          onChange={(e) => {
                            const h = parseInt(e.target.value) || 0;
                            setTimerSettings(prev => ({ ...prev, hours: h }));
                            if (window.electron && window.electron.updateTimer) {
                              window.electron.updateTimer({ hours: h, minutes: timerSettings.minutes, seconds: timerSettings.seconds });
                            }
                          }}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-500/50"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-500 mb-1">นาที</label>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={timerSettings.minutes}
                          onChange={(e) => {
                            const m = parseInt(e.target.value) || 0;
                            setTimerSettings(prev => ({ ...prev, minutes: m }));
                            if (window.electron && window.electron.updateTimer) {
                              window.electron.updateTimer({ hours: timerSettings.hours, minutes: m, seconds: timerSettings.seconds });
                            }
                          }}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-500/50"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-zinc-500 mb-1">วินาที</label>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={timerSettings.seconds}
                          onChange={(e) => {
                            const s = parseInt(e.target.value) || 0;
                            setTimerSettings(prev => ({ ...prev, seconds: s }));
                            if (window.electron && window.electron.updateTimer) {
                              window.electron.updateTimer({ hours: timerSettings.hours, minutes: timerSettings.minutes, seconds: s });
                            }
                          }}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-500/50"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Likes Milestone Overlay Settings */}
              <div className="bg-zinc-900 border border-rose-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-amber-600"></div>
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">❤️</span>
                    <div>
                      <h3 className="text-xl font-bold text-rose-400 flex items-center gap-2">ยอดการกดใจ</h3>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const newState = !likesMilestoneSettings.isRunning;
                      setLikesMilestoneSettings(prev => ({ ...prev, isRunning: newState }));
                      if (window.electron && window.electron.toggleLikesMilestoneServer) {
                        window.electron.toggleLikesMilestoneServer(newState);
                      }
                    }}
                    className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors shrink-0 ${
                      likesMilestoneSettings.isRunning ? 'bg-rose-500' : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        likesMilestoneSettings.isRunning ? 'translate-x-9' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className={`space-y-6 transition-opacity duration-300 ${!likesMilestoneSettings.isRunning ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="bg-black/40 p-4 rounded-xl border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3 w-full">
                      <span className="text-xl">🔗</span>
                      <div className="flex-1">
                        <p className="text-xs text-zinc-500 mb-1 font-medium">นำ URL นี้ไปใส่ใน Browser Source ของ OBS</p>
                        <code className="text-rose-300 bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20 text-sm font-mono block w-full truncate">
                          http://localhost:1003/overlay.html
                        </code>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('http://localhost:1003/overlay.html');
                        setIsLikesMilestoneCopied(true);
                        setTimeout(() => setIsLikesMilestoneCopied(false), 2000);
                      }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-sm font-bold border border-white/10 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      {isLikesMilestoneCopied ? '✅ คัดลอกแล้ว' : '📋 คัดลอก'}
                    </button>
                  </div>

                  <div className="bg-black/40 rounded-xl border border-white/5 overflow-hidden aspect-video relative flex flex-col justify-center items-center">
                    <div className="absolute top-2 left-3 z-10 px-2 py-1 bg-black/60 rounded text-[10px] text-zinc-400 font-medium tracking-widest uppercase border border-white/10">Preview</div>
                    {likesMilestoneSettings.isRunning ? (
                      <div className="w-[150%] h-[150%] origin-center transform scale-[0.66]">
                        <iframe 
                          src={`http://localhost:1003/overlay.html?t=${Date.now()}`}
                          className="w-full h-full border-none bg-transparent"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center text-zinc-600 font-medium text-sm flex-col gap-2">
                        <span className="text-3xl opacity-50">❤️</span>
                        <span>กรุณาเปิดสวิตช์เป้ายอดใจสั่นๆเพื่อดูพรีวิว</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="pt-4 border-t border-white/10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">คำนำหน้าเป้าหมาย</label>
                        <input
                          type="text"
                          value={likesMilestoneSettings.prefixText}
                          onChange={(e) => {
                            const newSettings = { ...likesMilestoneSettings, prefixText: e.target.value };
                            setLikesMilestoneSettings(newSettings);
                            if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                          }}
                          placeholder="เช่น บอลไฟ"
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">คำต่อท้ายเป้าหมาย</label>
                        <input
                          type="text"
                          value={likesMilestoneSettings.suffixText}
                          onChange={(e) => {
                            const newSettings = { ...likesMilestoneSettings, suffixText: e.target.value };
                            setLikesMilestoneSettings(newSettings);
                            if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                          }}
                          placeholder="เช่น ❤️"
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">เป้าหมายเริ่มต้น</label>
                        <input
                          type="number"
                          value={likesMilestoneSettings.baseTarget}
                          onChange={(e) => {
                            const newSettings = { ...likesMilestoneSettings, baseTarget: parseInt(e.target.value) || 0 };
                            setLikesMilestoneSettings(newSettings);
                            if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                          }}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">เมื่อถึงเป้าบวกเพิ่มทีละ</label>
                        <input
                          type="number"
                          value={likesMilestoneSettings.increment}
                          onChange={(e) => {
                            const newSettings = { ...likesMilestoneSettings, increment: parseInt(e.target.value) || 0 };
                            setLikesMilestoneSettings(newSettings);
                            if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                          }}
                          className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">สีตัวหนังสือ</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={likesMilestoneSettings.textColor}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, textColor: e.target.value };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                            className="w-10 h-10 p-1 bg-black/50 border border-zinc-700/50 rounded-lg cursor-pointer"
                          />
                          <input
                            type="text"
                            value={likesMilestoneSettings.textColor}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, textColor: e.target.value };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                            className="flex-1 bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50 uppercase"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">สีขอบ (Stroke)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={likesMilestoneSettings.strokeColor}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, strokeColor: e.target.value };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                            className="w-10 h-10 p-1 bg-black/50 border border-zinc-700/50 rounded-lg cursor-pointer"
                          />
                          <input
                            type="text"
                            value={likesMilestoneSettings.strokeColor}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, strokeColor: e.target.value };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                            className="flex-1 bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50 uppercase"
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-xs font-medium text-zinc-300">ความหนาของขอบ</label>
                          <span className="text-xs text-rose-400 font-bold">{likesMilestoneSettings.strokeSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="20"
                          value={likesMilestoneSettings.strokeSize}
                          onChange={(e) => {
                            const newSettings = { ...likesMilestoneSettings, strokeSize: parseInt(e.target.value) || 0 };
                            setLikesMilestoneSettings(newSettings);
                            if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                          }}
                          className="w-full accent-rose-500"
                        />
                      </div>
                      <div>
                         <label className="block text-xs font-medium text-zinc-300 mb-1">ฟอนต์ตัวหนังสือ</label>
                         <select
                           value={likesMilestoneSettings.fontFamily || 'KOMIKAX'}
                           onChange={(e) => {
                             const newSettings = { ...likesMilestoneSettings, fontFamily: e.target.value };
                             setLikesMilestoneSettings(newSettings);
                             if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                           }}
                           className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                         >
                           <option value="KOMIKAX">KOMIKAX</option>
                           {availableFonts.map(f => (
                             <option key={f} value={f}>{f}</option>
                           ))}
                         </select>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-zinc-300 mb-2">แสดงข้อความตัวเลข</label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <div className={`w-10 h-5 rounded-full transition-colors relative ${likesMilestoneSettings.showText !== false ? 'bg-rose-500' : 'bg-zinc-700'}`}>
                            <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${likesMilestoneSettings.showText !== false ? 'translate-x-5' : ''}`} />
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={likesMilestoneSettings.showText !== false}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, showText: e.target.checked };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                          />
                        </label>
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-zinc-300 mb-2">แสดงหลอดความคืบหน้า</label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <div className={`w-10 h-5 rounded-full transition-colors relative ${likesMilestoneSettings.showProgressBar ? 'bg-rose-500' : 'bg-zinc-700'}`}>
                            <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${likesMilestoneSettings.showProgressBar ? 'translate-x-5' : ''}`} />
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={likesMilestoneSettings.showProgressBar}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, showProgressBar: e.target.checked };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {likesMilestoneSettings.showText !== false && likesMilestoneSettings.showProgressBar && (
                        <div>
                          <label className="block text-xs font-medium text-zinc-300 mb-1">ตำแหน่งข้อความ (Layout)</label>
                          <select
                            value={likesMilestoneSettings.layout || 'text-top'}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, layout: e.target.value };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                            className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                          >
                            <option value="text-top">ข้อความอยู่บนหลอด</option>
                            <option value="text-bottom">ข้อความอยู่ใต้หลอด</option>
                            <option value="text-inside">ข้อความทับในหลอด</option>
                          </select>
                        </div>
                      )}
                      
                      {likesMilestoneSettings.showProgressBar && (
                        <div>
                          <label className="block text-xs font-medium text-zinc-300 mb-1">รูปแบบหลอด (Template)</label>
                          <select
                            value={likesMilestoneSettings.progressTemplate || 'template1'}
                            onChange={(e) => {
                              const newSettings = { ...likesMilestoneSettings, progressTemplate: e.target.value };
                              setLikesMilestoneSettings(newSettings);
                              if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                            }}
                            className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-white outline-none focus:border-rose-500/50"
                          >
                            <option value="template1">1. คลาสสิก (เรียบหรู ขอบมน)</option>
                            <option value="template2">2. นีออน (เรืองแสงโดดเด่น)</option>
                            <option value="template3">3. ไล่สี (พาสเทลไล่ระดับ)</option>
                            <option value="template4">4. แบบช่อง (เกมสไตล์)</option>
                            <option value="template5">5. มินิมอล (เส้นบาง เฉียบคม)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row gap-4">
                    <button
                      onClick={() => setIsLikesMilestoneActionModalOpen(true)}
                      className="flex-1 py-3 rounded-xl font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 transition-all text-center flex items-center justify-center gap-2"
                    >
                      <span>⚙️</span> เลือกแอคชั่นเมื่อถึงเป้า
                    </button>
                    <button
                      onClick={() => {
                        if (window.electron?.testLikesMilestone) window.electron.testLikesMilestone();
                      }}
                      className="flex-1 py-3 rounded-xl font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all flex items-center justify-center gap-2"
                    >
                      <span>▶️</span> ทดสอบการขึ้นเป้าหมาย
                    </button>
                  </div>
                </div>
              </div>

              {/* Likes Milestone Action Modal */}
              {isLikesMilestoneActionModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[300] flex items-center justify-center p-4">
                  <div className="bg-zinc-900 border border-rose-500/30 rounded-2xl p-6 shadow-[0_0_50px_rgba(225,29,72,0.15)] max-w-lg w-full flex flex-col max-h-[80vh]">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-rose-400 flex items-center gap-2">
                        <span>⚙️</span> เลือกแอคชั่นเมื่อถึงเป้า
                      </h3>
                      <button
                        onClick={() => setIsLikesMilestoneActionModalOpen(false)}
                        className="text-zinc-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                      {!activeGiftPresetId ? (
                        <div className="text-center py-10 text-zinc-500">กรุณาเลือก Preset ของขวัญก่อน (ที่แท็บระบบเสียง)</div>
                      ) : (giftPresets.find(p => p.id === activeGiftPresetId)?.rules?.length > 0) ? (
                        giftPresets.find(p => p.id === activeGiftPresetId)?.rules.map((rule: any) => (
                          <label key={rule.id} className="flex items-center gap-3 p-4 bg-black/40 border border-white/5 rounded-xl cursor-pointer hover:bg-white/10 hover:border-rose-500/30 transition-colors group">
                            <input
                              type="checkbox"
                              checked={likesMilestoneSettings.activeRules?.includes(rule.id) || false}
                              onChange={(e) => {
                                let newRules = [...(likesMilestoneSettings.activeRules || [])];
                                if (e.target.checked) {
                                  if (!newRules.includes(rule.id)) newRules.push(rule.id);
                                } else {
                                  newRules = newRules.filter((id: string) => id !== rule.id);
                                }
                                const newSettings = { ...likesMilestoneSettings, activeRules: newRules };
                                setLikesMilestoneSettings(newSettings);
                                if (window.electron?.updateLikesMilestoneSettings) window.electron.updateLikesMilestoneSettings(newSettings);
                              }}
                              className="accent-rose-500 w-5 h-5 cursor-pointer"
                            />
                            <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">{rule.ruleName || 'ไม่ได้ตั้งชื่อ'}</span>
                          </label>
                        ))
                      ) : (
                        <div className="text-center py-10 text-zinc-500">ไม่มีแอคชั่นใน Preset นี้</div>
                      )}
                    </div>
                    
                    <div className="pt-6 mt-2 border-t border-white/5">
                      <button
                        onClick={() => setIsLikesMilestoneActionModalOpen(false)}
                        className="w-full py-3 rounded-xl font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-[0_0_15px_rgba(225,29,72,0.3)]"
                      >
                        เสร็จสิ้น
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'sound' && (
        <div className="animate-in fade-in zoom-in-95 duration-300 flex justify-center w-full px-4 relative">
          {isLocked && (
            <div className="absolute z-50 flex flex-col items-center justify-center pointer-events-auto top-32">
              <div className="bg-black/80 px-8 py-6 flex flex-col items-center justify-center border border-red-500/40 rounded-3xl shadow-[0_0_30px_rgba(239,68,68,0.3)] backdrop-blur-xl transform transition-transform hover:scale-105">
                <span className="text-5xl mb-3 drop-shadow-lg">🔒</span>
                <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 mb-1">ฟีเจอร์ถูกล็อก</h2>
                <p className="text-zinc-300 text-sm font-medium">ต้องได้รับสิทธิ์ TTV เพื่อใช้งานส่วนนี้</p>
              </div>
            </div>
          )}
          <div className={`w-full max-w-6xl ${isLocked ? 'pointer-events-none blur-[3px] opacity-50' : ''}`}>
            <header className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-4xl sm:text-5xl drop-shadow-[0_0_15px_rgba(245,158,11,0.3)]">🔊</span>
                <h1 className="text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 drop-shadow-[0_0_15px_rgba(245,158,11,0.3)] text-center sm:text-left">
                  ระบบเสียง
                </h1>
              </div>
            </header>

            <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-amber-600"></div>

              {/* Siri Chat Reader Card */}
              <div className="mb-6 bg-black/30 p-4 rounded-xl border border-yellow-500/30 space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/10 pb-4 gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🤖</span>
                    <div>
                      <h3 className="text-lg font-bold text-yellow-400">เปิดเสียงสิริ</h3>
                      <p className="text-xs text-zinc-400">อ่านออกเสียงข้อความจากแชท TikTok แบบอัตโนมัติ</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsSiriEnabled(!isSiriEnabled)}
                    className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors shrink-0 ${
                      isSiriEnabled ? 'bg-yellow-500' : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        isSiriEnabled ? 'translate-x-9' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className={`space-y-4 transition-opacity duration-300 ${!isSiriEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Fan Level Filter */}
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-zinc-300 mb-2">เลเวลใจส้ม</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="0"
                          value={siriMinFanLevel}
                          onChange={(e) => setSiriMinFanLevel(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-24 bg-black/50 border border-zinc-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-yellow-500 text-center"
                        />
                        <span className="text-sm text-zinc-400">
                          {siriMinFanLevel === 0 ? 'อ่านแชทของทุกคน' : `อ่านเฉพาะเลเวล ${siriMinFanLevel} ขึ้นไป`}
                        </span>
                      </div>
                    </div>

                    {/* Volume Slider */}
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-zinc-300 mb-2">เร่งเสียง/เบาเสียง ({siriVolume}%)</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={siriVolume}
                        onChange={(e) => setSiriVolume(Number(e.target.value))}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-yellow-500 mt-3"
                      />
                    </div>
                  </div>

                  {/* Test Section */}
                  <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg flex flex-col sm:flex-row gap-2 items-center">
                    <input
                      type="text"
                      value={siriTestText}
                      onChange={(e) => setSiriTestText(e.target.value)}
                      placeholder="พิมพ์ข้อความทดสอบ..."
                      className="flex-1 w-full bg-black/50 border border-zinc-700 rounded-lg px-3 py-2 text-white outline-none focus:border-yellow-500 text-sm"
                    />
                    <button
                      onClick={() => speakSiri(siriTestText, siriVolume)}
                      className="w-full sm:w-auto px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-black rounded-lg font-bold text-sm transition-colors whitespace-nowrap"
                    >
                      🔊 เทสเสียง
                    </button>
                  </div>
                </div>
              </div>

              {/* Preset Selection Dropdown */}
              <div className="mb-6 bg-black/30 p-4 rounded-xl border border-white/5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-amber-400 mb-2">จัดการ Preset (ซิงค์กับระบบของขวัญ)</label>
                  <div className="flex gap-2">
                    <select
                      value={activeGiftPresetId || ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        setActiveGiftPresetId(id || null);
                        updateGiftPresetsBackend(giftPresets, id || null);
                      }}
                      className="flex-1 bg-black/50 border border-amber-500/30 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-500/50"
                    >
                      <option value="">-- ไม่ได้เลือก --</option>
                      {giftPresets.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {activeGiftPresetId && (
                      <button
                        onClick={() => {
                          const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                          if (preset) {
                            setRenamePresetName(preset.name);
                            setShowRenamePresetModal(true);
                          }
                        }}
                        className="w-12 flex items-center justify-center rounded-xl bg-black/50 border border-zinc-700/50 hover:bg-white/5 transition-all text-lg shrink-0"
                        title="เปลี่ยนชื่อ"
                      >
                        ✏️
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex flex-col lg:flex-row gap-2">
                  <button
                    onClick={() => setShowNewPresetModal(true)}
                    className="flex-1 py-3 rounded-xl font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all whitespace-nowrap"
                  >
                    + สร้าง Preset ใหม่
                  </button>

                  {activeGiftPresetId && (
                    <div className="flex flex-1 gap-2">
                      <button
                        onClick={async () => {
                          if (window.electron && window.electron.exportGiftPreset) {
                            const preset = giftPresets.find(p => p.id === activeGiftPresetId);
                            await window.electron.exportGiftPreset(preset);
                          }
                        }}
                        className="flex-1 py-3 rounded-xl font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-all"
                      >
                        Export
                      </button>
                      <button
                        onClick={async () => { if (await Swal.fire({title: 'คุณแน่ใจหรือไม่ที่จะลบ Preset นี้?', icon: 'warning', showCancelButton: true, confirmButtonText: 'ใช่', cancelButtonText: 'ยกเลิก'}).then(r => r.isConfirmed)) {
                            const updated = giftPresets.filter(p => p.id !== activeGiftPresetId);
                            setGiftPresets(updated);
                            setActiveGiftPresetId(updated.length > 0 ? updated[0].id : null);
                            updateGiftPresetsBackend(updated, updated.length > 0 ? updated[0].id : null);
                          }
                        }}
                        className="flex-1 py-3 rounded-xl font-bold bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
                      >
                        ลบทิ้ง
                      </button>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (window.electron && window.electron.importGiftPreset) {
                        const imported = await window.electron.importGiftPreset();
                        if (imported && imported.id) {
                          imported.id = Date.now().toString() + "_import"; // Ensure unique ID
                          const updated = [...giftPresets, imported];
                          setGiftPresets(updated);
                          setActiveGiftPresetId(imported.id);
                          updateGiftPresetsBackend(updated, imported.id);
                        }
                      }
                    }}
                    className="flex-1 py-3 rounded-xl font-bold border border-zinc-700 hover:bg-zinc-800 text-zinc-400 transition-all"
                  >
                    Import
                  </button>
                </div>
              </div>

              {activeGiftPresetId && (
                <div className="mb-4">
                  <div className="bg-black/30 p-4 rounded-xl border border-white/5 mb-4">
                    <h4 className="text-sm font-bold text-amber-400 mb-3">โหมดการเล่นเสียง</h4>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer py-2 px-3 rounded-lg transition-all border text-sm font-bold ${giftSoundMode === 'queue' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'bg-black/50 border-white/5 text-zinc-400 hover:bg-white/5'}`}>
                        <input 
                            type="radio" name="giftSoundMode" className="hidden"
                            checked={giftSoundMode === 'queue'} 
                            onChange={() => handleGiftSoundModeChange('queue')}
                        />
                        เรียงคิว
                      </label>
                      <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer py-2 px-3 rounded-lg transition-all border text-sm font-bold ${giftSoundMode === 'overlap' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.2)]' : 'bg-black/50 border-white/5 text-zinc-400 hover:bg-white/5'}`}>
                        <input 
                            type="radio" name="giftSoundMode" className="hidden"
                            checked={giftSoundMode === 'overlap'} 
                            onChange={() => handleGiftSoundModeChange('overlap')}
                        />
                        เล่นซ้อนกัน
                      </label>
                      <label className={`flex-1 flex items-center justify-center gap-2 cursor-pointer py-2 px-3 rounded-lg transition-all border text-sm font-bold ${giftSoundMode === 'interrupt' ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)]' : 'bg-black/50 border-white/5 text-zinc-400 hover:bg-white/5'}`}>
                        <input 
                            type="radio" name="giftSoundMode" className="hidden"
                            checked={giftSoundMode === 'interrupt'} 
                            onChange={() => handleGiftSoundModeChange('interrupt')}
                        />
                        เล่นอันล่าสุด
                      </label>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const newRule = { id: Date.now().toString(), enabled: true, giftName: '', soundFile: null, volume: 100 };
                      const updatedPresets = giftPresets.map(p => {
                        if (p.id === activeGiftPresetId) {
                          return { ...p, soundRules: [newRule, ...(p.soundRules || [])] };
                        }
                        return p;
                      });
                      setGiftPresets(updatedPresets);
                      updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                    }}
                    className="w-full py-3 bg-amber-500/20 text-amber-400 rounded-xl hover:bg-amber-500/30 transition-colors border border-amber-500/30 font-bold flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                  >
                    + เพิ่มเสียง
                  </button>
                </div>
              )}
              
              <div className="space-y-4">
                {!activeGiftPresetId ? (
                  <div className="text-center py-10 text-zinc-500">
                    กรุณาเลือก Preset ก่อนเพื่อตั้งค่าระบบเสียง
                  </div>
                ) : (giftPresets.find(p => p.id === activeGiftPresetId)?.soundRules || []).length === 0 ? (
                  <div className="text-center py-10 text-zinc-500">
                    ยังไม่มีเงื่อนไขระบบเสียง กด "เพิ่มเสียง" เพื่อเริ่มต้น
                  </div>
                ) : (
                  (giftPresets.find(p => p.id === activeGiftPresetId)?.soundRules || []).map((rule: any, idx: number) => (
                    <div key={rule.id} className={`p-4 rounded-xl border flex flex-col xl:flex-row gap-4 items-center transition-colors ${rule.enabled ? 'bg-black/40 border-amber-500/20' : 'bg-black/20 border-white/5 opacity-60'}`}>
                      {/* Toggle */}
                      <label className="flex items-center gap-2 cursor-pointer shrink-0">
                        <div className={`w-12 h-6 rounded-full transition-colors relative ${rule.enabled ? 'bg-amber-500' : 'bg-zinc-700'}`}>
                          <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${rule.enabled ? 'translate-x-6' : ''}`} />
                        </div>
                        <input type="checkbox" className="hidden" checked={rule.enabled} onChange={(e) => {
                          const updatedPresets = giftPresets.map(p => {
                            if (p.id === activeGiftPresetId) {
                              const newSoundRules = [...(p.soundRules || [])];
                              newSoundRules[idx].enabled = e.target.checked;
                              return { ...p, soundRules: newSoundRules };
                            }
                            return p;
                          });
                          setGiftPresets(updatedPresets);
                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                        }} />
                      </label>

                      {/* Gift Icon */}
                      <div className="shrink-0 flex items-center justify-center bg-black/30 w-12 h-12 rounded-xl border border-white/5 shadow-inner">
                        {rule.giftName && tiktokGifts.find(g => g.name.toLowerCase() === rule.giftName.toLowerCase())?.image ? (
                          <img 
                            src={tiktokGifts.find(g => g.name.toLowerCase() === rule.giftName.toLowerCase())?.image} 
                            alt="gift" 
                            className="w-8 h-8 object-contain drop-shadow-md hover:scale-110 transition-transform" 
                          />
                        ) : (
                          <Gift className="w-6 h-6 text-zinc-500" />
                        )}
                      </div>

                      {/* Gift Selection */}
                      <div className="flex-1 w-full min-w-[200px]">
                        <button
                          onClick={() => {
                            setSelectingSoundRuleId(rule.id);
                            setIsGiftSelectorOpen(true);
                          }}
                          className="w-full h-12 bg-black/50 border border-zinc-700 rounded-lg px-4 flex items-center justify-between hover:bg-white/5 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            {rule.giftName ? (
                              <span className="text-white font-medium">
                                {rule.giftName === '__EVENT_FOLLOW__' ? '✨ ผู้ติดตาม (Follow)' : rule.giftName}
                              </span>
                            ) : (
                              <span className="text-zinc-500">เลือกของขวัญ...</span>
                            )}
                          </div>
                          <span className="text-zinc-500 group-hover:text-white transition-colors">▼</span>
                        </button>
                      </div>

                      {/* File Selection */}
                      <div className="flex-1 w-full flex items-center gap-2">
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          ref={fileInputRef}
                          onChange={handleSupabaseUpload}
                        />
                        <button
                          onClick={() => {
                            setSelectingLibraryRuleIdx(idx);
                            setIsSoundLibraryModalOpen(true);
                            fetchSoundLibrary();
                          }}
                          className={`h-12 px-4 rounded-lg flex items-center justify-center font-bold transition-colors whitespace-nowrap bg-amber-500/20 text-amber-400 hover:bg-amber-500/30`}
                        >
                          เพิ่มเสียงของขวัญ
                        </button>

                        <div className="flex-1 h-12 bg-black/50 border border-zinc-700 rounded-lg px-4 flex items-center justify-between min-w-0">
                          <span className={`truncate text-sm mr-2 block ${rule.soundFile ? 'text-white' : 'text-zinc-500'}`}>
                            {rule.soundFile ? '🔊 ' + getDisplayFileName(rule.soundFile) : 'ยังไม่มีไฟล์เสียง'}
                          </span>
                          <button
                            disabled={isUploadingSound}
                            onClick={() => {
                              setUploadingRuleIdx(idx);
                              if (fileInputRef.current) fileInputRef.current.click();
                            }}
                            className={`text-amber-400 transition-transform shrink-0 text-xl ${
                              isUploadingSound && uploadingRuleIdx === idx
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:scale-110'
                            }`}
                            title="อัปโหลดเสียงลงคลัง (Supabase)"
                          >
                            {isUploadingSound && uploadingRuleIdx === idx ? (
                              <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                            ) : (
                              '📂'
                            )}
                          </button>
                        </div>
                        
                        {/* Play Test Button */}
                        <button
                          onClick={() => {
                            if (rule.soundFile) {
                              const existingAudio = playingAudioRef.current[rule.id];
                              if (existingAudio && !existingAudio.paused) {
                                // Stop playing
                                existingAudio.pause();
                                existingAudio.currentTime = 0;
                                setPlayingState(prev => ({ ...prev, [rule.id]: false }));
                              } else {
                                // Start playing
                                if (existingAudio) {
                                  existingAudio.pause();
                                  existingAudio.currentTime = 0;
                                }
                                const audioSrc = rule.soundFile.startsWith('http') 
                                  ? rule.soundFile 
                                  : `http://localhost:9001/sounds/${rule.soundFile}`;
                                const audio = new Audio(audioSrc);
                                audio.volume = (rule.volume ?? 100) / 100;
                                audio.onended = () => {
                                  setPlayingState(prev => ({ ...prev, [rule.id]: false }));
                                };
                                playingAudioRef.current[rule.id] = audio;
                                audio.play().then(() => {
                                  setPlayingState(prev => ({ ...prev, [rule.id]: true }));
                                }).catch(e => Swal.fire('เกิดข้อผิดพลาด: ' + e.message));
                              }
                            } else {
                              Swal.fire('บันทึกการตั้งค่าสำเร็จ');
                            }
                          }}
                          className={`h-12 w-12 rounded-lg flex items-center justify-center transition-colors border ${playingState[rule.id] ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'}`}
                          title="ทดสอบเสียง"
                        >
                          {playingState[rule.id] ? (
                            <Square className="w-5 h-5 fill-amber-400 text-amber-400" />
                          ) : (
                            <Play className="w-5 h-5 fill-emerald-400" />
                          )}
                        </button>
                      </div>

                      {/* Volume Slider */}
                      <div className="w-full md:w-32 flex flex-col gap-1 shrink-0">
                        <div className="flex justify-between text-[10px] text-zinc-400 font-bold px-1">
                          <span>Volume</span>
                          <span>{rule.volume ?? 100}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="300"
                          value={rule.volume ?? 100}
                          onChange={(e) => {
                            const updatedPresets = giftPresets.map(p => {
                              if (p.id === activeGiftPresetId) {
                                const newSoundRules = [...(p.soundRules || [])];
                                newSoundRules[idx].volume = parseInt(e.target.value);
                                return { ...p, soundRules: newSoundRules };
                              }
                              return p;
                            });
                            setGiftPresets(updatedPresets);
                            // don't save to backend on every slide tick
                          }}
                          onMouseUp={() => updateGiftPresetsBackend(giftPresets, activeGiftPresetId)}
                          onTouchEnd={() => updateGiftPresetsBackend(giftPresets, activeGiftPresetId)}
                          className="w-full accent-amber-500"
                        />
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => {
                          const updatedPresets = giftPresets.map(p => {
                            if (p.id === activeGiftPresetId) {
                              const newSoundRules = (p.soundRules || []).filter((_: any, i: number) => i !== idx);
                              return { ...p, soundRules: newSoundRules };
                            }
                            return p;
                          });
                          setGiftPresets(updatedPresets);
                          updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                        }}
                        className="w-12 h-12 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-colors flex justify-center items-center shrink-0"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'admin' && (
        <div className="animate-in fade-in zoom-in-95 duration-300 flex justify-center w-full">
          <div className="w-full max-w-5xl">
            <header className="mb-12 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
              <div>
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-rose-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                  จัดการสิทธิ์การใช้งาน
                </h1>
                <p className="text-zinc-400 mt-2">ตรวจสอบและจัดการสิทธิ์ของผู้ใช้งานทั้งหมด</p>
              </div>
            </header>

            <div className="w-full">

              {isLoadingAdmin ? (
                <div className="flex justify-center items-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                </div>
              ) : (
                  <div className="flex flex-col gap-6">
                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row gap-4 mb-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="text"
                          placeholder="ค้นหา Discord, ID หรือ TikTok..."
                          value={adminSearchQuery}
                          onChange={(e) => setAdminSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm focus:border-red-500/50 outline-none transition-colors"
                        />
                      </div>
                      <select
                        value={adminFilterApp}
                        onChange={(e) => setAdminFilterApp(e.target.value)}
                        className="py-2.5 px-4 bg-black/40 border border-white/10 rounded-xl text-sm focus:border-red-500/50 outline-none transition-colors cursor-pointer min-w-[150px]"
                      >
                        <option value="all">ทั้งหมด</option>
                        <option value="minecraft">Minecraft</option>
                        <option value="roblox">Roblox</option>
                        <option value="other">เกมอื่นๆ</option>
                        <option value="counter">ระบบนับวิน</option>
                        <option value="gifts">ระบบของขวัญ</option>
                        <option value="sound">ระบบเสียง</option>
                        <option value="keyboard_sound">ระบบเสียงคีบอร์ด</option>
                      </select>
                      <select
                        value={adminFilterGroup}
                        onChange={(e) => setAdminFilterGroup(e.target.value)}
                        className="py-2.5 px-4 bg-black/40 border border-white/10 rounded-xl text-sm focus:border-red-500/50 outline-none transition-colors cursor-pointer min-w-[150px]"
                      >
                        <option value="all">ทุกกลุ่มสิทธิ์</option>
                        <option value="owner_admin">Owner & Admin</option>
                        <option value="lineup">TTV</option>
                        <option value="customize">Customize</option>
                        <option value="no_access">ผู้ใช้งานทั่วไป</option>
                      </select>
                    </div>

                    {/* Groups Layout */}
                    <div className="flex flex-col gap-6">
                      {/* Group 1: Owner & Admin */}
                      {(adminFilterGroup === 'all' || adminFilterGroup === 'owner_admin') && (
                      <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                        <h2 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2">
                          <span>👑</span> ผู้ดูแลระบบ (Owner & Admin) ({ownerAdminGroup.length})
                        </h2>
                        <div className="overflow-x-auto bg-black/20 rounded-xl border border-white/5">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10 text-zinc-500 text-xs uppercase bg-black/40">
                                <th className="py-3 px-4 font-medium">Discord</th>
                                <th className="py-3 px-4 font-medium">TikTok</th>
                                <th className="py-3 px-4 font-medium">สถานะ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ownerAdminGroup.map(u => (
                                <tr
                                  key={u.discord_id}
                                  className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-context-menu"
                                  onContextMenu={(e) => {
                                    // Owner row: only the owner can open it (to edit their own settings)
                                    if (u.discord_id !== '279905202277187584' || actualIsOwner) {
                                      e.preventDefault();
                                      setContextMenu({ userId: u.discord_id, x: e.clientX, y: e.clientY });
                                    }
                                  }}
                                >
                                  <td className="py-4 px-4">
                                    <div className="font-bold text-white flex items-center gap-2">
                                      {u.discord_username}
                                      {u.discord_id === '279905202277187584' ? (
                                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Owner</span>
                                      ) : (
                                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">Admin</span>
                                      )}
                                    </div>
                                    <div className="text-xs text-zinc-500">{u.discord_id}</div>
                                  </td>
                                  <td className="py-4 px-4 text-amber-400">@{u.tiktok_username || '-'}</td>
                                  <td className="py-4 px-4">
                                    <span className="text-xs text-zinc-400">สิทธิ์ทั้งหมด</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      )}

                      {/* Group 2: LINEUP */}
                      {(adminFilterGroup === 'all' || adminFilterGroup === 'lineup') && (
                      <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                        <h2 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2">
                          <span>🎮</span> ผู้ใช้งาน (TTV / TTV STAR) ({lineupGroup.length})
                        </h2>
                        <div className="overflow-x-auto bg-black/20 rounded-xl border border-white/5">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-white/10 text-zinc-500 text-xs uppercase bg-black/40">
                                <th className="py-3 px-4 font-medium">Discord</th>
                                <th className="py-3 px-4 font-medium">TikTok</th>
                                <th className="py-3 px-4 font-medium">สถานะสิทธิ์</th>
                                <th className="py-3 px-4 font-medium">รายละเอียดเกม</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lineupGroup.map(u => (
                                <tr
                                  key={u.discord_id}
                                  className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-context-menu"
                                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ userId: u.discord_id, x: e.clientX, y: e.clientY }); }}
                                >
                                  <td className="py-4 px-4">
                                    <div className="font-bold text-white">{u.discord_username}</div>
                                    <div className="text-xs text-zinc-500">{u.discord_id}</div>
                                  </td>
                                  <td className="py-4 px-4 text-amber-400">@{u.tiktok_username || '-'}</td>
                                  <td className="py-4 px-4">
                                    <TtvBadge role={u.role} />
                                  </td>
                                  <td className="py-4 px-4">
                                    <div className="flex flex-wrap gap-1.5 max-w-[250px]">
                                      {[
                                        { id: 'farm', name: 'Minecraft (ฟาร์ม)', isMinecraft: true },
                                        { id: 'snowball', name: 'Minecraft (Snowball)', isMinecraft: true },
                                        { id: 'havest', name: 'Minecraft (ปลูกข้าว)', isMinecraft: true },
                                        { id: 'parkour', name: 'Minecraft (ปากัว)', isMinecraft: true },
                                        { id: 'fishing_pig', name: 'Minecraft (ตกหมู)', isMinecraft: true },
                                        { id: 'diamond_classic', name: 'Minecraft (ขุดเพชร)', isMinecraft: true },
                                        { id: 'diamond_3x3x3', name: 'Minecraft (ขุดเพชร 3x3x3)', isMinecraft: true },
                                        { id: 'pizza_speed', name: 'Pizza Speed', isRoblox: true },
                                        { id: 'donkey_smash', name: 'Donkey Smash', isRoblox: true },
                                        { id: 'build_block', name: 'ต่อตึก', isRoblox: true },
                                        { id: 'line_up_jump', name: 'LINE UP JUMP', isRoblox: true }
                                      ].map(game => {
                                        let hasAccess = false;
                                        if (game.isRoblox) {
                                          const rg = u.permissions?.roblox_games || ['pizza_speed', 'donkey_smash', 'build_block', 'line_up_jump'];
                                          hasAccess = rg.includes(game.id) && (u.permissions?.games || ['minecraft', 'roblox', 'other']).includes('roblox');
                                        } else if (game.isMinecraft) {
                                          const mg = u.permissions?.minecraft_games || ['farm', 'snowball', 'havest', 'parkour', 'fishing_pig', 'diamond_classic', 'diamond_3x3x3'];
                                          hasAccess = mg.includes(game.id) && (u.permissions?.games || ['minecraft', 'roblox', 'other']).includes('minecraft');
                                        } else {
                                          const g = u.permissions?.games || ['minecraft', 'roblox', 'other'];
                                          hasAccess = g.includes(game.id);
                                        }

                                        if (!hasAccess) return null;

                                        const customExp = u.permissions?.custom_expirations?.[game.id];
                                        const globalExp = u.access_expires_at;

                                        let expText = '';
                                        let isExpired = false;
                                        const expSource = customExp !== undefined ? customExp : globalExp;

                                        if (expSource === null || (!customExp && ['ttv', 'ttv_star'].includes((u.role || '').toLowerCase()) && !globalExp)) {
                                          expText = 'ถาวร';
                                        } else {
                                          const d = new Date(expSource);
                                          const now = new Date();
                                          isExpired = d < now;
                                          const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                          if (days >= 36000) {
                                            expText = 'ถาวร';
                                          } else {
                                            expText = isExpired ? 'หมดอายุ' : `เหลือ ${days} วัน`;
                                          }
                                        }

                                        if (isExpired) return null;

                                        return (
                                          <span key={game.id} className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-[10px] rounded flex items-center gap-1">
                                            {game.name} ({expText})
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      )}

                  {/* Group 3: Customize */}
                  {(adminFilterGroup === 'all' || adminFilterGroup === 'customize') && (
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                    <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
                      <span>🛠️</span> ลูกค้า (Customize) ({customizeGroup.length})
                    </h2>
                    <div className="overflow-x-auto bg-black/20 rounded-xl border border-white/5">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/10 text-zinc-500 text-xs uppercase bg-black/40">
                            <th className="py-3 px-4 font-medium">Discord</th>
                            <th className="py-3 px-4 font-medium">TikTok</th>
                            <th className="py-3 px-4 font-medium">สถานะสิทธิ์</th>
                            <th className="py-3 px-4 font-medium">รายละเอียดเกม/สิทธิ์</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customizeGroup.map(u => (
                            <tr
                              key={u.discord_id}
                              className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-context-menu"
                              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ userId: u.discord_id, x: e.clientX, y: e.clientY }); }}
                            >
                              <td className="py-4 px-4">
                                <div className="font-bold text-white">{u.discord_username}</div>
                                <div className="text-xs text-zinc-500">{u.discord_id}</div>
                              </td>
                              <td className="py-4 px-4 text-amber-400">@{u.tiktok_username || '-'}</td>
                              <td className="py-4 px-4">
                                <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full font-medium">ลูกค้า</span>
                              </td>
                              <td className="py-4 px-4">
                                <div className="flex flex-wrap gap-1.5 max-w-[250px]">
                                  {[
                                    { id: 'counter', name: 'ระบบนับวิน', isApp: true },
                                    { id: 'gifts', name: 'ระบบของขวัญ', isApp: true },
                                    { id: 'sound', name: 'ระบบเสียง', isApp: true },
                                    { id: 'decoration', name: 'ระบบตกแต่ง', isApp: true },
                                    { id: 'farm', name: 'Minecraft (ฟาร์ม)', isMinecraft: true },
                                    { id: 'snowball', name: 'Minecraft (Snowball)', isMinecraft: true },
                                        { id: 'havest', name: 'Minecraft (ปลูกข้าว)', isMinecraft: true },
                                        { id: 'parkour', name: 'Minecraft (ปากัว)', isMinecraft: true },
                                        { id: 'fishing_pig', name: 'Minecraft (ตกหมู)', isMinecraft: true },
                                        { id: 'diamond_classic', name: 'Minecraft (ขุดเพชร)', isMinecraft: true },
                                        { id: 'diamond_3x3x3', name: 'Minecraft (ขุดเพชร 3x3x3)', isMinecraft: true, isNew: true },
                                    { id: 'pizza_speed', name: 'Pizza Speed', isRoblox: true },
                                    { id: 'donkey_smash', name: 'Donkey Smash', isRoblox: true },
                                    { id: 'build_block', name: 'ต่อตึก', isRoblox: true },
                                    { id: 'line_up_jump', name: 'LINE UP JUMP', isRoblox: true }
                                  ].map(item => {
                                    let hasAccess = false;
                                    if (item.isApp) {
                                      const defaultApps = ['ttv', 'ttv_star', 'admin', 'owner'].includes((u.role || '').toLowerCase()) ? ['counter', 'gifts', 'game', 'sound', 'decoration'] : ['counter', 'gifts', 'game', 'sound'];
                                      const apps = u.permissions?.apps || defaultApps;
                                      hasAccess = apps.includes(item.id);
                                    } else if (item.isRoblox) {
                                      const rg = u.permissions?.roblox_games || ['pizza_speed', 'donkey_smash', 'build_block', 'line_up_jump'];
                                      hasAccess = rg.includes(item.id) && (u.permissions?.games || ['minecraft', 'roblox', 'other']).includes('roblox');
                                    } else if (item.isMinecraft) {
                                      const mg = u.permissions?.minecraft_games || ['farm', 'snowball', 'havest', 'parkour', 'fishing_pig', 'diamond_classic', 'diamond_3x3x3'];
                                      hasAccess = mg.includes(item.id) && (u.permissions?.games || ['minecraft', 'roblox', 'other']).includes('minecraft');
                                    }

                                    if (!hasAccess) return null;

                                    const customExp = u.permissions?.custom_expirations?.[item.id];
                                    const globalExp = u.access_expires_at;

                                    let expText = '';
                                    let isExpired = false;
                                    const expSource = customExp !== undefined ? customExp : globalExp;

                                    if (expSource === null || (!customExp && ['ttv', 'ttv_star'].includes((u.role || '').toLowerCase()) && !globalExp)) {
                                      expText = 'ถาวร';
                                    } else {
                                      const d = new Date(expSource);
                                      const now = new Date();
                                      isExpired = d < now;
                                      const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                                      if (days >= 36000) {
                                        expText = 'ถาวร';
                                      } else {
                                        expText = isExpired ? 'หมดอายุ' : `เหลือ ${days} วัน`;
                                      }
                                    }

                                    if (isExpired) return null;

                                    return (
                                      <span key={item.id} className="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-[10px] rounded">
                                        {item.name} ({expText})
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  )}

                  {/* Group 4: No Access */}
                  {(adminFilterGroup === 'all' || adminFilterGroup === 'no_access') && (
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl">
                    <h2 className="text-lg font-bold text-zinc-500 mb-4 flex items-center gap-2">
                      <span>🔒</span> ผู้ใช้งาน (ทั่วไป) ({noAccessGroup.length})
                    </h2>
                    <div className="overflow-x-auto bg-black/20 rounded-xl border border-white/5">
                      <table className="w-full text-left border-collapse opacity-70 hover:opacity-100 transition-opacity">
                        <thead>
                          <tr className="border-b border-white/10 text-zinc-500 text-xs uppercase bg-black/40">
                            <th className="py-3 px-4 font-medium">Discord</th>
                            <th className="py-3 px-4 font-medium">TikTok</th>
                            <th className="py-3 px-4 font-medium">สถานะสิทธิ์</th>
                          </tr>
                        </thead>
                        <tbody>
                          {noAccessGroup.map(u => (
                            <tr
                              key={u.discord_id}
                              className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-context-menu"
                              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ userId: u.discord_id, x: e.clientX, y: e.clientY }); }}
                            >
                              <td className="py-4 px-4">
                                <div className="font-bold text-white">{u.discord_username}</div>
                                <div className="text-xs text-zinc-500">{u.discord_id}</div>
                              </td>
                              <td className="py-4 px-4 text-amber-400">@{u.tiktok_username || '-'}</td>
                              <td className="py-4 px-4">
                                <span className="px-2 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-full">ผู้ใช้งาน (ทั่วไป)</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  )}
              </div>

                  {/* Context Menu */}
                  {contextMenu && (() => {
                    const targetUser = adminUsers.find(u => u.discord_id === contextMenu.userId);
                    if (!targetUser) return null;

                    return (
                      <div
                        className="fixed z-[300] bg-zinc-900 border border-zinc-700 shadow-2xl rounded-xl w-48 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-2 border-b border-zinc-800 text-xs text-zinc-400 font-bold">
                          {targetUser.discord_username}
                        </div>

                        {(isOwner || isAdmin) && targetUser.discord_id !== '279905202277187584' && (
                          <div className="py-1 border-b border-zinc-800">
                            {targetUser.role === 'admin' ? (
                              <button
                                onClick={() => { updateUserRole(targetUser.discord_id, 'user'); setContextMenu(null); }}
                                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
                              >
                                ปลดแอดมิน
                              </button>
                            ) : (
                              <button
                                onClick={() => { updateUserRole(targetUser.discord_id, 'admin'); setContextMenu(null); }}
                                className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-amber-500/20 transition-colors"
                              >
                                ตั้งเป็นแอดมิน
                              </button>
                            )}

                            {['ttv', 'ttv_star'].includes((targetUser.role || '').toLowerCase()) ? (
                              <button
                                onClick={() => { updateUserRole(targetUser.discord_id, 'user'); setContextMenu(null); }}
                                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
                              >
                                ปลดยศ TTV
                              </button>
                            ) : targetUser.role !== 'admin' && (
                              <>
                                <button
                                  onClick={() => { updateUserRole(targetUser.discord_id, 'ttv'); setContextMenu(null); }}
                                  className="w-full text-left px-3 py-2 text-sm text-yellow-300 hover:bg-yellow-500/20 transition-colors"
                                >
                                  ตั้งเป็น TTV
                                </button>
                                <button
                                  onClick={() => { updateUserRole(targetUser.discord_id, 'ttv_star'); setContextMenu(null); }}
                                  className="w-full text-left px-3 py-2 text-sm text-yellow-300 hover:bg-yellow-500/20 transition-colors"
                                >
                                  ตั้งเป็น ★ TTV STAR
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {(targetUser.discord_id !== '279905202277187584' || actualIsOwner) && (
                          <div className="py-1">
                            <button
                              onClick={() => {
                                const defaultApps = ['ttv', 'ttv_star', 'admin', 'owner'].includes((targetUser.role || '').toLowerCase()) ? ['counter', 'gifts', 'game', 'sound', 'keyboard_sound', 'decoration'] : ['counter', 'gifts', 'game', 'sound', 'keyboard_sound'];
                                const apps = targetUser.permissions?.apps || defaultApps;
                                const games = targetUser.permissions?.games || ['minecraft', 'roblox', 'other'];
                                const roblox_games = targetUser.permissions?.roblox_games || ['pizza_speed', 'donkey_smash', 'build_block', 'line_up_jump'];
                                const minecraft_games = targetUser.permissions?.minecraft_games || ['farm', 'snowball', 'havest', 'parkour', 'fishing_pig', 'diamond_classic', 'diamond_3x3x3'];
                                const other_games = [...(targetUser.permissions?.other_games || ['block_pvp', 'spouge_bob'])];
                                if (['ttv', 'ttv_star', 'admin', 'owner'].includes(String(targetUser.role).toLowerCase()) && !other_games.includes('stick_war')) other_games.push('stick_war');
                                let duration = null;
                                if (targetUser.access_expires_at) {
                                  const diff = new Date(targetUser.access_expires_at).getTime() - new Date().getTime();
                                  duration = Math.ceil(diff / (1000 * 60 * 60 * 24));
                                  if (duration > 36000) duration = 36500;
                                } else if (['ttv', 'ttv_star'].includes((targetUser.role || '').toLowerCase())) {
                                  duration = 36500;
                                }
                                const custom_expirations = targetUser.permissions?.custom_expirations || {};
                                setPermissionModal({
                                  userId: targetUser.discord_id,
                                  duration: duration,
                                  apps,
                                  games,
                                  roblox_games,
                                  minecraft_games,
                                  other_games,
                                  custom_expirations
                                });
                                setContextMenu(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                            >
                              ⚙️ จัดการสิทธิ์แบบละเอียด
                            </button>
                            <button
                              onClick={async () => {
                                const { value: newTiktok } = await Swal.fire({
                                  title: 'แก้ไข TIKTOK',
                                  input: 'text',
                                  inputLabel: 'ชื่อ Tiktok',
                                  inputValue: targetUser.tiktok_username || '',
                                  showCancelButton: true,
                                  confirmButtonText: 'บันทึก',
                                  cancelButtonText: 'ยกเลิก'
                                });
                                if (newTiktok !== undefined) { // allow empty string to clear
                                  await fetch('/api/admin/users/update-tiktok', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ discord_id: targetUser.discord_id, tiktok_username: newTiktok })
                                  });
                                  fetchAdminUsers();
                                }
                                setContextMenu(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-amber-500/20 transition-colors"
                            >
                              🎵 แก้ไข TIKTOK
                            </button>
                            <button
                              onClick={async () => {
                                const res = await Swal.fire({
                                  title: 'Reset HWID',
                                  text: 'เมื่อรีเซ็ต ผู้ใช้นี้จะสามารถล็อกอินด้วยเครื่องใหม่ได้ (เครื่องเก่าจะเข้าไม่ได้อีก)',
                                  icon: 'warning',
                                  showCancelButton: true,
                                  confirmButtonText: 'รีเซ็ต',
                                  cancelButtonText: 'ยกเลิก'
                                });
                                if (res.isConfirmed) {
                                  await fetch('/api/admin/users/reset-hwid', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ discord_id: targetUser.discord_id, discord_username: targetUser.discord_username })
                                  });
                                  fetchAdminUsers();
                                  Swal.fire('สำเร็จ', 'รีเซ็ต HWID เรียบร้อยแล้ว', 'success');
                                }
                                setContextMenu(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-amber-500/20 transition-colors"
                            >
                              🔄 Reset HWID
                            </button>
                            {targetUser.discord_id !== '279905202277187584' && (
                            <button
                              onClick={async () => {
                                const res = await Swal.fire({
                                  title: 'ลบบัญชี',
                                  text: 'ต้องการลบบัญชีนี้ออกจากระบบใช่หรือไม่? (ไม่สามารถกู้คืนได้)',
                                  icon: 'error',
                                  showCancelButton: true,
                                  confirmButtonText: 'ลบเลย',
                                  cancelButtonText: 'ยกเลิก',
                                  confirmButtonColor: '#ef4444'
                                });
                                if (res.isConfirmed) {
                                  await fetch('/api/admin/users/delete', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ discord_id: targetUser.discord_id })
                                  });
                                  fetchAdminUsers();
                                  Swal.fire('สำเร็จ', 'ลบบัญชีเรียบร้อยแล้ว', 'success');
                                }
                                setContextMenu(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/20 transition-colors"
                            >
                              🗑️ ลบผู้ใช้งาน
                            </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Permission Modal */}
      {permissionModal && (() => {
        const targetUser = adminUsers.find(u => u.discord_id === permissionModal.userId);
        if (!targetUser) return null;

        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[400] backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-zinc-900 border border-yellow-500/30 rounded-3xl p-6 pb-4 w-full max-w-2xl shadow-[0_0_50px_rgba(250,204,21,0.15)] relative flex flex-col max-h-[95vh] overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-yellow-400 to-yellow-500"></div>

              <div className="flex justify-between items-center mb-6 shrink-0">
                <div>
                  <h3 className="font-bold text-xl text-white flex items-center gap-2">
                    <span>⚙️</span> จัดการสิทธิ์
                  </h3>
                  <p className="text-zinc-400 text-sm mt-1">ผู้ใช้: <span className="text-yellow-400 font-bold">{targetUser.discord_username}</span></p>
                </div>
                <button
                  onClick={() => setPermissionModal(null)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-6 overflow-y-auto custom-scrollbar flex-1 pr-4 -mr-4 pb-4">
                {/* Duration */}
                <div>
                  <label className="block text-sm font-bold text-zinc-300 mb-3">1. ระยะเวลาให้สิทธิ์</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: '3 วัน', value: 3 },
                      { label: '1 เดือน', value: 30 },
                      { label: 'ถาวร', value: 36500 },
                      { label: 'ลบสิทธิ์', value: null }
                    ].map(opt => (
                      <button
                        key={opt.label}
                        onClick={() => {
                          setPermissionModal(prev => {
                            if (!prev) return null;
                            if (opt.value === null) {
                              return {
                                ...prev,
                                duration: null,
                                apps: [],
                                games: [],
                                roblox_games: [],
                                minecraft_games: [],
                                other_games: [],
                                custom_expirations: {}
                              };
                            }
                            return { ...prev, duration: opt.value };
                          });
                        }}
                        className={`py-2 px-3 rounded-xl text-sm font-medium transition-all border ${permissionModal.duration === opt.value
                          ? opt.value === null ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 shadow-[0_0_10px_rgba(250,204,21,0.2)]'
                          : 'bg-black/30 text-zinc-400 border-white/5 hover:bg-white/5'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Apps */}
                <div className={permissionModal.duration === null ? 'opacity-50 pointer-events-none' : ''}>
                  <label className="block text-sm font-bold text-zinc-300 mb-3">2. โปรแกรมที่อนุญาตให้ใช้</label>
                  <div className="space-y-2">
                    {[
                      { id: 'counter', name: 'ระบบนับวิน', icon: '🎯' },
                      { id: 'gifts', name: 'ระบบของขวัญ', icon: '🎁' },
                      { id: 'game', name: 'ระบบเกม', icon: '🎮' },
                      { id: 'sound', name: 'ระบบเสียง', icon: '🔊' },
                      { id: 'keyboard_sound', name: 'ระบบเสียงคีบอร์ด', icon: '🎹' },
                      { id: 'decoration', name: 'ระบบตกแต่ง', icon: '✨' }
                    ].map(app => {
                      const isChecked = permissionModal.apps.includes(app.id);
                      return (
                        <div key={app.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${isChecked ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-black/30 border-white/5 hover:bg-white/5'}`}>
                          <label className="flex items-center gap-3 cursor-pointer flex-1">
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${isChecked ? 'bg-yellow-500 border-yellow-400' : 'bg-black/50 border-zinc-600'}`}>
                              {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                            </div>
                            <span className="text-zinc-300 font-medium">{app.icon} {app.name}</span>
                            <input
                              type="checkbox"
                              className="hidden"
                              checked={isChecked}
                              onChange={(e) => {
                                setPermissionModal(prev => {
                                  if (!prev) return null;
                                  const newApps = e.target.checked
                                    ? [...prev.apps, app.id]
                                    : prev.apps.filter(a => a !== app.id);
                                  return { ...prev, apps: newApps };
                                });
                              }}
                            />
                          </label>
                          {isChecked && (
                            <select
                              className="bg-black/50 border border-yellow-500/50 rounded-lg px-2 py-1 text-[10px] text-white outline-none cursor-pointer hover:bg-black/80"
                              value={permissionModal.custom_expirations[app.id] === undefined ? 'default' : permissionModal.custom_expirations[app.id] === null ? 'permanent' : 'custom'}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'custom') return;
                                setPermissionModal(prev => {
                                  if (!prev) return null;
                                  if (val === 'remove') {
                                    const newApps = prev.apps.filter(a => a !== app.id);
                                    const newExp = { ...prev.custom_expirations };
                                    delete newExp[app.id];
                                    return { ...prev, apps: newApps, custom_expirations: newExp };
                                  }
                                  const newExp = { ...prev.custom_expirations };
                                  if (val === 'default') delete newExp[app.id];
                                  else if (val === 'permanent') newExp[app.id] = null;
                                  else {
                                    const d = new Date();
                                    d.setDate(d.getDate() + parseInt(val));
                                    newExp[app.id] = d.toISOString();
                                  }
                                  return { ...prev, custom_expirations: newExp };
                                });
                              }}
                            >
                              <option value="default">ตามสิทธิ์</option>
                              <option value="permanent">ถาวร</option>
                              <option value="3">3 วัน</option>
                              <option value="15">15 วัน</option>
                              <option value="30">1 เดือน</option>
                              <option value="remove" className="text-red-400 font-bold">ลบสิทธิ์</option>
                              {permissionModal.custom_expirations[app.id] && permissionModal.custom_expirations[app.id] !== null && <option value="custom">ตั้งแล้ว</option>}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Games */}
                {permissionModal.apps.includes('game') && (
                  <div className={`pt-4 border-t border-white/5 animate-in slide-in-from-top-2 ${permissionModal.duration === null ? 'opacity-50 pointer-events-none' : ''}`}>
                    <label className="block text-sm font-bold text-zinc-300 mb-3">3. เกมที่เข้าถึงได้</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { id: 'minecraft', name: 'MINECRAFT' },
                        { id: 'roblox', name: 'ROBLOX' },
                        { id: 'other', name: 'เกมอื่นๆ' }
                      ].map(game => {
                        const isChecked = permissionModal.games.includes(game.id);
                        return (
                          <div key={game.id} className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all relative ${isChecked ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-black/30 border-white/5 hover:bg-white/5'}`}>
                            <label className="flex flex-col items-center gap-2 cursor-pointer w-full">
                              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${isChecked ? 'bg-emerald-500 border-emerald-400' : 'bg-black/50 border-zinc-600'}`}>
                                {isChecked && <CheckCircle2 className="w-3 h-3 text-white" />}
                              </div>
                              <span className="text-zinc-300 text-sm font-medium">{game.name}</span>
                              <input
                                type="checkbox"
                                className="hidden"
                                checked={isChecked}
                                onChange={(e) => {
                                  setPermissionModal(prev => {
                                    if (!prev) return null;
                                    const newGames = e.target.checked
                                      ? [...prev.games, game.id]
                                      : prev.games.filter(g => g !== game.id);
                                    return { ...prev, games: newGames };
                                  });
                                }}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>

                    {/* Minecraft Sub-games */}
                    {permissionModal.games.includes('minecraft') && (
                      <div className="mt-4 p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20 animate-in fade-in slide-in-from-top-2">
                        <label className="block text-xs font-bold text-emerald-300 mb-3 flex items-center gap-2">
                          <Gamepad2 className="w-4 h-4" /> เลือกเซิร์ฟเวอร์ Minecraft ที่อนุญาต
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            { id: 'farm', name: 'ขุดเพชรในฟาร์ม' },
                            { id: 'snowball', name: 'ต่อบล็อก Snowball' },
                            { id: 'havest', name: 'ปลูกข้าว' },
                            { id: 'parkour', name: 'Minecraft ปากัว' },
                            { id: 'fishing_pig', name: 'Minecraft ตกหมู' },
                            { id: 'diamond_classic', name: 'Minecraft ขุดเพชร' },
                            { id: 'diamond_3x3x3', name: 'Minecraft ขุดเพชร 3x3x3' }
                          ].map(mg => {
                            const isChecked = permissionModal.minecraft_games.includes(mg.id);
                            return (
                              <div key={mg.id} className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-all ${isChecked ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-black/30 border-white/5 hover:bg-white/5'}`}>
                                <label className="flex items-center gap-2 cursor-pointer flex-1">
                                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${isChecked ? 'bg-emerald-500 border-emerald-400' : 'bg-black/50 border-zinc-600'}`}>
                                    {isChecked && <CheckCircle2 className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-xs font-medium text-zinc-300 truncate">{mg.name}</span>
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      setPermissionModal(prev => {
                                        if (!prev) return null;
                                        const newMg = e.target.checked
                                          ? [...prev.minecraft_games, mg.id]
                                          : prev.minecraft_games.filter(g => g !== mg.id);
                                        return { ...prev, minecraft_games: newMg };
                                      });
                                    }}
                                  />
                                </label>
                                {isChecked && (
                                  <select
                                    className="ml-2 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[10px] text-zinc-300 outline-none cursor-pointer hover:bg-black/60"
                                    value={permissionModal.custom_expirations[mg.id] === undefined ? 'default' : permissionModal.custom_expirations[mg.id] === null ? 'permanent' : 'custom'}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'custom') return;
                                      setPermissionModal(prev => {
                                        if (!prev) return null;
                                        if (val === 'remove') {
                                          const newMg = prev.minecraft_games.filter(g => g !== mg.id);
                                          const newExp = { ...prev.custom_expirations };
                                          delete newExp[mg.id];
                                          return { ...prev, minecraft_games: newMg, custom_expirations: newExp };
                                        }
                                        const newExp = { ...prev.custom_expirations };
                                        if (val === 'default') delete newExp[mg.id];
                                        else if (val === 'permanent') newExp[mg.id] = null;
                                        else {
                                          const d = new Date();
                                          d.setDate(d.getDate() + parseInt(val));
                                          newExp[mg.id] = d.toISOString();
                                        }
                                        return { ...prev, custom_expirations: newExp };
                                      });
                                    }}
                                  >
                                    <option value="default">ตามสิทธิ์</option>
                                    <option value="permanent">ถาวร</option>
                                    <option value="3">3 วัน</option>
                                    <option value="15">15 วัน</option>
                                    <option value="30">1 เดือน</option>
                                    <option value="remove" className="text-red-400 font-bold">ลบสิทธิ์</option>
                                    {permissionModal.custom_expirations[mg.id] && permissionModal.custom_expirations[mg.id] !== null && <option value="custom">ตั้งเอง</option>}
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Roblox Sub-games */}
                    {permissionModal.games.includes('roblox') && (
                      <div className="mt-4 p-4 bg-yellow-500/5 rounded-xl border border-yellow-500/20 animate-in fade-in slide-in-from-top-2">
                        <label className="block text-xs font-bold text-yellow-300 mb-3 flex items-center gap-2">
                          <Gamepad2 className="w-4 h-4" /> เลือกเกม Roblox ที่อนุญาต
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {[
                            { id: 'pizza_speed', name: 'Pizza Speed' },
                            { id: 'donkey_smash', name: 'Donkey Smash' },
                            { id: 'build_block', name: 'ต่อตึก' },
                            { id: 'line_up_jump', name: 'LINE UP JUMP' }
                          ].map(rg => {
                            const isChecked = permissionModal.roblox_games.includes(rg.id);
                            return (
                              <div key={rg.id} className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-all ${isChecked ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-black/30 border-white/5 hover:bg-white/5'}`}>
                                <label className="flex items-center gap-2 cursor-pointer flex-1">
                                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${isChecked ? 'bg-yellow-500 border-yellow-400' : 'bg-black/50 border-zinc-600'}`}>
                                    {isChecked && <CheckCircle2 className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-xs font-medium text-zinc-300 truncate">{rg.name}</span>
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      setPermissionModal(prev => {
                                        if (!prev) return null;
                                        const newRg = e.target.checked
                                          ? [...prev.roblox_games, rg.id]
                                          : prev.roblox_games.filter(g => g !== rg.id);
                                        return { ...prev, roblox_games: newRg };
                                      });
                                    }}
                                  />
                                </label>
                                {isChecked && (
                                  <select
                                    className="bg-black/50 border border-yellow-500/50 rounded px-1 py-0.5 text-[10px] text-white outline-none cursor-pointer hover:bg-black/80"
                                    value={permissionModal.custom_expirations[rg.id] === undefined ? 'default' : permissionModal.custom_expirations[rg.id] === null ? 'permanent' : 'custom'}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'custom') return;
                                      setPermissionModal(prev => {
                                        if (!prev) return null;
                                        if (val === 'remove') {
                                          const newRg = prev.roblox_games.filter(g => g !== rg.id);
                                          const newExp = { ...prev.custom_expirations };
                                          delete newExp[rg.id];
                                          return { ...prev, roblox_games: newRg, custom_expirations: newExp };
                                        }
                                        const newExp = { ...prev.custom_expirations };
                                        if (val === 'default') delete newExp[rg.id];
                                        else if (val === 'permanent') newExp[rg.id] = null;
                                        else {
                                          const d = new Date();
                                          d.setDate(d.getDate() + parseInt(val));
                                          newExp[rg.id] = d.toISOString();
                                        }
                                        return { ...prev, custom_expirations: newExp };
                                      });
                                    }}
                                  >
                                    <option value="default">ตามสิทธิ์</option>
                                    <option value="permanent">ถาวร</option>
                                    <option value="3">3 วัน</option>
                                    <option value="15">15 วัน</option>
                                    <option value="30">1 เดือน</option>
                                    <option value="remove" className="text-red-400 font-bold">ลบสิทธิ์</option>
                                    {permissionModal.custom_expirations[rg.id] && permissionModal.custom_expirations[rg.id] !== null && <option value="custom">ตั้งแล้ว</option>}
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Other Sub-games */}
                    {permissionModal.games.includes('other') && (
                      <div className="mt-4 p-4 bg-amber-500/5 rounded-xl border border-amber-500/20 animate-in fade-in slide-in-from-top-2">
                        <label className="block text-xs font-bold text-amber-300 mb-3 flex items-center gap-2">
                          <Gamepad2 className="w-4 h-4" /> เลือกเกมอื่นๆ ที่อนุญาต
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {[
                            { id: 'block_pvp', name: 'Block Game' },
                            { id: 'pirate_wars', name: 'Pirate WARS' },
                            { id: 'spouge_bob', name: 'Spouge Bob LINEUP' },
                            { id: 'stick_war', name: 'Stick WAR' }
                          ].map(og => {
                            const automatic = og.id === 'stick_war' && ['ttv', 'ttv_star', 'admin', 'owner'].includes(String(adminUsers.find(u => u.discord_id === permissionModal.userId)?.role).toLowerCase());
                            const isChecked = automatic || permissionModal.other_games.includes(og.id);
                            return (
                              <div key={og.id} className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-all ${isChecked ? 'bg-amber-500/10 border-amber-500/30' : 'bg-black/30 border-white/5 hover:bg-white/5'}`}>
                                <label className="flex items-center gap-2 cursor-pointer flex-1">
                                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors shrink-0 ${isChecked ? 'bg-amber-500 border-amber-400' : 'bg-black/50 border-zinc-600'}`}>
                                    {isChecked && <CheckCircle2 className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-xs font-medium text-zinc-300 truncate">{og.name}{automatic ? ' · TTV อัตโนมัติ' : ''}</span>
                                  <input
                                    type="checkbox"
                                    className="hidden"
                                    checked={isChecked}
                                    disabled={automatic}
                                    onChange={(e) => {
                                      setPermissionModal(prev => {
                                        if (!prev) return null;
                                        const newOg = e.target.checked
                                          ? [...prev.other_games, og.id]
                                          : prev.other_games.filter(g => g !== og.id);
                                        return { ...prev, other_games: newOg };
                                      });
                                    }}
                                  />
                                </label>
                                {isChecked && !automatic && (
                                  <select
                                    className="bg-black/50 border border-amber-500/50 rounded px-1 py-0.5 text-[10px] text-white outline-none cursor-pointer hover:bg-black/80"
                                    value={permissionModal.custom_expirations[og.id] === undefined ? 'default' : permissionModal.custom_expirations[og.id] === null ? 'permanent' : 'custom'}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'custom') return;
                                      setPermissionModal(prev => {
                                        if (!prev) return null;
                                        if (val === 'remove') {
                                          const newOg = prev.other_games.filter(g => g !== og.id);
                                          const newExp = { ...prev.custom_expirations };
                                          delete newExp[og.id];
                                          return { ...prev, other_games: newOg, custom_expirations: newExp };
                                        }
                                        const newExp = { ...prev.custom_expirations };
                                        if (val === 'default') delete newExp[og.id];
                                        else if (val === 'permanent') newExp[og.id] = null;
                                        else {
                                          const d = new Date();
                                          d.setDate(d.getDate() + parseInt(val));
                                          newExp[og.id] = d.toISOString();
                                        }
                                        return { ...prev, custom_expirations: newExp };
                                      });
                                    }}
                                  >
                                    <option value="default">ตามสิทธิ์</option>
                                    <option value="permanent">ถาวร</option>
                                    <option value="3">3 วัน</option>
                                    <option value="15">15 วัน</option>
                                    <option value="30">1 เดือน</option>
                                    <option value="remove" className="text-red-400 font-bold">ลบสิทธิ์</option>
                                    {permissionModal.custom_expirations[og.id] && permissionModal.custom_expirations[og.id] !== null && <option value="custom">ตั้งแล้ว</option>}
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-white/5 flex gap-3 shrink-0">
                <button
                  onClick={() => setPermissionModal(null)}
                  className="flex-1 py-3 bg-zinc-800 text-white rounded-xl hover:bg-zinc-700 transition-colors font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => saveDetailedPermissions(
                    permissionModal.userId,
                    permissionModal.duration,
                    permissionModal.apps,
                    permissionModal.games,
                    permissionModal.roblox_games,
                    permissionModal.minecraft_games,
                    permissionModal.other_games,
                    permissionModal.custom_expirations
                  )}
                  className="flex-1 py-3 bg-gradient-to-r from-yellow-500 to-yellow-500 text-black rounded-xl hover:from-yellow-400 hover:to-yellow-400 transition-all shadow-[0_0_15px_rgba(250,204,21,0.3)] font-bold"
                >
                  บันทึกสิทธิ์
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Minecraft Settings Modal */}
      {isMinecraftModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 max-w-md w-full shadow-[0_0_50px_rgba(245,158,11,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400 to-amber-600"></div>
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl text-amber-400 flex items-center gap-2">
                Minecraft ServerTap
              </h3>
              <button
                onClick={() => setIsMinecraftModalOpen(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-zinc-400 text-sm mb-6">
              กำหนด IP และข้อมูลการเข้าถึง Minecraft mod/plugin ของคุณผ่าน ServerTap.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">IP</label>
                <input
                  type="text"
                  value={minecraftSettings.ip}
                  onChange={(e) => updateMinecraftSetting('ip', e.target.value)}
                  className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-white outline-none focus:border-amber-500/50 focus:bg-black transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Port</label>
                <input
                  type="number"
                  value={minecraftSettings.port}
                  onChange={(e) => updateMinecraftSetting('port', parseInt(e.target.value) || 4567)}
                  className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-white outline-none focus:border-amber-500/50 focus:bg-black transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Password</label>
                <input
                  type="password"
                  value={minecraftSettings.password}
                  onChange={(e) => updateMinecraftSetting('password', e.target.value)}
                  className="w-full bg-black/50 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-white outline-none focus:border-amber-500/50 focus:bg-black transition-all"
                />
              </div>
            </div>

            <div className="mt-8 flex justify-between items-center">
              <button
                onClick={testMinecraftConn}
                disabled={mcTestStatus === 'testing'}
                className="px-6 py-2.5 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors border border-zinc-700 flex items-center gap-2"
              >
                {mcTestStatus === 'testing' ? (
                  <span className="animate-pulse">กำลังทดสอบ...</span>
                ) : mcTestStatus === 'success' ? (
                  <span className="text-emerald-400">เชื่อมต่อสำเร็จ!</span>
                ) : mcTestStatus === 'error' ? (
                  <span className="text-red-400">เชื่อมต่อไม่สำเร็จ</span>
                ) : (
                  'Test Connection'
                )}
              </button>
              <button
                onClick={() => setIsMinecraftModalOpen(false)}
                className="px-6 py-2.5 bg-amber-600 text-black rounded-lg hover:bg-amber-500 transition-colors shadow-[0_0_15px_rgba(245,158,11,0.3)]"
              >
                บันทึกและปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Minecraft Server Startup Modal */}
      {isMcStartingModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-sm p-8 flex flex-col items-center text-center shadow-2xl relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/10 rounded-full blur-[40px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-green-500/10 rounded-full blur-[40px] pointer-events-none" />

            {mcStartupStatus === 'starting' ? (
              <>
                <div className="w-20 h-20 bg-yellow-500/10 rounded-2xl flex items-center justify-center mb-6 border border-yellow-500/20 relative">
                  <div className="absolute inset-0 rounded-2xl border-2 border-yellow-500/30 border-t-yellow-500 animate-spin" />
                  <Box className="w-10 h-10 text-yellow-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">เกมกำลังเปิด</h3>
                <p className="text-zinc-400 text-sm mb-4">กรุณารอสักครู่ ระบบกำลังรันเซิร์ฟเวอร์...</p>

                {/* Progress Bar */}
                <div className="w-full flex flex-col gap-2">
                  <div className="flex justify-between text-xs font-bold text-yellow-400">
                    <span>ความคืบหน้า</span>
                    <span>{mcStartupProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-yellow-500 transition-all duration-300 shadow-[0_0_10px_rgba(250,204,21,0.5)]"
                      style={{ width: `${mcStartupProgress}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate w-full text-left font-mono" title={mcServers[activeMcTab].logs.length > 0 ? mcServers[activeMcTab].logs[mcServers[activeMcTab].logs.length - 1] : ''}>
                    {mcServers[activeMcTab].logs.length > 0 ? mcServers[activeMcTab].logs[mcServers[activeMcTab].logs.length - 1] : 'กำลังเตรียมรันคำสั่ง...'}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                  <Play className="w-10 h-10 text-emerald-400 fill-current" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">สำเร็จ</h3>
                <p className="text-emerald-400 text-sm mb-6">เซิร์ฟเวอร์เปิดใช้งานเรียบร้อยแล้ว เข้าเล่นได้เลย!</p>
                <button
                  onClick={() => setIsMcStartingModalOpen(false)}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-colors border border-white/10"
                >
                  ปิดหน้าต่าง
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* Sound Library Modal */}
      {isSoundLibraryModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-amber-500/30 rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-[0_0_50px_rgba(245,158,11,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-500 to-amber-600"></div>
            
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center border border-amber-500/30">
                  <span className="text-xl">🎶</span>
                </div>
                <div>
                  <h3 className="font-bold text-xl text-white">คลังเสียงของขวัญ</h3>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 h-10 rounded-xl bg-yellow-500/20 text-yellow-400 font-bold text-sm hover:bg-yellow-500/30 transition-colors border border-yellow-500/30 cursor-pointer shadow-[0_0_15px_rgba(250,204,21,0.2)]">
                  {isUploadingSound ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
                  )}
                  <span className="hidden sm:inline">{isUploadingSound ? 'กำลังอัปโหลด...' : 'เพิ่มเสียง'}</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="audio/*"
                    disabled={isUploadingSound}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      if (file.size > 1 * 1024 * 1024) {
                        Swal.fire('ไฟล์มีขนาดเกิน 1 MB กรุณาเลือกไฟล์ที่เล็กกว่านี้ครับ');
                        e.target.value = '';
                        return;
                      }

                      setIsUploadingSound(true);
                      try {
                        const fileName = `${Date.now()}-${file.name}`;
                        const filePath = `${fileName}`;
                        const { error } = await supabase.storage.from('sounds').upload(filePath, file, { cacheControl: '3600', upsert: false });
                        if (error) throw error;
                        
                        Swal.fire({ icon: 'success', title: 'สำเร็จ', text: 'เพิ่มเสียงเข้าคลังแล้ว', timer: 1500, showConfirmButton: false });
                        
                        // Refetch library
                        try {
                          const { data, error: fetchError } = await supabase.storage.from('sounds').list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
                          if (!fetchError && data) {
                            const files = data.filter(f => f.name !== '.emptyFolderPlaceholder').map(f => {
                              const { data: publicUrlData } = supabase.storage.from('sounds').getPublicUrl(f.name);
                              return { name: f.name, url: publicUrlData.publicUrl, created_at: f.created_at };
                            });
                            setSoundLibraryFiles(files);
                          }
                        } catch (err) {
                          console.error("Refetch error", err);
                        }

                      } catch (err: any) {
                        console.error('Upload error:', err);
                        Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
                      } finally {
                        setIsUploadingSound(false);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
                <button
                  onClick={() => {
                    if (playingLibraryAudioRef.current) {
                      playingLibraryAudioRef.current.pause();
                      playingLibraryAudioRef.current.currentTime = 0;
                    }
                    setPlayingLibraryFileUrl(null);
                    setIsSoundLibraryModalOpen(false);
                  }}
                  className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-colors border border-white/10"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อเสียง..."
                  value={soundSearchQuery}
                  onChange={(e) => setSoundSearchQuery(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all"
                />
              </div>
              {isLoadingLibrary ? (
                <div className="flex flex-col items-center justify-center h-40 text-amber-500/70">
                  <Loader2 className="w-8 h-8 animate-spin mb-4" />
                  <p>กำลังโหลดคลังเสียง...</p>
                </div>
              ) : soundLibraryFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-500">
                  <span className="text-4xl mb-4">📭</span>
                  <p>ยังไม่มีไฟล์เสียงในคลัง อัปโหลดไฟล์แรกเลย!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {soundLibraryFiles.filter(file => getDisplayFileName(file.name).toLowerCase().includes(soundSearchQuery.toLowerCase())).map((file, i) => (
                    <div key={i} className="bg-black/40 border border-white/5 rounded-xl p-3 flex items-center justify-between hover:bg-white/5 transition-colors group">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center text-amber-400 shrink-0">
                          🎵
                        </div>
                        <div className="min-w-0 flex flex-col">
                          <span className="text-white text-sm truncate font-medium">{getDisplayFileName(file.name)}</span>
                          <span className="text-[10px] text-zinc-500">{new Date(file.created_at).toLocaleString('th-TH')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button
                          onClick={() => {
                            if (playingLibraryFileUrl === file.url) {
                              // Stop playing
                              if (playingLibraryAudioRef.current) {
                                playingLibraryAudioRef.current.pause();
                                playingLibraryAudioRef.current.currentTime = 0;
                              }
                              setPlayingLibraryFileUrl(null);
                            } else {
                              // Stop previous if any
                              if (playingLibraryAudioRef.current) {
                                playingLibraryAudioRef.current.pause();
                                playingLibraryAudioRef.current.currentTime = 0;
                              }
                              // Play new
                              const audio = new Audio(file.url);
                              playingLibraryAudioRef.current = audio;
                              setPlayingLibraryFileUrl(file.url);
                              audio.play().catch(e => {
                                console.error(e);
                                setPlayingLibraryFileUrl(null);
                              });
                              audio.onended = () => {
                                setPlayingLibraryFileUrl(null);
                              };
                            }
                          }}
                          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors border ${
                            playingLibraryFileUrl === file.url
                              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30'
                              : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                          }`}
                          title={playingLibraryFileUrl === file.url ? 'หยุดฟัง' : 'ทดลองฟัง'}
                        >
                          {playingLibraryFileUrl === file.url ? (
                            <Square className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            if (selectingLibraryRuleIdx !== null && activeGiftPresetId) {
                              const updatedPresets = giftPresets.map(p => {
                                if (p.id === activeGiftPresetId) {
                                  const newSoundRules = [...(p.soundRules || [])];
                                  newSoundRules[selectingLibraryRuleIdx].soundFile = file.url;
                                  return { ...p, soundRules: newSoundRules };
                                }
                                return p;
                              });
                              setGiftPresets(updatedPresets);
                              updateGiftPresetsBackend(updatedPresets, activeGiftPresetId);
                              setIsSoundLibraryModalOpen(false);
                            }
                          }}
                          className="px-4 h-10 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-sm hover:bg-amber-500/30 transition-colors border border-amber-500/30"
                        >
                          เลือกใช้
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
