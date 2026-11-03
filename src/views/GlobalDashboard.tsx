"use client";
import React from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { Factory, Activity, Wifi, WifiOff } from 'lucide-react';
import { KpiCard } from '../components/ui/KpiCard';
import { MachineMatrixGrid } from '../components/ui/MachineMatrixGrid';

export const GlobalDashboard: React.FC = () => {
  const { 
    looms, 
    ambient, 
    shiftKpis,
    setSelectedMachineId, 
    addMachine, 
    assignLongStopReason,
    connectionStatus 
  } = useTelemetry();

  const totalLooms = Object.keys(looms).length;

  return (
    <div className="p-2.5 sm:p-5 h-[calc(100dvh-56px)] overflow-y-auto overscroll-y-contain bg-[#e8ebf0]">
      {/* Top Shift & Fleet Summary Block (Scrolls naturally on mobile, sticky on sm+) */}
      <div className="sm:sticky sm:top-0 z-20 sm:bg-[#e8ebf0]/95 sm:backdrop-blur-sm pb-3 sm:pb-4 pt-0.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 mb-2.5 sm:mb-3">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="h-9 w-9 sm:h-10 sm:w-10 p-1.5 rounded-xl bg-slate-900 flex items-center justify-center flex-shrink-0 shadow-sm">
              <img 
                src="/logo.png" 
                alt="Ali Haider Industries" 
                className="h-full w-full object-contain filter invert brightness-0" 
                style={{ filter: 'brightness(0) invert(1)' }} 
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight leading-tight">
                  Weaving Shed Floor
                </h1>
                <span className="text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  {shiftKpis.shift.name}
                </span>
              </div>
              <span className="text-[10px] sm:text-xs font-semibold text-slate-500 block">
                Ali Haider Industries • SITE Area, Karachi (36 Picanol Looms)
              </span>
            </div>
          </div>

          {/* Connection Status Badge */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-[11px] sm:text-xs font-mono font-bold ${
              connectionStatus === 'CONNECTED_REALTIME'
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-amber-100 text-amber-800 border border-amber-300'
            }`}>
              {connectionStatus === 'CONNECTED_REALTIME' ? (
                <>
                  <Wifi size={12} className="text-emerald-600 animate-pulse" />
                  <span>Realtime Supabase Bus</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} className="text-amber-600" />
                  <span>Section 10 Mock Bus</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Top Verified Section 11 KPI Cards Row (2x2 on Mobile, 4x1 on MD+) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard 
            title="Shift Efficiency" 
            value={`${shiftKpis.averageEfficiency.toFixed(1)}%`} 
            subtitle="Verified (Run / Elapsed)"
            valueColor="text-slate-900"
          />
          <KpiCard 
            title="Active Running" 
            value={shiftKpis.activeLoomsCount} 
            subtitle={`/ ${totalLooms} Looms Active`} 
            valueColor="text-emerald-600"
          />
          <KpiCard 
            title="Stoppages & CMPX" 
            value={shiftKpis.stoppedLoomsCount} 
            subtitle={`${shiftKpis.cmpxAverage.toFixed(2)} CMPX (Stops/10⁵)`} 
            valueColor={shiftKpis.stoppedLoomsCount > 0 ? "text-red-600" : "text-slate-700"}
          />
          
          {/* Ambient Air & Environment Pill Widget */}
          <div className="bg-[#1e293b] p-3 sm:p-4 rounded-xl shadow-sm flex flex-col justify-between text-slate-200 min-h-[95px] sm:min-h-[110px]">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              <span>Shed Climate</span>
              <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded ${
                ambient.mainAirPressureBar < 6.5 ? 'bg-red-900/80 text-red-300 animate-pulse' : 'bg-emerald-950 text-emerald-400'
              }`}>
                {ambient.mainAirPressureBar < 6.5 ? 'LOW AIR' : 'AIR OK'}
              </span>
            </div>
            
            <div className="grid grid-cols-3 gap-1 text-center font-mono mt-auto">
              <div className="bg-slate-800/80 p-1 rounded">
                <span className="block text-[8px] text-slate-400 uppercase font-sans">Temp</span>
                <span className="font-bold text-xs sm:text-sm text-slate-100 tabular-nums">
                  {ambient.hallTemperatureCelsius.toFixed(1)}°
                </span>
              </div>
              <div className="bg-slate-800/80 p-1 rounded">
                <span className="block text-[8px] text-slate-400 uppercase font-sans">RH</span>
                <span className="font-bold text-xs sm:text-sm text-blue-300 tabular-nums">
                  {ambient.hallHumidityPercentage.toFixed(0)}%
                </span>
              </div>
              <div className={`p-1 rounded ${ambient.mainAirPressureBar < 6.5 ? 'bg-red-950/80' : 'bg-slate-800/80'}`}>
                <span className="block text-[8px] text-slate-400 uppercase font-sans">Air</span>
                <span className={`font-bold text-xs sm:text-sm tabular-nums ${
                  ambient.mainAirPressureBar < 6.5 ? 'text-red-400' : 'text-emerald-300'
                }`}>
                  {ambient.mainAirPressureBar.toFixed(1)}b
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Loom Grid Header & Matrix */}
      <div className="mt-1 sm:mt-2">
        <MachineMatrixGrid 
          looms={looms} 
          onSelectLoom={setSelectedMachineId} 
          onAddMachine={addMachine}
          onAssignLongStopReason={assignLongStopReason}
        />
      </div>
    </div>
  );
};
