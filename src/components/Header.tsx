"use client";
import React, { useState, useEffect } from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { 
  ArrowLeft, 
  BarChart3, 
  LayoutGrid, 
  Server
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from './ui/button';

const karachiTimeFull = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Karachi',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

export const Header: React.FC = () => {
  const { 
    systemStatus, 
    selectedMachineId, 
    setSelectedMachineId, 
    shiftKpis 
  } = useTelemetry();

  const [time, setTime] = useState<Date | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="bg-white text-zinc-950 px-4 sm:px-6 border-b border-zinc-200 h-14 flex items-center justify-between select-none relative z-30 shadow-2xs">
      {/* Left: Brand & Breadcrumb */}
      <div className="flex items-center gap-3">
        <div 
          onClick={() => { setSelectedMachineId('GLOBAL'); router.push('/'); }}
          className="flex items-center gap-2.5 cursor-pointer"
        >
          <div className="h-8 w-8 rounded-md bg-zinc-900 text-white flex items-center justify-center font-bold text-sm tracking-wider shadow-xs">
            WS
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight text-zinc-950 leading-tight">
              WeaveSync SCADA
            </span>
            <span className="text-[10px] text-zinc-500 font-medium">
              Ali Haider Industries
            </span>
          </div>
        </div>

        {selectedMachineId !== 'GLOBAL' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMachineId('GLOBAL')}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-950 ml-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Return to Fleet</span>
          </Button>
        )}
      </div>

      {/* Center: Clean Nav Links */}
      <nav className="flex items-center gap-1">
        <Link
          href="/"
          onClick={() => setSelectedMachineId('GLOBAL')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
            pathname === '/' && selectedMachineId === 'GLOBAL'
              ? 'bg-zinc-100 text-zinc-950 font-semibold'
              : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>Floor Overview</span>
        </Link>
        <Link
          href="/analytics"
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
            pathname === '/analytics'
              ? 'bg-zinc-100 text-zinc-950 font-semibold'
              : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-50'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          <span>Shift Analytics</span>
        </Link>
      </nav>

      {/* Right: Truthful System Status & Clock */}
      <div className="flex items-center gap-3">
        {/* Read-Only System Status Pill */}
        {systemStatus === 'CLOUD_LIVE' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline">Cloud Live</span>
          </span>
        )}
        {systemStatus === 'LOCAL_LAN' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-800 border border-sky-200">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            <span className="hidden sm:inline">Local LAN Mode</span>
          </span>
        )}
        {systemStatus === 'DISCONNECTED' && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="hidden sm:inline">Disconnected</span>
          </span>
        )}

        {/* Karachi PKT Clock */}
        <div className="hidden md:flex flex-col text-right">
          <span 
            suppressHydrationWarning 
            className="text-xs font-mono font-semibold text-zinc-900 tabular-nums"
          >
            {time ? karachiTimeFull.format(time) : '--:--:-- --'} PKT
          </span>
          <span className="text-[10px] text-zinc-500">
            {shiftKpis.shift.name}
          </span>
        </div>
      </div>
    </header>
  );
};
