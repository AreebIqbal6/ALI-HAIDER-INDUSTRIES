"use client";
import React from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { KpiCard } from '../components/ui/KpiCard';
import { MachineMatrixGrid } from '../components/ui/MachineMatrixGrid';
import { Badge } from '../components/ui/badge';

export const GlobalDashboard: React.FC = () => {
  const { 
    looms, 
    shiftKpis,
    setSelectedMachineId, 
    assignStopReason,
    configureLoom
  } = useTelemetry();

  const totalLooms = Object.keys(looms).length;

  return (
    <div className="p-4 sm:p-6 min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-950">
      {/* Floor Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-950">
              Weaving Shed Floor
            </h1>
            <Badge variant="outline" className="bg-white text-zinc-700 font-mono text-xs">
              {shiftKpis.shift.name}
            </Badge>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Ali Haider Industries • 36 Picanol Air-Jet Shed
          </p>
        </div>
      </div>

      {/* 4 Clean Top KPI Cards Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KpiCard 
          title="Fleet Efficiency" 
          value={shiftKpis.averageEfficiency !== null ? `${shiftKpis.averageEfficiency.toFixed(1)}%` : '—'} 
          subtitle={shiftKpis.averageEfficiency !== null ? "Runtime / Observed" : "No looms connected"}
          valueColor={shiftKpis.averageEfficiency !== null ? "text-zinc-950" : "text-zinc-400"}
        />
        <KpiCard 
          title="Looms Running" 
          value={`${shiftKpis.activeLoomsCount} / ${totalLooms}`} 
          subtitle={totalLooms > 0 ? `${shiftKpis.activeLoomsCount} active of ${totalLooms} online` : "0 hardware nodes online"}
          valueColor={shiftKpis.activeLoomsCount > 0 ? "text-emerald-700" : "text-zinc-600"}
        />
        <KpiCard 
          title="Active Stoppages" 
          value={shiftKpis.stoppedLoomsCount} 
          subtitle={shiftKpis.stoppedLoomsCount > 0 ? `${shiftKpis.stoppedLoomsCount} looms stopped` : "Zero active stoppages"}
          valueColor={shiftKpis.stoppedLoomsCount > 0 ? "text-rose-700" : "text-zinc-600"}
        />
        <KpiCard 
          title="Shift Output" 
          value={`${shiftKpis.totalMetresWoven.toFixed(1)} m`} 
          subtitle={`${shiftKpis.totalPicks.toLocaleString()} total picks`} 
          valueColor="text-zinc-950"
        />
      </div>

      {/* Loom Grid / Honest Empty State */}
      <MachineMatrixGrid 
        looms={looms} 
        onSelectLoom={setSelectedMachineId} 
        onAssignStopReason={assignStopReason}
        onConfigureLoom={configureLoom}
      />
    </div>
  );
};
