"use client";
import React, { useState, useEffect, useRef } from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { 
  Activity, 
  Menu, 
  X, 
  BarChart2, 
  Gauge, 
  ArrowLeft, 
  Wifi, 
  Play, 
  AlertTriangle, 
  Sliders, 
  Cloud, 
  HardDrive, 
  Zap, 
  Radio
} from 'lucide-react';
import { format } from 'date-fns';
import { useRouter, usePathname } from 'next/navigation';

export const Header: React.FC = () => {
  const { 
    looms, 
    selectedMachineId, 
    setSelectedMachineId, 
    shiftKpis, 
    connectionStatus, 
    demoMode, 
    setDemoMode, 
    triggerSimulatedStop,
    triggerSimulatedFailedStart,
    triggerSimulatedLongStop,
    clearSimulatedStop 
  } = useTelemetry();

  const [time, setTime] = useState(new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pilotDrawerOpen, setPilotDrawerOpen] = useState(false);
  const [targetPilotLoom, setTargetPilotLoom] = useState<string>('PIC-427708');

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
                Loom #{selectedLoom.loomNumber} ({selectedLoom.machineId})
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
            <span className="font-bold text-white tabular-nums">{currentRpm}</span>
            <span className="text-[10px] text-slate-400">RPM</span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
            <span className={`w-2 h-2 rounded-full ${isStopped ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="text-[11px] font-bold text-slate-200">
              {selectedLoom 
                ? (isStopped ? `${selectedLoom.stopCategory || 'STOPPED'}` : 'RUNNING') 
                : `${runningCount} / ${totalLooms} RUNNING`}
            </span>
          </div>
        </div>

        {/* Right: Always-Visible Mode Toggle + Pilot Controls + Shift Clock */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          {/* 1. ALWAYS-VISIBLE MODE TOGGLE: CLOUD RT / LOCAL SIM */}
          <button
            onClick={() => setDemoMode(demoMode === 'CLOUD' ? 'LOCAL' : 'CLOUD')}
            className={`flex items-center gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all cursor-pointer border shadow-sm active:scale-95 ${
              demoMode === 'CLOUD'
                ? 'bg-blue-900/60 hover:bg-blue-800/80 text-blue-200 border-blue-500/60 ring-1 ring-blue-400/30'
                : 'bg-emerald-900/60 hover:bg-emerald-800/80 text-emerald-200 border-emerald-500/60 ring-1 ring-emerald-400/30'
            }`}
            title={`Current: ${demoMode === 'CLOUD' ? 'Cloud Realtime (Supabase)' : 'Local Sim / Edge Bus'}. Click to switch.`}
          >
            {demoMode === 'CLOUD' ? (
              <>
                <Cloud size={13} className="text-blue-400" />
                <span className="hidden xs:inline">CLOUD RT</span>
                <span className="xs:hidden">CLOUD</span>
              </>
            ) : (
              <>
                <HardDrive size={13} className="text-emerald-400" />
                <span className="hidden xs:inline">LOCAL SIM</span>
                <span className="xs:hidden">LOCAL</span>
              </>
            )}
            <span className={`w-1.5 h-1.5 rounded-full ${demoMode === 'CLOUD' ? 'bg-blue-400 animate-pulse' : 'bg-emerald-400'}`} />
          </button>

          {/* 2. PILOT CONTROLS BUTTON */}
          <button
            onClick={() => setPilotDrawerOpen(true)}
            className="flex items-center gap-1 sm:gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all cursor-pointer border shadow-sm active:scale-95 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50"
            title="Open Pilot Demo Controls (Warp, Weft, Failed Start, Long Stop)"
          >
            <Zap size={13} className="text-amber-400 fill-amber-400" />
            <span className="hidden sm:inline">Pilot Controls</span>
            <span className="sm:hidden">Pilot</span>
          </button>

          {/* Shift Clock */}
          <div className="flex flex-col items-end leading-tight font-mono text-slate-300 pl-1">
            <div className="text-[11px] sm:text-xs font-bold tabular-nums text-white">
              <span className="inline sm:hidden">{format(time, 'hh:mm a')}</span>
              <span className="hidden sm:inline">{format(time, 'hh:mm:ss a')}</span>
            </div>
            <div className="text-[9px] text-blue-400 font-bold hidden sm:block">
              {shiftKpis.shift.type === 'SHIFT_A' ? 'Shift A' : 'Shift B'}
            </div>
          </div>
        </div>
      </header>

      {/* Slide-Over Pilot Controls Drawer */}
      {pilotDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div 
            onClick={() => setPilotDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
          />

          {/* Drawer Panel */}
          <div className="relative w-full max-w-md bg-[#1e293b] border-l border-slate-700 shadow-2xl h-full flex flex-col z-10 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-900/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/20 border border-amber-500/40 rounded-xl text-amber-400">
                  <Sliders size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>Pilot Demo Controls</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      ON-DEMAND
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">Trigger simulated hardware faults for the CEO pitch</p>
                </div>
              </div>
              <button
                onClick={() => setPilotDrawerOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Target Machine Selection */}
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Target Loom:
                </label>
                <select
                  value={targetPilotLoom}
                  onChange={(e) => setTargetPilotLoom(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  {Object.values(looms).map(l => (
                    <option key={l.machineId} value={l.machineId}>
                      Loom #{l.loomNumber} ({l.machineId}) {l.machineId === 'PIC-427708' ? '★ HARDWARE PILOT' : ''} [{l.state}]
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500">
                  Default: Loom #1 (PIC-427708) — the physical WT32-ETH01 hardware node.
                </p>
              </div>

              {/* Stoppage Triggers */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Simulate Specific Stop Faults:
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {/* Warp Stop */}
                  <button
                    onClick={() => {
                      triggerSimulatedStop(targetPilotLoom, 'WARP');
                      setPilotDrawerOpen(false);
                    }}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-red-950/60 hover:bg-red-900/70 border border-red-700/80 text-red-200 transition-all cursor-pointer active:scale-95 group text-center"
                  >
                    <AlertTriangle size={18} className="text-red-400 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold">WARP BREAK</span>
                    <span className="text-[10px] text-red-300/70">Pin 8 (PI_WD) Drop-Wire</span>
                  </button>

                  {/* Filling Stop */}
                  <button
                    onClick={() => {
                      triggerSimulatedStop(targetPilotLoom, 'FILLING');
                      setPilotDrawerOpen(false);
                    }}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-orange-950/60 hover:bg-orange-900/70 border border-orange-700/80 text-orange-200 transition-all cursor-pointer active:scale-95 group text-center"
                  >
                    <AlertTriangle size={18} className="text-orange-400 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold">FILLING BREAK</span>
                    <span className="text-[10px] text-orange-300/70">Pin 10 (PI_FD) Optical</span>
                  </button>
                </div>

                {/* Failed Start */}
                <button
                  onClick={() => {
                    triggerSimulatedFailedStart(targetPilotLoom);
                    setPilotDrawerOpen(false);
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-purple-950/60 hover:bg-purple-900/70 border border-purple-700/80 text-purple-200 transition-all cursor-pointer active:scale-95 group"
                >
                  <div className="flex items-center gap-2.5">
                    <Radio size={18} className="text-purple-400 group-hover:rotate-45 transition-transform" />
                    <div className="text-left">
                      <div className="text-xs font-bold">FAILED START (&lt; 5 picks)</div>
                      <div className="text-[10px] text-purple-300/70">Restarts, weaves 3 picks, then aborts with restart fault</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-purple-900/80 px-2 py-1 rounded text-purple-200">
                    TEST
                  </span>
                </button>

                {/* >5m Long Stop */}
                <button
                  onClick={() => {
                    triggerSimulatedLongStop(targetPilotLoom);
                    setPilotDrawerOpen(false);
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-amber-950/70 hover:bg-amber-900/80 border border-amber-600 text-amber-200 transition-all cursor-pointer active:scale-95 group shadow-md"
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle size={18} className="text-amber-400 animate-pulse" />
                    <div className="text-left">
                      <div className="text-xs font-bold">LONG STOP (&gt; 5 min timer)</div>
                      <div className="text-[10px] text-amber-300/70">Sets downtime to 5.5m to test supervisor reason prompt</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-amber-900/90 px-2 py-1 rounded text-amber-200">
                    &gt; 5 MIN
                  </span>
                </button>
              </div>

              {/* Resume Running Action */}
              <div className="pt-2 border-t border-slate-700">
                <button
                  onClick={() => {
                    clearSimulatedStop(targetPilotLoom);
                    setPilotDrawerOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95"
                >
                  <Play size={16} />
                  <span>Resume RUNNING at Set RPM</span>
                </button>
              </div>

              {/* Data Bus Toggle */}
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Active Data Pipeline:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDemoMode('LOCAL')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      demoMode === 'LOCAL'
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <HardDrive size={14} />
                    <span>Edge Bus</span>
                  </button>
                  <button
                    onClick={() => setDemoMode('CLOUD')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      demoMode === 'CLOUD'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    <Cloud size={14} />
                    <span>Cloud Realtime</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
              <span className="text-xs font-bold text-emerald-400">{shiftKpis.averageEfficiency.toFixed(1)}%</span>
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
              <span>36-Machine Matrix Floor</span>
            </button>
            <button 
              onClick={() => { router.push('/analytics'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-bold text-left transition-colors cursor-pointer ${
                pathname === '/analytics' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-200 hover:bg-slate-800'
              }`}
            >
              <BarChart2 size={18} className="text-emerald-400" />
              <span>Verified Shift Analytics &amp; OEE</span>
            </button>
            <button
              onClick={() => { setPilotDrawerOpen(true); setMobileMenuOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-amber-400 bg-amber-950/40 border border-amber-800 text-left cursor-pointer"
            >
              <Zap size={16} />
              <span>Open Pilot Controls Deck</span>
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
              {connectionStatus === 'CONNECTED_REALTIME' ? (
                <>
                  <Wifi size={13} className="text-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-bold">Realtime Bus Active</span>
                </>
              ) : (
                <>
                  <Wifi size={13} className="text-blue-400" />
                  <span className="text-blue-400 font-bold">Edge Gateway Bus Active</span>
                </>
              )}
            </span>
            <span className="text-[10px] text-slate-500">SITE Area, Karachi</span>
          </div>
        </div>
      )}
    </>
  );
};
