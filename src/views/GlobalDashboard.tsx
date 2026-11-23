"use client";
import React from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { Wifi, WifiOff } from 'lucide-react';
import { KpiCard } from '../components/ui/KpiCard';
import { MachineMatrixGrid } from '../components/ui/MachineMatrixGrid';

export const GlobalDashboard: React.FC = () => {
  const { 
    looms, 
    shiftKpis,
    setSelectedMachineId, 
    configureLoom, 
    assignLongStopReason,
    systemStatus 
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
                <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight leading-tight">
                  Weaving Shed Floor
                </h1>
                <span className="text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700">
                  {shiftKpis.shift.name}
                </span>
              </div>
              <span className="text-[11px] sm:text-xs text-slate-500 block">
                Ali Haider Industries • SITE Area, Karachi {totalLooms > 0 ? `(${totalLooms} connected)` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Top 4 KPI Cards Row (2x2 on Mobile, 4x1 on MD+) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <KpiCard 
            title="Shift efficiency" 
            value={shiftKpis.averageEfficiency !== null ? `${shiftKpis.averageEfficiency.toFixed(1)}%` : '—'} 
            subtitle="Target: 92.0%"
            valueColor="text-slate-900"
          />
          <KpiCard 
            title="Active looms" 
            value={totalLooms > 0 ? `${shiftKpis.activeLoomsCount}` : '0'} 
            subtitle={totalLooms > 0 ? `${totalLooms} connected` : '0 connected'} 
            valueColor="text-slate-900"
          />
          <KpiCard 
            title="Active stoppages" 
            value={shiftKpis.stoppedLoomsCount} 
            subtitle={`${shiftKpis.cmpxAverage.toFixed(2)} CMPX (Stops/10⁵)`} 
            valueColor={shiftKpis.stoppedLoomsCount > 0 ? "text-red-600" : "text-slate-900"}
          />
          <KpiCard 
            title="Shift output" 
            value={totalLooms > 0 ? `${shiftKpis.totalMetresWoven.toFixed(1)} m` : '0.0 m'} 
            subtitle="Total meters woven"
            valueColor="text-slate-900"
          />
        </div>
      </div>

      {/* Loom Grid & Matrix Floor */}
      <div className="mt-1 sm:mt-2">
        <MachineMatrixGrid 
          looms={looms} 
          onSelectLoom={setSelectedMachineId} 
          onConfigureLoom={configureLoom}
          onAssignLongStopReason={assignLongStopReason}
        />
      </div>
    </div>
  );
};
