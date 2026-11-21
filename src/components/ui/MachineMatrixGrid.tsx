"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { 
  LoomClientState, 
  OperatorReasonCode, 
  OPERATOR_REASON_LABELS 
} from '../../types';
import { 
  Radio,
  Clock, 
  Tag, 
  Settings2,
  ChevronRight,
  Server
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from './dialog';

interface MachineMatrixGridProps {
  looms: Record<string, LoomClientState>;
  onSelectLoom: (machineId: string) => void;
  onAssignStopReason: (
    machineId: string,
    stopId: string | null,
    reasonCode: OperatorReasonCode,
    notes?: string,
    operatorName?: string
  ) => Promise<boolean>;
  onConfigureLoom: (
    machineId: string,
    updates: {
      loomNumber?: number;
      family?: string;
      articleName?: string;
      setRpm?: number;
      weftDensity?: number;
    }
  ) => Promise<boolean>;
}

type FilterState = 'ALL' | 'RUNNING' | 'STOPPED' | 'OFFLINE';

export const MachineMatrixGrid: React.FC<MachineMatrixGridProps> = ({ 
  looms, 
  onSelectLoom,
  onAssignStopReason,
  onConfigureLoom
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterState>('ALL');
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [stopModalLoom, setStopModalLoom] = useState<LoomClientState | null>(null);
  const [configModalLoom, setConfigModalLoom] = useState<LoomClientState | null>(null);

  // Stop reason form state
  const [selectedReason, setSelectedReason] = useState<OperatorReasonCode>('KNT');
  const [stopNotes, setStopNotes] = useState('');
  const [operatorName, setOperatorName] = useState('Floor Supervisor');
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);

  // Configure loom form state
  const [cfgLoomNum, setCfgLoomNum] = useState<number>(1);
  const [cfgFamily, setCfgFamily] = useState('OmniPlus-i');
  const [cfgArticle, setCfgArticle] = useState('Standard Weave');
  const [cfgRpm, setCfgRpm] = useState<number>(874);
  const [cfgDensity, setCfgDensity] = useState<number>(27.2);
  const [isSubmittingConfig, setIsSubmittingConfig] = useState(false);

  // Stopwatch 1-second interval
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rawLoomList = useMemo(() => {
    return Object.values(looms).sort((a, b) => {
      const numA = a.loomNumber ?? 999;
      const numB = b.loomNumber ?? 999;
      return numA - numB;
    });
  }, [looms]);

  const filteredLooms = useMemo(() => {
    if (activeFilter === 'ALL') return rawLoomList;
    return rawLoomList.filter(l => l.state === activeFilter);
  }, [rawLoomList, activeFilter]);

  // Open Configure Modal
  const openConfigModal = (loom: LoomClientState, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfigModalLoom(loom);
    setCfgLoomNum(loom.loomNumber ?? 1);
    setCfgFamily(loom.family || 'OmniPlus-i');
    setCfgArticle(loom.articleName || 'Standard Weave');
    setCfgRpm(loom.setRpm || 874);
    setCfgDensity(loom.weftDensityPicksPerCm || 27.2);
  };

  // Open Stop Reason Modal
  const openStopModal = (loom: LoomClientState, e: React.MouseEvent) => {
    e.stopPropagation();
    setStopModalLoom(loom);
    setSelectedReason(loom.operatorReasonCode || 'KNT');
    setStopNotes(loom.operatorReasonNote || '');
  };

  const handleStopSubmit = async () => {
    if (!stopModalLoom) return;
    setIsSubmittingStop(true);
    try {
      await onAssignStopReason(
        stopModalLoom.machineId,
        stopModalLoom.stopId,
        selectedReason,
        stopNotes,
        operatorName
      );
      setStopModalLoom(null);
    } finally {
      setIsSubmittingStop(false);
    }
  };

  const handleConfigSubmit = async () => {
    if (!configModalLoom) return;
    setIsSubmittingConfig(true);
    try {
      await onConfigureLoom(configModalLoom.machineId, {
        loomNumber: Number(cfgLoomNum),
        family: cfgFamily,
        articleName: cfgArticle,
        setRpm: Number(cfgRpm),
        weftDensity: Number(cfgDensity)
      });
      setConfigModalLoom(null);
    } finally {
      setIsSubmittingConfig(false);
    }
  };

  // Format stopwatch elapsed time
  const formatDuration = (sinceIso?: string) => {
    if (!sinceIso) return '00:00';
    const elapsedSec = Math.max(0, Math.floor((currentTime - new Date(sinceIso).getTime()) / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ====================================================================
  // 1. HONEST EMPTY STATE (0 Connected Machines)
  // ====================================================================
  if (rawLoomList.length === 0) {
    return (
      <Card className="border-dashed border-2 border-zinc-300 bg-white p-8 sm:p-12 text-center max-w-2xl mx-auto my-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 mb-4">
          <Radio className="h-7 w-7 text-zinc-700 animate-pulse" />
        </div>
        <CardTitle className="text-xl sm:text-2xl font-bold text-zinc-950 mb-2">
          No Looms Connected
        </CardTitle>
        <p className="text-sm text-zinc-600 max-w-md mx-auto mb-6">
          The SCADA ingestion engine is online and actively listening for hardware packets from WT32-ETH01 or Edge Gateway nodes.
        </p>

        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-left font-mono text-xs max-w-lg mx-auto space-y-2">
          <div className="flex items-center justify-between text-zinc-500 pb-2 border-b border-zinc-200">
            <span className="font-semibold text-zinc-800">LAN Telemetry Listener</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-sans font-medium text-[11px]">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              Ready
            </span>
          </div>
          <div className="text-zinc-700">
            <span className="text-zinc-400">Endpoint: </span>
            <span className="text-zinc-900 font-semibold">POST /api/ingest/v1/batch</span>
          </div>
          <div className="text-zinc-700">
            <span className="text-zinc-400">Auth Header: </span>
            <span className="text-zinc-900 font-semibold">x-weavesync-key: weavesync-industrial-secret-2026</span>
          </div>
          <div className="text-zinc-700">
            <span className="text-zinc-400">Interface: </span>
            <span>XP_CBMP_P9 (GPIO 4: STRT, GPIO 32: PP/PCNT, GPIO 33: WD, GPIO 14: FD)</span>
          </div>
        </div>

        <p className="text-xs text-zinc-400 mt-6">
          Once an authenticated device transmits a heartbeat packet, its loom card will appear live automatically.
        </p>
      </Card>
    );
  }

  // ====================================================================
  // 2. CONNECTED LOOMS MATRIX
  // ====================================================================
  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Button
            variant={activeFilter === 'ALL' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('ALL')}
            className="text-xs"
          >
            All ({rawLoomList.length})
          </Button>
          <Button
            variant={activeFilter === 'RUNNING' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('RUNNING')}
            className="text-xs"
          >
            Running ({rawLoomList.filter(l => l.state === 'RUNNING').length})
          </Button>
          <Button
            variant={activeFilter === 'STOPPED' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('STOPPED')}
            className="text-xs"
          >
            Stopped ({rawLoomList.filter(l => l.state === 'STOPPED').length})
          </Button>
          <Button
            variant={activeFilter === 'OFFLINE' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveFilter('OFFLINE')}
            className="text-xs"
          >
            Offline ({rawLoomList.filter(l => l.state === 'OFFLINE').length})
          </Button>
        </div>
      </div>

      {/* Grid of Loom Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {filteredLooms.map(loom => {
          const isRunning = loom.state === 'RUNNING';
          const isStopped = loom.state === 'STOPPED';
          const isOffline = loom.state === 'OFFLINE';
          const elapsedSec = isStopped && loom.since 
            ? Math.max(0, Math.floor((currentTime - new Date(loom.since).getTime()) / 1000))
            : 0;
          const needsReason = isStopped && elapsedSec >= 300 && !loom.operatorReasonCode;

          return (
            <Card 
              key={loom.machineId}
              onClick={() => onSelectLoom(loom.machineId)}
              className={`p-4 transition-all hover:border-zinc-400 hover:shadow-xs cursor-pointer flex flex-col justify-between ${
                isStopped ? 'border-rose-300 bg-rose-50/20' : 'bg-white'
              }`}
            >
              {/* Card Header: Loom Name, Model & Status */}
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h2 className="font-bold text-base text-zinc-950 flex items-center gap-1.5">
                      <span>{loom.loomNumber ? `Loom ${loom.loomNumber}` : loom.machineId}</span>
                      {loom.loomNumber && (
                        <span className="text-xs font-normal text-zinc-500">
                          · {loom.family}
                        </span>
                      )}
                    </h2>
                    <span className="text-[11px] text-zinc-500 font-mono block">
                      {loom.machineId}
                    </span>
                  </div>

                  {isRunning && (
                    <Badge variant="running">Running</Badge>
                  )}
                  {isStopped && (
                    <Badge variant="stopped">
                      {loom.stopCategory ? `${loom.stopCategory} Stop` : 'Stopped'}
                    </Badge>
                  )}
                  {isOffline && (
                    <Badge variant="offline">Offline</Badge>
                  )}
                </div>

                {/* Article Name */}
                <div className="text-xs text-zinc-600 truncate mb-3">
                  {loom.articleName || 'Standard Weave'}
                </div>

                {/* Main Metrics Strip */}
                <div className="grid grid-cols-3 gap-2 py-2 border-y border-zinc-100 text-center font-mono">
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-sans block">Efficiency</span>
                    <span className="text-sm font-bold text-zinc-950 tabular-nums">
                      {loom.efficiencyPercentage.toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-sans block">Speed</span>
                    <span className="text-sm font-bold text-zinc-950 tabular-nums">
                      {loom.rpm} <span className="text-[9px] font-sans font-normal text-zinc-500">RPM</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-sans block">Output</span>
                    <span className="text-sm font-bold text-zinc-950 tabular-nums">
                      {loom.metresWoven.toFixed(1)} <span className="text-[9px] font-sans font-normal text-zinc-500">m</span>
                    </span>
                  </div>
                </div>

                {/* Stopped Stopwatch & Reason Badge */}
                {isStopped && (
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1 font-mono font-semibold text-rose-700 tabular-nums">
                      <Clock className="h-3.5 w-3.5 text-rose-600" />
                      {formatDuration(loom.since)}
                    </span>
                    {loom.operatorReasonCode ? (
                      <span className="text-[11px] font-medium text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-200">
                        [{loom.operatorReasonCode}] {OPERATOR_REASON_LABELS[loom.operatorReasonCode]}
                      </span>
                    ) : (
                      <span className="text-[11px] text-rose-600 font-medium">
                        Unclassified
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="mt-4 pt-2 flex items-center justify-between gap-2 border-t border-zinc-100">
                {needsReason ? (
                  <Button 
                    size="sm" 
                    variant="destructive"
                    className="w-full text-xs"
                    onClick={(e) => openStopModal(loom, e)}
                  >
                    <Tag className="h-3 w-3 mr-1" />
                    Log Stop Reason
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-zinc-600 hover:text-zinc-900 p-0 h-auto"
                      onClick={(e) => openConfigModal(loom, e)}
                    >
                      <Settings2 className="h-3.5 w-3.5 mr-1" />
                      Configure
                    </Button>

                    <span className="text-xs text-zinc-500 flex items-center gap-0.5">
                      View Diagnostics
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* STOP REASON DIALOG */}
      <Dialog open={Boolean(stopModalLoom)} onOpenChange={(open) => !open && setStopModalLoom(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log Stoppage Reason</DialogTitle>
            <DialogDescription>
              Machine: {stopModalLoom?.machineId} ({stopModalLoom?.loomNumber ? `Loom ${stopModalLoom.loomNumber}` : 'Unassigned'})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-zinc-700 block mb-1.5">
                Standard Reason Code (ISO 22971)
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {(Object.keys(OPERATOR_REASON_LABELS) as OperatorReasonCode[]).map(code => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSelectedReason(code)}
                    className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium border text-left transition-colors cursor-pointer ${
                      selectedReason === code
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                    }`}
                  >
                    <span>{OPERATOR_REASON_LABELS[code]}</span>
                    <span className="font-mono opacity-80">[{code}]</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 block mb-1">
                Technician / Operator Notes (Optional)
              </label>
              <textarea
                value={stopNotes}
                onChange={(e) => setStopNotes(e.target.value)}
                placeholder="Details of repair, beam condition, or warp break location..."
                className="w-full text-xs p-2.5 rounded-md border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-950 resize-none h-18"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStopModalLoom(null)}>
              Cancel
            </Button>
            <Button onClick={handleStopSubmit} disabled={isSubmittingStop}>
              {isSubmittingStop ? 'Saving...' : 'Submit Reason'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONFIGURE LOOM DIALOG */}
      <Dialog open={Boolean(configModalLoom)} onOpenChange={(open) => !open && setConfigModalLoom(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure Hardware Node</DialogTitle>
            <DialogDescription>
              Assign factory floor parameters to {configModalLoom?.machineId} ({configModalLoom?.deviceId})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <label className="font-semibold text-zinc-700 block mb-1">Loom Number</label>
              <input
                type="number"
                value={cfgLoomNum}
                onChange={(e) => setCfgLoomNum(Number(e.target.value))}
                className="w-full p-2 rounded-md border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-950"
              />
            </div>

            <div>
              <label className="font-semibold text-zinc-700 block mb-1">Model Family</label>
              <select
                value={cfgFamily}
                onChange={(e) => setCfgFamily(e.target.value)}
                className="w-full p-2 rounded-md border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-950 bg-white"
              >
                <option value="OmniPlus-i">OmniPlus-i</option>
                <option value="OmniPlus 800">OmniPlus 800</option>
                <option value="OmniPlus Summum">OmniPlus Summum</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-zinc-700 block mb-1">Article Name</label>
              <input
                type="text"
                value={cfgArticle}
                onChange={(e) => setCfgArticle(e.target.value)}
                className="w-full p-2 rounded-md border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-950"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-zinc-700 block mb-1">Setpoint RPM</label>
                <input
                  type="number"
                  value={cfgRpm}
                  onChange={(e) => setCfgRpm(Number(e.target.value))}
                  className="w-full p-2 rounded-md border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-950"
                />
              </div>
              <div>
                <label className="font-semibold text-zinc-700 block mb-1">Weft Density (picks/cm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={cfgDensity}
                  onChange={(e) => setCfgDensity(Number(e.target.value))}
                  className="w-full p-2 rounded-md border border-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-950"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigModalLoom(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfigSubmit} disabled={isSubmittingConfig}>
              {isSubmittingConfig ? 'Saving...' : 'Save Configuration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
