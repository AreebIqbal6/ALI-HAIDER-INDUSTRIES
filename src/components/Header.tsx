"use client";
import React, { useState, useEffect } from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { 
  Activity, 
  Menu, 
  X, 
  BarChart2, 
  Gauge, 
  ArrowLeft, 
  Wifi, 
  Radio,
  Server
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';

const karachiTimeFull = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Karachi',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const karachiTimeShort = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Karachi',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

export const Header: React.FC = () => {
  const { 
    looms, 
    selectedMachineId, 
    setSelectedMachineId, 
    shiftKpis, 
    systemStatus 
  } = useTelemetry();

  const [time, setTime] = useState(new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedLoom = selectedMachineId !== 'GLOBAL' ? looms[selectedMachineId] : null;
  const isStopped = selectedLoom && selectedLoom.state === 'STOPPED';

  const runningCount = shiftKpis.activeLoomsCount;
  const totalLooms = Object.keys(looms).length;
  const currentRpm = selectedLoom ? selectedLoom.rpm : shiftKpis.averageRpm;

  return (
    <>
      <header className="bg-[#1e293b] text-slate-100 px-2.5 sm:px-4 border-b border-slate-700 shadow-md h-14 flex items-center justify-between select-none relative z-30">
        {/* Left: Branding & Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-3 h-full">
          {/* Mobile Menu Toggle Button */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-slate-300 hover:text-white p-1.5 rounded-lg active:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Quick Back to Matrix Pill on Mobile when inspecting a loom */}
          {selectedMachineId !== 'GLOBAL' && (
            <button
              onClick={() => setSelectedMachineId('GLOBAL')}
              className="flex md:hidden items-center gap-1 bg-blue-600/90 active:bg-blue-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg shadow-sm cursor-pointer"
            >
              <ArrowLeft size={13} />
              <span>Fleet</span>
            </button>
          )}

          {/* Logo & Brand Title */}
          <div 
            onClick={() => { setSelectedMachineId('GLOBAL'); router.push('/'); }}
            className="flex items-center gap-2 cursor-pointer"
          >
            <div className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center flex-shrink-0">
              <img 
                src="/logo.png" 
                alt="Ali Haider Industries" 
                className="h-full w-full object-contain filter invert brightness-0" 
                style={{ filter: 'brightness(0) invert(1)' }} 
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <span className="font-black text-xs sm:text-sm tracking-tight text-white leading-tight">
                  WEAVESYNC
                </span>
                <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-slate-800 text-blue-400 border border-slate-700 hidden xs:inline">
                  SCADA
                </span>
              </div>
              <span className="text-[9px] font-medium text-slate-400 tracking-wider hidden sm:block">
                Ali Haider Industries
              </span>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-700 hidden md:block" />

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            <button 
              onClick={() => { setSelectedMachineId('GLOBAL'); router.push('/'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                pathname === '/' && selectedMachineId === 'GLOBAL' 
                  ? 'bg-blue-600 text-white' 
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Activity size={15} /> Machine Matrix ({totalLooms})
            </button>
            <button 
              onClick={() => router.push('/analytics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                pathname === '/analytics' 
                  ? 'bg-blue-600 text-white' 
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <BarChart2 size={15} /> Shift Analytics &amp; OEE
            </button>
          </nav>

          {/* Active Loom Badge (Desktop) */}
          {selectedMachineId !== 'GLOBAL' && selectedLoom && (
            <div className="hidden lg:flex items-center gap-2 bg-slate-800/90 border border-slate-700 px-2.5 py-1 rounded-lg">
              <span className="text-xs font-bold text-blue-400">
                Loom #{selectedLoom.loomNumber ?? 1} ({selectedLoom.machineId})
              </span>
              <button 
                onClick={() => setSelectedMachineId('GLOBAL')}
                className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Exit
              </button>
            </div>
          )}
        </div>

        {/* Center: Live Floor Telemetry Pills */}
        <div className="hidden sm:flex items-center gap-2 md:gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
            <Gauge size={14} className="text-slate-400" />
            <span className="font-bold text-white tabular-nums">
              {totalLooms > 0 ? currentRpm : '—'}
            </span>
            <span className="text-[10px] text-slate-400">RPM</span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
            <span className={`w-2 h-2 rounded-full ${
              totalLooms === 0
                ? 'bg-slate-500'
                : isStopped
                ? 'bg-red-500 animate-pulse'
                : 'bg-emerald-500'
            }`} />
            <span className="text-[11px] font-bold text-slate-200">
              {totalLooms === 0
                ? '0 / 0 CONNECTED'
                : selectedLoom 
                ? (isStopped ? `${selectedLoom.stopCategory || 'STOPPED'}` : 'RUNNING') 
                : `${runningCount} / ${totalLooms} RUNNING`}
            </span>
          </div>
        </div>

        {/* Right: Truthful Connection Status Pill + Shift Clock */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Read-Only Truthful Connection Status Pill */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-bold border shadow-sm ${
            systemStatus === 'CLOUD_LIVE'
              ? 'bg-emerald-950/70 border-emerald-600/70 text-emerald-300'
              : systemStatus === 'LOCAL_LAN'
              ? 'bg-blue-950/70 border-blue-600/70 text-blue-300'
              : 'bg-red-950/70 border-red-600/70 text-red-300'
          }`}
          title={
            systemStatus === 'CLOUD_LIVE'
              ? 'Connected to Supabase Cloud Realtime'
              : systemStatus === 'LOCAL_LAN'
              ? 'Running locally via Local LAN Ingest Store'
              : 'Backend Ingest Server Unreachable'
          }>
            <span className={`w-1.5 h-1.5 rounded-full ${
              systemStatus === 'CLOUD_LIVE'
                ? 'bg-emerald-400 animate-pulse'
                : systemStatus === 'LOCAL_LAN'
                ? 'bg-blue-400'
                : 'bg-red-500 animate-pulse'
            }`} />
            <span className="font-mono">
              {systemStatus === 'CLOUD_LIVE'
                ? 'Cloud Live'
                : systemStatus === 'LOCAL_LAN'
                ? 'Local LAN'
                : 'Disconnected'}
            </span>
          </div>

          {/* Shift Clock locked to Asia/Karachi */}
          <div className="flex flex-col items-end leading-tight font-mono text-slate-300 pl-1">
            <div className="text-[11px] sm:text-xs font-bold tabular-nums text-white" suppressHydrationWarning>
              <span className="inline sm:hidden" suppressHydrationWarning>{karachiTimeShort.format(time)}</span>
              <span className="hidden sm:inline" suppressHydrationWarning>{karachiTimeFull.format(time)}</span>
            </div>
            <div className="text-[9px] text-blue-400 font-bold hidden sm:block" suppressHydrationWarning>
              {shiftKpis.shift.type === 'SHIFT_A' ? 'Shift A' : 'Shift B'}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Collapsible Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 top-14 z-40 bg-[#1e293b]/98 backdrop-blur-md border-b border-slate-700 shadow-xl px-4 py-4 space-y-3 animate-in slide-in-from-top-2 duration-150">
          {/* Quick Factory Stats Strip in Mobile Menu */}
          <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-center font-mono">
            <div>
              <span className="text-[9px] uppercase text-slate-400 block font-sans">Active Shift</span>
              <span className="text-xs font-bold text-blue-400">{shiftKpis.shift.type === 'SHIFT_A' ? 'Shift A' : 'Shift B'}</span>
            </div>
            <div>
              <span className="text-[9px] uppercase text-slate-400 block font-sans">Efficiency</span>
              <span className="text-xs font-bold text-emerald-400">
                {shiftKpis.averageEfficiency !== null ? `${shiftKpis.averageEfficiency.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div>
              <span className="text-[9px] uppercase text-slate-400 block font-sans">Running</span>
              <span className="text-xs font-bold text-slate-200">{runningCount} / {totalLooms}</span>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-1 pt-1">
            <button 
              onClick={() => { setSelectedMachineId('GLOBAL'); router.push('/'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-bold text-left transition-colors cursor-pointer ${
                pathname === '/' && selectedMachineId === 'GLOBAL' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Activity size={18} className="text-blue-400" />
              <span>Machine Matrix ({totalLooms})</span>
            </button>
            <button 
              onClick={() => { router.push('/analytics'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-bold text-left transition-colors cursor-pointer ${
                pathname === '/analytics' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              <BarChart2 size={18} className="text-emerald-400" />
              <span>Shift Analytics &amp; OEE</span>
            </button>
            {selectedMachineId !== 'GLOBAL' && (
              <button 
                onClick={() => { setSelectedMachineId('GLOBAL'); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-blue-400 bg-blue-950/40 border border-blue-800 text-left cursor-pointer"
              >
                <ArrowLeft size={16} />
                <span>Exit Inspection (Back to Fleet)</span>
              </button>
            )}
          </div>

          {/* Connection Status Indicator */}
          <div className="pt-2 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${
                systemStatus === 'CLOUD_LIVE' ? 'bg-emerald-400 animate-pulse' : systemStatus === 'LOCAL_LAN' ? 'bg-blue-400' : 'bg-red-500'
              }`} />
              <span className={systemStatus === 'CLOUD_LIVE' ? 'text-emerald-400 font-bold' : systemStatus === 'LOCAL_LAN' ? 'text-blue-400 font-bold' : 'text-red-400 font-bold'}>
                {systemStatus === 'CLOUD_LIVE' ? 'Cloud Live' : systemStatus === 'LOCAL_LAN' ? 'Local LAN' : 'Disconnected'}
              </span>
            </span>
            <span className="text-[10px] text-slate-500">SITE Area, Karachi</span>
          </div>
        </div>
      )}
    </>
  );
};
