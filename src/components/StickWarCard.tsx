'use client';

import { useEffect, useState } from 'react';
import { Download, Play, RefreshCw, Trash2, LockKeyhole, Loader2, Swords } from 'lucide-react';
import Swal from 'sweetalert2';

export default function StickWarCard({ allowed, progress }: { allowed:boolean; progress?:number }) {
  const [installed, setInstalled] = useState(false);
  const [localVersion, setLocalVersion] = useState('');
  const [release, setRelease] = useState<{ version:string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(false);
  const [checking, setChecking] = useState(true);
  async function refresh() {
    const api = window.electron;
    setSupported(Boolean(api?.getStickWarRelease && api?.startStickWar));
    if (!api?.getStickWarRelease) { setChecking(false); return; }
    setChecking(true);
    try {
      const status = await api.checkStandaloneGame('stick_war');
      setInstalled(typeof status === 'object' ? status.installed : status);
      setLocalVersion(typeof status === 'object' ? status.version || '' : '');
      setRelease(await api.getStickWarRelease()); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'ตรวจสอบเวอร์ชันไม่สำเร็จ'); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5 * 60000);
    return () => clearInterval(timer);
  }, []);
  const update = installed && release && localVersion.replace(/^v/, '') !== release.version.replace(/^v/, '');
  async function playOrInstall() {
    if (!allowed || busy) return;
    setError('');
    const api = window.electron;
    if (!api?.startStickWar || !api?.installStickWar) { setError('กรุณาใช้ TTV APP เวอร์ชันใหม่ที่รองรับ Stick WAR'); return; }
    setBusy(true);
    try {
      if (installed && !update) await api.startStickWar();
      else {
        setInstalling(true);
        if (!release) throw new Error('ยังตรวจสอบ Release ไม่สำเร็จ กรุณาลองใหม่');
        const folder = installed ? null : await api.chooseInstallFolder();
        if (!installed && !folder) return;
        const result = await api.installStickWar(folder);
        setInstalled(true); setLocalVersion(result.version);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'เปิดเกมไม่สำเร็จ'); }
    finally { setBusy(false); setInstalling(false); }
  }
  async function uninstall() {
    const result = await Swal.fire({ title:'ถอนการติดตั้ง Stick WAR?', text:'ถอนเฉพาะไฟล์เกม ข้อมูลผู้เล่นยังเก็บไว้',
      showCancelButton:true, confirmButtonText:'ถอนการติดตั้ง', cancelButtonText:'ยกเลิก', background:'#18181b', color:'#fff' });
    if (!result.isConfirmed) return;
    setBusy(true);
    try { await window.electron?.uninstallStandaloneGame('stick_war'); setInstalled(false); setLocalVersion(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'ถอนการติดตั้งไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  return <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:border-amber-500/50 transition-all flex flex-col items-center overflow-hidden relative">
    <div className="w-full aspect-square relative flex items-center justify-center bg-gradient-to-br from-amber-950 via-zinc-900 to-amber-950">
      <Swords className="w-24 h-24 text-amber-300 drop-shadow-lg" />
      <span className="absolute top-4 left-4 rounded-full bg-black/40 border border-amber-400/30 px-3 py-1 text-xs font-bold text-amber-200">2D / 3D</span>
      {installed && <button type="button" disabled={busy} onClick={uninstall} title="ถอนการติดตั้ง Stick WAR" className="absolute top-4 right-4 p-2 text-zinc-300 hover:text-red-400 bg-black/50 rounded-xl"><Trash2 className="w-5 h-5" /></button>}
    </div>
    <div className="p-6 flex flex-col items-center gap-3 w-full">
      <h3 className="font-bold text-xl text-white">Stick WAR</h3>
      <p className="text-xs text-zinc-400 text-center">สมาชิก TTV เล่นได้ทันที · ใช้ TikTok ตามบัญชี</p>
      {installed && <span className="text-xs text-zinc-500">ติดตั้งแล้ว {localVersion}</span>}
      {!allowed ? <div className="w-full py-3 bg-zinc-800 text-zinc-500 rounded-xl font-bold text-sm flex items-center justify-center gap-2"><LockKeyhole className="w-4 h-4" /> ต้องให้แอดมินเพิ่มสิทธิ์</div>
        : !supported ? <p className="text-sm text-amber-300 text-center">เปิดด้วย TTV APP เวอร์ชันใหม่เพื่อดาวน์โหลดและเล่น</p>
        : <button type="button" disabled={busy || (!installed && (!release || checking))} onClick={playOrInstall}
          className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 ${update ? 'bg-amber-500 hover:bg-amber-400' : installed ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-yellow-500 hover:bg-yellow-400'} text-black`}>
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" />{installing ? `กำลังติดตั้ง… ${progress ?? 0}%` : 'กำลังเปิดเกม…'}</>
            : update ? <><RefreshCw className="w-4 h-4" />อัปเดตเป็น {release?.version}</>
            : installed ? <><Play className="w-4 h-4" />เริ่มเกม</>
            : <><Download className="w-4 h-4" />{checking ? 'ตรวจสอบเวอร์ชัน…' : 'เลือกโฟลเดอร์ / ติดตั้ง'}</>}
        </button>}
      {error && <div role="alert" className="text-xs text-red-300 text-center break-words w-full">{error}<button type="button" disabled={busy} onClick={refresh} className="block mx-auto mt-2 text-zinc-300 underline">ตรวจสอบอีกครั้ง</button></div>}
    </div>
  </div>;
}
