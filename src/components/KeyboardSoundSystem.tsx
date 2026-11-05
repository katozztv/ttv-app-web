import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Trash2, X, Keyboard as KeyboardIcon, Waves, StopCircle } from 'lucide-react';

interface KeyConfig {
    soundFile: string | null;
    volume: number;
}

interface KeyboardSoundSettings {
    mode: 'overlap' | 'interrupt' | 'interrupt_all' | 'toggle';
    keys: Record<string, KeyConfig>;
    enabled?: boolean;
}

// Full Keyboard Layout Definition
const KEYBOARD_LAYOUT = [
    // Function Row
    [
        { id: 'Escape', label: 'Esc', width: 'w-10' }, { id: 'spacer1', spacer: true, width: 'w-4' },
        { id: 'F1', label: 'F1' }, { id: 'F2', label: 'F2' }, { id: 'F3', label: 'F3' }, { id: 'F4', label: 'F4' }, { id: 'spacer2', spacer: true, width: 'w-2' },
        { id: 'F5', label: 'F5' }, { id: 'F6', label: 'F6' }, { id: 'F7', label: 'F7' }, { id: 'F8', label: 'F8' }, { id: 'spacer3', spacer: true, width: 'w-2' },
        { id: 'F9', label: 'F9' }, { id: 'F10', label: 'F10' }, { id: 'F11', label: 'F11' }, { id: 'F12', label: 'F12' }
    ],
    // Number Row
    [
        { id: '`', label: '`' }, { id: '1', label: '1' }, { id: '2', label: '2' }, { id: '3', label: '3' }, 
        { id: '4', label: '4' }, { id: '5', label: '5' }, { id: '6', label: '6' }, { id: '7', label: '7' }, 
        { id: '8', label: '8' }, { id: '9', label: '9' }, { id: '0', label: '0' }, { id: '-', label: '-' }, 
        { id: '=', label: '=' }, { id: 'Backspace', label: 'Backspace', width: 'w-20' }
    ],
    // QWERTY Row
    [
        { id: 'Tab', label: 'Tab', width: 'w-14' }, { id: 'Q', label: 'Q' }, { id: 'W', label: 'W' }, 
        { id: 'E', label: 'E' }, { id: 'R', label: 'R' }, { id: 'T', label: 'T' }, { id: 'Y', label: 'Y' }, 
        { id: 'U', label: 'U' }, { id: 'I', label: 'I' }, { id: 'O', label: 'O' }, { id: 'P', label: 'P' }, 
        { id: '[', label: '[' }, { id: ']', label: ']' }, { id: '\\', label: '\\', width: 'w-14' }
    ],
    // ASDF Row
    [
        { id: 'CapsLock', label: 'Caps', width: 'w-16' }, { id: 'A', label: 'A' }, { id: 'S', label: 'S' }, 
        { id: 'D', label: 'D' }, { id: 'F', label: 'F' }, { id: 'G', label: 'G' }, { id: 'H', label: 'H' }, 
        { id: 'J', label: 'J' }, { id: 'K', label: 'K' }, { id: 'L', label: 'L' }, { id: ';', label: ';' }, 
        { id: '\'', label: '\'' }, { id: 'Enter', label: 'Enter', width: 'w-20' }
    ],
    // ZXCV Row
    [
        { id: 'Shift', label: 'Shift', width: 'w-24' }, { id: 'Z', label: 'Z' }, { id: 'X', label: 'X' }, 
        { id: 'C', label: 'C' }, { id: 'V', label: 'V' }, { id: 'B', label: 'B' }, { id: 'N', label: 'N' }, 
        { id: 'M', label: 'M' }, { id: ',', label: ',' }, { id: '.', label: '.' }, { id: '/', label: '/' }, 
        { id: 'ShiftRight', label: 'Shift', width: 'w-24' }
    ],
    // Space Row
    [
        { id: 'Control', label: 'Ctrl', width: 'w-12' }, { id: 'Meta', label: 'Win', width: 'w-12' }, 
        { id: 'Alt', label: 'Alt', width: 'w-12' }, { id: 'Space', label: 'Space', width: 'w-[320px]' }, 
        { id: 'AltRight', label: 'Alt', width: 'w-12' }, { id: 'ControlRight', label: 'Ctrl', width: 'w-12' }
    ]
];

