"use client";
import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useTelemetry } from '../contexts/TelemetryContext';
import {
  Activity,
  Menu,
  X,
  BarChart2,
  Gauge,
  ArrowLeft,
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
    systemStatus,
  } = useTelemetry();

  const [time, setTime] = useState(() => new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selectedLoom = selectedMachineId !== 'GLOBAL' ? looms[selectedMachineId] : null;
  const isStopped = Boolean(selectedLoom && selectedLoom.state === 'STOPPED');
  const isSelectedOffline = Boolean(selectedLoom && selectedLoom.state === 'OFFLINE');

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
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-slate-300 hover:text-white p-1.5 rounded-lg active:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Quick Back to Matrix Pill on Mobile when inspecting a loom */}
          {selectedMachineId !== 'GLOBAL' && (
            <button
              type="button"
              onClick={() => setSelectedMachineId('GLOBAL')}
              className="flex md:hidden items-center gap-1 bg-blue-600/90 active:bg-blue-700 text-white text-[11px] font-semibold px-2 py-1 rounded-lg shadow-sm cursor-pointer"
            >
              <ArrowLeft size={13} />
              <span>Fleet</span>
            </button>
          )}

          {/* Logo & Brand Title */}
          <button
            type="button"
            onClick={() => {
              setSelectedMachineId('GLOBAL');
              router.push('/');
            }}
            className="flex items-center gap-2 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-lg"
          >
            <div className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center flex-shrink-0">
              <Image
                src="/logo.png"
                alt="Ali Haider Industries"
                width={36}
                height={36}
                priority
                className="h-full w-full object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <span className="font-bold text-xs sm:text-sm tracking-tight text-white leading-tight">
                  WEAVESYNC
                </span>
                <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700 hidden xs:inline">
                  SCADA
                </span>
              </div>
              <span className="text-[9px] font-medium text-slate-400 tracking-wider hidden sm:block">
                Ali Haider Industries
              </span>
            </div>
          </button>

          <div className="h-5 w-px bg-slate-700 hidden md:block" />

          {/* Desktop Nav Links */}
          <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setSelectedMachineId('GLOBAL');
                router.push('/');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                pathname === '/' && selectedMachineId === 'GLOBAL'
                  ? 'bg-slate-800 text-white border border-slate-700/80 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Activity
                size={14}
                className={
                  pathname === '/' && selectedMachineId === 'GLOBAL'
                    ? 'text-slate-200'
                    : 'text-slate-500'
                }
              />
              <span>Machine Matrix ({totalLooms})</span>
            </button>
            <button
              type="button"
              onClick={() => router.push('/analytics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                pathname === '/analytics'
                  ? 'bg-slate-800 text-white border border-slate-700/80 shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <BarChart2
                size={14}
                className={pathname === '/analytics' ? 'text-slate-200' : 'text-slate-500'}
              />
              <span>Shift Analytics &amp; OEE</span>
            </button>
          </nav>

          {/* Active Loom Badge (Desktop) */}
          {selectedMachineId !== 'GLOBAL' && selectedLoom && (
            <div className="hidden lg:flex items-center gap-2 bg-slate-800/90 border border-slate-700 px-2.5 py-1 rounded-lg">
              <span className="text-xs font-medium text-slate-200">
                Loom #{selectedLoom.loomNumber ?? '—'}{' '}
                <span className="font-mono text-slate-400">({selectedLoom.machineId})</span>
              </span>
              <button
                type="button"
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
            <span className="font-semibold text-white tabular-nums">
              {totalLooms > 0 ? currentRpm : '—'}
            </span>
            <span className="text-[10px] text-slate-400">RPM</span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
            <span
              className={`w-2 h-2 rounded-full ${
                totalLooms === 0 || isSelectedOffline
                  ? 'bg-slate-500'
                  : isStopped
                    ? 'bg-red-500'
                    : 'bg-emerald-500'
              }`}
            />
            <span className="text-[11px] font-medium text-slate-200">
              {totalLooms === 0
                ? '0 / 0 connected'
                : selectedLoom
                  ? isSelectedOffline
                    ? 'Offline'
                    : isStopped
                      ? selectedLoom.stopCategory || 'Stopped'
                      : 'Running'
                  : `${runningCount} / ${totalLooms} running`}
            </span>
          </div>
        </div>

        {/* Right: Truthful Connection Status Pill + Shift Clock */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-medium border ${
              systemStatus === 'CLOUD_LIVE'
                ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                : systemStatus === 'LOCAL_LAN'
                  ? 'bg-slate-800/90 border-slate-700 text-slate-300'
                  : systemStatus === 'CONNECTING'
                    ? 'bg-slate-800/90 border-slate-700 text-slate-300'
                    : 'bg-red-950/60 border-red-700/50 text-red-300'
            }`}
            title={
              systemStatus === 'CLOUD_LIVE'
                ? 'Connected to Supabase Cloud Realtime'
                : systemStatus === 'LOCAL_LAN'
                  ? 'Running locally via Local LAN Ingest Store'
                  : systemStatus === 'CONNECTING'
                    ? 'Connecting to Supabase Cloud telemetry'
                    : 'Backend Ingest Server Unreachable'
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                systemStatus === 'CLOUD_LIVE'
                  ? 'bg-emerald-400'
                  : systemStatus === 'LOCAL_LAN'
                    ? 'bg-slate-400'
                    : systemStatus === 'CONNECTING'
                      ? 'bg-amber-400'
                      : 'bg-red-500'
              }`}
            />
            <span className="font-mono">
              {systemStatus === 'CLOUD_LIVE'
                ? 'Cloud Live'
                : systemStatus === 'LOCAL_LAN'
                  ? 'Local LAN'
                  : systemStatus === 'CONNECTING'
                    ? 'Connecting'
                    : 'Disconnected'}
            </span>
          </div>

          {/* Shift Clock locked to Asia/Karachi */}
          <div className="flex flex-col items-end leading-tight font-mono text-slate-300 pl-1">
            <div
              className="text-[11px] sm:text-xs font-semibold tabular-nums text-white"
              suppressHydrationWarning
            >
              <span className="inline sm:hidden" suppressHydrationWarning>
                {karachiTimeShort.format(time)}
              </span>
              <span className="hidden sm:inline" suppressHydrationWarning>
                {karachiTimeFull.format(time)}
              </span>
            </div>
            <div
              className="text-[9px] text-slate-400 font-medium hidden sm:block"
              suppressHydrationWarning
            >
              {shiftKpis.shift.type === 'SHIFT_A' ? 'Shift A' : 'Shift B'}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Collapsible Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-x-0 top-14 z-40 bg-[#1e293b]/98 backdrop-blur-md border-b border-slate-700 shadow-xl px-4 py-4 space-y-3">
          {/* Quick Factory Stats Strip in Mobile Menu */}
          <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-800/90 border border-slate-700 text-center font-mono">
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">Active shift</span>
              <span className="text-xs font-semibold text-blue-400">
                {shiftKpis.shift.type === 'SHIFT_A' ? 'Shift A' : 'Shift B'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">Efficiency</span>
              <span className="text-xs font-semibold text-emerald-400 tabular-nums">
                {shiftKpis.averageEfficiency !== null
                  ? `${shiftKpis.averageEfficiency.toFixed(1)}%`
                  : '—'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-sans">Running</span>
              <span className="text-xs font-semibold text-slate-200 tabular-nums">
                {runningCount} / {totalLooms}
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setSelectedMachineId('GLOBAL');
                router.push('/');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-medium text-left transition-colors cursor-pointer ${
                pathname === '/' && selectedMachineId === 'GLOBAL'
                  ? 'bg-slate-800 text-white border border-slate-700/80 shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <Activity size={16} className="text-slate-400" />
              <span>Machine Matrix ({totalLooms})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                router.push('/analytics');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-medium text-left transition-colors cursor-pointer ${
                pathname === '/analytics'
                  ? 'bg-slate-800 text-white border border-slate-700/80 shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <BarChart2 size={16} className="text-slate-400" />
              <span>Shift Analytics &amp; OEE</span>
            </button>
            {selectedMachineId !== 'GLOBAL' && (
              <button
                type="button"
                onClick={() => {
                  setSelectedMachineId('GLOBAL');
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-300 bg-slate-800/60 border border-slate-700 text-left cursor-pointer"
              >
                <ArrowLeft size={15} />
                <span>Exit inspection (back to fleet)</span>
              </button>
            )}
          </div>

          {/* Connection Status Indicator */}
          <div className="pt-2 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-400 font-mono">
            <span className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  systemStatus === 'CLOUD_LIVE'
                    ? 'bg-emerald-400'
                    : systemStatus === 'LOCAL_LAN'
                      ? 'bg-blue-400'
                      : systemStatus === 'CONNECTING'
                        ? 'bg-amber-400'
                        : 'bg-red-500'
                }`}
              />
              <span
                className={
                  systemStatus === 'CLOUD_LIVE'
                    ? 'text-emerald-400 font-semibold'
                    : systemStatus === 'LOCAL_LAN'
                      ? 'text-blue-400 font-semibold'
                      : systemStatus === 'CONNECTING'
                        ? 'text-amber-400 font-semibold'
                        : 'text-red-400 font-semibold'
                }
              >
                {systemStatus === 'CLOUD_LIVE'
                  ? 'Cloud Live'
                  : systemStatus === 'LOCAL_LAN'
                    ? 'Local LAN'
                    : systemStatus === 'CONNECTING'
                      ? 'Connecting'
                      : 'Disconnected'}
              </span>
            </span>
            <span className="text-[10px] text-slate-500">SITE Area, Karachi</span>
          </div>
        </div>
      )}
    </>
  );
};
