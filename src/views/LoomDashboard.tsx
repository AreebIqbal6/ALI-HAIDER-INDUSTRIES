"use client";
import React, { useState } from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { 
  ArrowLeft, 
  Activity, 
  Clock, 
  CheckCircle2, 
  Settings2,
  Gauge,
  Tag
} from 'lucide-react';
import { HardwarePinInspector } from '../components/omniplus/HardwarePinInspector';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { OPERATOR_REASON_LABELS } from '../types';

export const LoomDashboard: React.FC = () => {
  const { 
    looms, 
    selectedMachineId, 
    setSelectedMachineId 
  } = useTelemetry();

  const [activeTab, setActiveTab] = useState<'operations' | 'hardware'>('operations');

  const loom = selectedMachineId !== 'GLOBAL' ? looms[selectedMachineId] : null;

  if (!loom) {
    return (
      <div className="p-8 text-center bg-zinc-50 min-h-[calc(100vh-56px)] flex flex-col items-center justify-center">
        <p className="text-sm font-medium text-zinc-600 mb-4">
          Machine not found or no telemetry received.
        </p>
        <Button
          onClick={() => setSelectedMachineId('GLOBAL')}
          variant="outline"
          size="sm"
        >
          Return to Floor Fleet
        </Button>
      </div>
    );
  }

  const isRunning = loom.state === 'RUNNING';
  const isStopped = loom.state === 'STOPPED';
  const isOffline = loom.state === 'OFFLINE';

  return (
    <div className="p-4 sm:p-6 min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-950">
      {/* Top Breadcrumb & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 bg-white p-4 rounded-lg border border-zinc-200 shadow-2xs">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMachineId('GLOBAL')}
            className="text-xs text-zinc-600 hover:text-zinc-950 px-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Fleet
          </Button>

          <div className="h-4 w-px bg-zinc-200" />

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-zinc-950">
                {loom.loomNumber ? `Loom ${loom.loomNumber}` : loom.machineId}
              </h1>
              <Badge variant="outline" className="font-mono text-xs">
                {loom.machineId}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {loom.family}
              </Badge>
            </div>
            <span className="text-xs text-zinc-500 block mt-0.5">
              Article: {loom.articleName || 'Standard Weave'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && <Badge variant="running">Running</Badge>}
          {isStopped && (
            <Badge variant="stopped">
              {loom.stopCategory ? `${loom.stopCategory} Stop` : 'Stopped'}
            </Badge>
          )}
          {isOffline && <Badge variant="offline">Offline</Badge>}
        </div>
      </div>

      {/* Tabs: Operations vs Hardware Diagnostics */}
      <Tabs defaultValue="operations" value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="mb-4">
          <TabsTrigger value="operations">Production Operations</TabsTrigger>
          <TabsTrigger value="hardware">Hardware Diagnostics</TabsTrigger>
        </TabsList>

        {/* OPERATIONS TAB */}
        <TabsContent value="operations" className="space-y-4">
          {/* Top 4 Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <Card className="p-4 bg-white border-zinc-200">
              <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider block mb-1">
                Live Speed
              </span>
              <div className="text-2xl sm:text-3xl font-mono font-bold text-zinc-950 tabular-nums">
                {loom.rpm} <span className="text-xs font-sans text-zinc-500 font-normal">RPM</span>
              </div>
              <span className="text-xs text-zinc-500 mt-1 block">
                Setpoint: {loom.setRpm} RPM
              </span>
            </Card>

            <Card className="p-4 bg-white border-zinc-200">
              <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider block mb-1">
                Shift Efficiency
              </span>
              <div className="text-2xl sm:text-3xl font-mono font-bold text-zinc-950 tabular-nums">
                {loom.efficiencyPercentage.toFixed(1)}%
              </div>
              <span className="text-xs text-zinc-500 mt-1 block">
                Runtime ratio
              </span>
            </Card>

            <Card className="p-4 bg-white border-zinc-200">
              <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider block mb-1">
                Total Shift Picks
              </span>
              <div className="text-2xl sm:text-3xl font-mono font-bold text-zinc-950 tabular-nums">
                {loom.picksTotal.toLocaleString()}
              </div>
              <span className="text-xs text-zinc-500 mt-1 block">
                Hardware PCNT counted
              </span>
            </Card>

            <Card className="p-4 bg-white border-zinc-200">
              <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider block mb-1">
                Output Woven
              </span>
              <div className="text-2xl sm:text-3xl font-mono font-bold text-zinc-950 tabular-nums">
                {loom.metresWoven.toFixed(1)} <span className="text-xs font-sans text-zinc-500 font-normal">m</span>
              </div>
              <span className="text-xs text-zinc-500 mt-1 block">
                Density: {loom.weftDensityPicksPerCm} picks/cm
              </span>
            </Card>
          </div>

          {/* Stoppage Reason Status (If Stopped) */}
          {isStopped && (
            <Card className="p-4 bg-rose-50/30 border-rose-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-rose-950 flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-rose-700" />
                    <span>Loom Stoppage Active</span>
                  </h3>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Category: {loom.stopCategory || 'Unclassified'} · Since: {new Date(loom.since).toLocaleTimeString()}
                  </p>
                </div>

                {loom.operatorReasonCode ? (
                  <Badge variant="outline" className="bg-white text-zinc-800 text-xs font-medium">
                    Reason: [{loom.operatorReasonCode}] {OPERATOR_REASON_LABELS[loom.operatorReasonCode]}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs font-medium">
                    No reason assigned yet
                  </Badge>
                )}
              </div>
            </Card>
          )}

          {/* Stoppage Breakdown Card */}
          <Card className="p-4 bg-white border-zinc-200">
            <CardHeader className="p-0 pb-3 mb-3 border-b border-zinc-100">
              <CardTitle className="text-xs font-semibold text-zinc-900 uppercase tracking-wider">
                Shift Stoppage Breakdown
              </CardTitle>
            </CardHeader>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center font-mono">
              <div className="p-3 rounded-md bg-zinc-50 border border-zinc-100">
                <span className="text-xs text-zinc-500 font-sans block">Warp Stops</span>
                <span className="text-xl font-bold text-zinc-900">{loom.stopsShift?.WARP || 0}</span>
              </div>
              <div className="p-3 rounded-md bg-zinc-50 border border-zinc-100">
                <span className="text-xs text-zinc-500 font-sans block">Weft / Filling</span>
                <span className="text-xl font-bold text-zinc-900">{loom.stopsShift?.FILLING || 0}</span>
              </div>
              <div className="p-3 rounded-md bg-zinc-50 border border-zinc-100">
                <span className="text-xs text-zinc-500 font-sans block">Selvedge</span>
                <span className="text-xl font-bold text-zinc-900">{loom.stopsShift?.SELVEDGE || 0}</span>
              </div>
              <div className="p-3 rounded-md bg-zinc-50 border border-zinc-100">
                <span className="text-xs text-zinc-500 font-sans block">Other</span>
                <span className="text-xl font-bold text-zinc-900">{loom.stopsShift?.OTHER || 0}</span>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* HARDWARE DIAGNOSTICS TAB */}
        <TabsContent value="hardware">
          <HardwarePinInspector loom={loom} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