const NAVIGATION_LAYOUT = [
    [ { id: 'Insert', label: 'Ins' }, { id: 'Home', label: 'Home' }, { id: 'PageUp', label: 'PgUp' } ],
    [ { id: 'Delete', label: 'Del' }, { id: 'End', label: 'End' }, { id: 'PageDown', label: 'PgDn' } ],
    [ { id: 'spacer', spacer: true, height: 'h-10' } ], // Empty space above arrows
    [ { id: 'spacer', spacer: true }, { id: 'ArrowUp', label: '↑' }, { id: 'spacer', spacer: true } ],
    [ { id: 'ArrowLeft', label: '←' }, { id: 'ArrowDown', label: '↓' }, { id: 'ArrowRight', label: '→' } ]
];

const NUMPAD_LAYOUT = [
    { id: 'NumLock', label: 'Num' }, { id: 'numdiv', label: '/' }, { id: 'nummult', label: '*' }, { id: 'numsub', label: '-' },
    { id: 'num7', label: '7' }, { id: 'num8', label: '8' }, { id: 'num9', label: '9' }, { id: 'numadd', label: '+', height: 'h-[86px]', className: 'row-span-2' },
    { id: 'num4', label: '4' }, { id: 'num5', label: '5' }, { id: 'num6', label: '6' },
    { id: 'num1', label: '1' }, { id: 'num2', label: '2' }, { id: 'num3', label: '3' }, { id: 'numenter', label: 'Enter', height: 'h-[86px]', className: 'row-span-2' },
    { id: 'num0', label: '0', width: 'w-[86px]', className: 'col-span-2' }, { id: 'numdec', label: '.' }
];

export default function KeyboardSoundSystem() {
    const [settings, setSettings] = useState<KeyboardSoundSettings>({
        mode: 'overlap',
        keys: {}
    });
    const [soundDir, setSoundDir] = useState<string>('');
    const [isLoaded, setIsLoaded] = useState(false);
    
    const audioInstancesRef = useRef<Record<string, HTMLAudioElement>>({});
    const gainNodesRef = useRef<Record<string, any>>({});
    const audioCacheRef = useRef<Record<string, string>>({}); // filename -> base64 data URL
    const settingsRef = useRef(settings);
    const audioCtxRef = useRef<any>(null);
    const [activeVolumeKey, setActiveVolumeKey] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const keyboardWrapperRef = useRef<HTMLDivElement>(null);
    const [keyboardScale, setKeyboardScale] = useState(1);
    const [paddingLeft, setPaddingLeft] = useState(0);

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).electron && (window as any).electron.getKeyboardSoundSettings) {
            (window as any).electron.getKeyboardSoundSettings().then((res: any) => {
                if (res && res.settings) {
                    setSettings(res.settings);
                    setSoundDir(res.dir);
                }
                setIsLoaded(true);
            });
            
            (window as any).electron.onKeyboardSoundTriggered((key: string) => {
                playSound(key);
            });
        } else {
            setIsLoaded(true);
        }
    }, []);

    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current && keyboardWrapperRef.current) {
                const containerWidth = containerRef.current.clientWidth - 16; // account for some margin
                const keyboardWidth = keyboardWrapperRef.current.scrollWidth;
                if (keyboardWidth > 0 && containerWidth > 0) {
                    const scale = Math.min(1, containerWidth / keyboardWidth);
                    setKeyboardScale(scale);
                    
                    const scaledWidth = keyboardWidth * scale;
                    if (scaledWidth < containerWidth) {
                        setPaddingLeft((containerWidth - scaledWidth) / 2);
                    } else {
                        setPaddingLeft(0);
                    }
                }
            }
        };

        if (isLoaded && containerRef.current) {
            const observer = new ResizeObserver(() => handleResize());
            observer.observe(containerRef.current);
            handleResize();
            // Delay one more frame to ensure DOM is fully painted
            setTimeout(handleResize, 100);
            return () => observer.disconnect();
        }
    }, [isLoaded]);

    const updateSettings = (newSettings: KeyboardSoundSettings) => {
        setSettings(newSettings);
        if (typeof window !== 'undefined' && (window as any).electron && (window as any).electron.updateKeyboardSoundSettings) {
            (window as any).electron.updateKeyboardSoundSettings(newSettings);
        }
    };

    const handleDrop = async (e: React.DragEvent, keyId: string) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file) return;

        if (!file.type.startsWith('audio/') && !file.name.endsWith('.mp3') && !file.name.endsWith('.wav')) {
            alert('กรุณาลากไฟล์เสียงมาใส่เท่านั้น');
            return;
        }

        if (typeof window !== 'undefined' && (window as any).electron && (window as any).electron.saveKeyboardSound) {
            try {
                const ext = '.' + file.name.split('.').pop();
                const arrayBuffer = await file.arrayBuffer();
                const res = await (window as any).electron.saveKeyboardSound(keyId.toLowerCase(), arrayBuffer, ext);
                if (res.success) {
                    const newKeys = { ...settings.keys };
                    newKeys[keyId.toLowerCase()] = {
                        soundFile: res.fileName,
                        volume: newKeys[keyId.toLowerCase()]?.volume ?? 100
                    };
                    updateSettings({ ...settings, keys: newKeys });
                } else {
                    alert('เกิดข้อผิดพลาดในการเซฟไฟล์: ' + res.error);
                }
            } catch (err: any) {
                alert('เกิดข้อผิดพลาดในการอ่านไฟล์: ' + err.message);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleVolumeChange = (keyId: string, volume: number) => {
        const newKeys = { ...settings.keys };
        if (newKeys[keyId.toLowerCase()]) {
            newKeys[keyId.toLowerCase()].volume = volume;
            updateSettings({ ...settings, keys: newKeys });
            
            // Real-time update
            const lowerKey = keyId.toLowerCase();
            const audio = audioInstancesRef.current[lowerKey];
            if (audio) {
                audio.volume = Math.min(volume / 100, 1.0);
            }
            const gainNode = gainNodesRef.current[lowerKey];
            if (gainNode) {
                gainNode.gain.value = volume / 100;
            }
        }
    };

    const handleDelete = (keyId: string) => {
        const newKeys = { ...settings.keys };
        delete newKeys[keyId.toLowerCase()];
        updateSettings({ ...settings, keys: newKeys });
    };

    const playSound = async (keyId: string) => {
        const currentSettings = settingsRef.current;
        const config = currentSettings.keys[keyId.toLowerCase()];
        if (!config || !config.soundFile) return;

        // Fetch audio data if not cached
        if (!audioCacheRef.current[config.soundFile]) {
            if (typeof window !== 'undefined' && (window as any).electron && (window as any).electron.readKeyboardSound) {
                try {
                    const b64 = await (window as any).electron.readKeyboardSound(config.soundFile);
                    if (b64) {
                        const ext = config.soundFile.split('.').pop();
                        const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
                        audioCacheRef.current[config.soundFile] = `data:${mime};base64,${b64}`;
                    }
                } catch (e) {
                    console.error("Failed to read keyboard sound", e);
                }
            }
        }

        const dataUrl = audioCacheRef.current[config.soundFile];
        if (!dataUrl) return; // Cannot play if file data is missing
        
        const lowerKey = keyId.toLowerCase();

        if (currentSettings.mode === 'toggle') {
            const existingAudio = audioInstancesRef.current[lowerKey];
            if (existingAudio && !existingAudio.paused) {
                // If it's already playing in toggle mode, pause it and abort playing a new one
                existingAudio.pause();
                existingAudio.currentTime = 0;
                return;
            }
        }
        
        if (currentSettings.mode === 'interrupt' || currentSettings.mode === 'interrupt_all') {
            if (audioInstancesRef.current[lowerKey]) {
                audioInstancesRef.current[lowerKey].pause();
                audioInstancesRef.current[lowerKey].currentTime = 0;
            }
        }

        if (currentSettings.mode === 'interrupt_all') {
            Object.values(audioInstancesRef.current).forEach(audioInstance => {
                if (audioInstance && typeof audioInstance.pause === 'function') {
                    try {
                        audioInstance.pause();
                        audioInstance.currentTime = 0;
                    } catch(e) {}
                }
            });
        }

        const audio = new Audio(dataUrl);
        
        if (config.volume > 100) {
            try {
                if (!audioCtxRef.current) {
                    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                const ctx = audioCtxRef.current;
                const source = ctx.createMediaElementSource(audio);
                const gainNode = ctx.createGain();
                gainNode.gain.value = config.volume / 100;
                source.connect(gainNode);
                gainNode.connect(ctx.destination);
                gainNodesRef.current[keyId.toLowerCase()] = gainNode;
            } catch (e) {
                console.error("Web Audio API error", e);
                audio.volume = 1.0; // Fallback
            }
        } else {
            audio.volume = config.volume / 100;
            delete gainNodesRef.current[lowerKey];
        }
        
        // Track the audio instance for all modes so we can interrupt them later if mode is switched
        audioInstancesRef.current[lowerKey] = audio;
        
        audio.play().catch(e => console.error("Audio play error", e));
    };

    if (!isLoaded) {
        return <div className="text-white p-8 animate-pulse flex items-center gap-3"><KeyboardIcon className="w-6 h-6" /> กำลังโหลดระบบคีย์บอร์ด...</div>;
    }

    const renderKey = (keyDef: any) => {
        if (keyDef.spacer) {
            return <div key={Math.random()} className={`${keyDef.width || 'w-10'} ${keyDef.height || 'h-10'}`} />;
        }

        const lowerKey = keyDef.id.toLowerCase();
        const config = settings.keys[lowerKey];
        const hasSound = !!config;

        // Optimized UI styles: Removed backdrop-blur on individual keys to fix massive rendering lag
        const baseStyle = "relative group flex flex-col items-center justify-center border transition-all cursor-pointer rounded-lg hover:z-50";
        const noSoundStyle = "bg-white/[0.02] border-white/5 hover:bg-white/10 hover:border-white/20 text-zinc-400";
        const hasSoundStyle = "bg-yellow-500/15 border-yellow-500/30 hover:bg-yellow-500/25 hover:border-yellow-400/50 shadow-[0_0_10px_rgba(250,204,21,0.1)] text-yellow-300";

        return (
            <div 
                key={keyDef.id} 
                onDrop={(e) => handleDrop(e, keyDef.id)}
                onDragOver={handleDragOver}
                onClick={(e) => {
                    e.stopPropagation();
                    if (hasSound) {
                        setActiveVolumeKey(keyDef.id);
                    }
                }}
                className={`${baseStyle} ${hasSound ? hasSoundStyle : noSoundStyle} ${keyDef.width || 'w-10'} ${keyDef.height || 'h-10'} ${keyDef.className || ''}`}
            >
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-1">
                    <span className={`font-medium tracking-wider ${keyDef.label.length > 3 ? 'text-[9px]' : 'text-[11px]'}`}>
                        {keyDef.label}
                    </span>
                    {hasSound && (
                        <span className="text-[8px] text-yellow-300/60 mt-0.5 truncate w-full text-center px-1 font-light">
                            {config.soundFile?.split('_')[0].substring(0, 5)}
                        </span>
                    )}
                </div>
                
                {/* Delete Button */}
                {hasSound && (
                    <div className="absolute -top-2 -right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(keyDef.id); }}
                            className="p-1 bg-red-500/90 text-white rounded-full hover:bg-red-500 shadow-md border border-red-400/30"
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                )}

                {/* Volume Slider Popover */}
                {hasSound && activeVolumeKey === keyDef.id && (
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 z-[100] flex items-center justify-center pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-zinc-900 border border-yellow-500/30 px-3 py-2 rounded-xl flex items-center gap-2.5 shadow-xl min-w-[120px] relative">
                            <Volume2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <input 
                                type="range" min="0" max="300" value={config.volume}
                                onChange={(e) => handleVolumeChange(keyDef.id, parseInt(e.target.value))}
                                className="w-16 h-1.5 bg-zinc-700/50 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-yellow-400 [&::-webkit-slider-thumb]:rounded-full cursor-pointer"
                            />
                            <span className="text-[10px] font-medium text-yellow-300 min-w-[28px] text-right">{config.volume}%</span>
                            <button onClick={() => setActiveVolumeKey(null)} className="absolute -top-2 -right-2 bg-zinc-800 border border-white/10 rounded-full p-0.5 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors">
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6 p-2 sm:p-6 h-full text-white w-full max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-3xl shadow-xl">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black flex items-center gap-3 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-400">
                        ระบบเสียงคีบอร์ด <KeyboardIcon className="w-8 h-8 text-yellow-400" />
                    </h2>
                </div>
                
                <div className="bg-black/40 border border-white/10 rounded-2xl p-2 flex gap-2 overflow-x-auto custom-scrollbar">
                    <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl transition-all whitespace-nowrap ${settings.mode === 'overlap' ? 'bg-yellow-500/20 border border-yellow-500/50 text-yellow-300' : 'hover:bg-white/5 border border-transparent text-zinc-400'}`}>
                        <input 
                            type="radio" name="mode" className="hidden"
                            checked={settings.mode === 'overlap'} 
                            onChange={() => updateSettings({ ...settings, mode: 'overlap' })}
                        />
                        <Waves className="w-4 h-4" />
                        <span className="text-sm font-bold">เล่นซ้อนกัน</span>
                    </label>
                    <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl transition-all whitespace-nowrap ${settings.mode === 'interrupt' ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300' : 'hover:bg-white/5 border border-transparent text-zinc-400'}`}>
                        <input 
                            type="radio" name="mode" className="hidden"
                            checked={settings.mode === 'interrupt'} 
                            onChange={() => updateSettings({ ...settings, mode: 'interrupt' })}
                        />
                        <StopCircle className="w-4 h-4" />
                        <span className="text-sm font-bold">ตัดเสียงเดิม</span>
                    </label>
                    <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl transition-all whitespace-nowrap ${settings.mode === 'toggle' ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300' : 'hover:bg-white/5 border border-transparent text-zinc-400'}`}>
                        <input 
                            type="radio" name="mode" className="hidden"
                            checked={settings.mode === 'toggle'} 
                            onChange={() => updateSettings({ ...settings, mode: 'toggle' })}
                        />
                        <StopCircle className="w-4 h-4" />
                        <span className="text-sm font-bold">กดซ้ำตัดเสียง</span>
                    </label>
                    <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl transition-all whitespace-nowrap ${settings.mode === 'interrupt_all' ? 'bg-red-500/20 border border-red-500/50 text-red-300' : 'hover:bg-white/5 border border-transparent text-zinc-400'}`}>
                        <input 
                            type="radio" name="mode" className="hidden"
                            checked={settings.mode === 'interrupt_all'} 
                            onChange={() => updateSettings({ ...settings, mode: 'interrupt_all' })}
                        />
                        <VolumeX className="w-4 h-4" />
                        <span className="text-sm font-bold">ตัดเสียงทุกอย่าง</span>
                    </label>
                </div>
            </div>

            {/* Keyboard Layout */}
            <div 
                ref={containerRef}
                className="flex-1 w-full flex flex-col items-center justify-center relative" 
                onClick={() => setActiveVolumeKey(null)}
            >
                {/* Decorative background glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-yellow-500/10 rounded-full blur-[100px] pointer-events-none" />

                {/* Enabled Toggle Switch */}
                <div className="flex items-center gap-3 bg-black/40 p-3 rounded-2xl border border-white/10 shadow-xl relative z-20 mb-8 mt-4 backdrop-blur-md">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            updateSettings({ ...settings, enabled: settings.enabled === false ? true : false });
                        }}
                        className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-300 ease-in-out focus:outline-none ${settings.enabled !== false ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                    >
                        <span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-300 ease-in-out ${settings.enabled !== false ? 'translate-x-3' : '-translate-x-3'}`} />
                    </button>
                    <span className={`text-base font-bold tracking-wide ${settings.enabled !== false ? 'text-yellow-300' : 'text-zinc-500'}`}>
                        {settings.enabled !== false ? 'เปิดใช้งานระบบเสียง' : 'ปิดการทำงานชั่วคราว'}
                    </span>
                </div>

                <div className="w-full flex">
                    <div style={{ paddingLeft: `${paddingLeft}px` }} className="w-full">
                        <div 
                            ref={keyboardWrapperRef}
                            style={{ transform: `scale(${keyboardScale})`, transformOrigin: 'top left' }}
                            className="flex gap-4 sm:gap-8 relative z-10 min-w-max pb-8 md:pb-0"
                        >
                        {/* Main Keyboard */}
                        <div className="flex flex-col gap-1.5">
                            {KEYBOARD_LAYOUT.map((row, i) => (
                                <div key={i} className="flex gap-1.5">
                                    {row.map((keyDef: any) => renderKey(keyDef))}
                                </div>
                            ))}
                        </div>

                        {/* Navigation Cluster */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex flex-col gap-1.5">
                                {NAVIGATION_LAYOUT.slice(0,2).map((row, i) => (
                                    <div key={i} className="flex gap-1.5">
                                        {row.map((keyDef: any) => renderKey(keyDef))}
                                    </div>
                                ))}
                            </div>
                            <div className="flex flex-col gap-1.5 mt-8">
                                {NAVIGATION_LAYOUT.slice(3).map((row, i) => (
                                    <div key={i} className="flex gap-1.5 justify-center">
                                        {row.map((keyDef: any) => renderKey(keyDef))}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Numpad Cluster */}
                        <div>
                            <div className="grid grid-cols-4 grid-rows-5 gap-1.5 w-[178px]">
                                {NUMPAD_LAYOUT.map((keyDef: any) => renderKey(keyDef))}
                            </div>
                        </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

