"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { 
  LoomClientState, 
  OperatorReasonCode, 
  OPERATOR_REASON_LABELS 
} from '../../types';
import { 
  Cpu, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  Tag, 
  Search,
  ArrowRight,
  Filter,
  X,
  Radio,
  Sliders,
  Settings
} from 'lucide-react';

interface MachineMatrixGridProps {
  looms: Record<string, LoomClientState>;
  onSelectLoom: (machineId: string) => void;
  onConfigureLoom?: (
    machineId: string,
    updates: {
      loomNumber?: number;
      family?: string;
      articleName?: string;
      setRpm?: number;
      weftDensity?: number;
    }
  ) => Promise<boolean>;
  onAssignLongStopReason: (
    machineId: string,
    stopId: string | null,
    reasonCode: OperatorReasonCode,
    notes?: string,
    operatorName?: string
  ) => Promise<boolean>;
}

type FilterState = 'ALL' | 'RUNNING' | 'STOPPED' | 'LONG_STOP';

export const MachineMatrixGrid: React.FC<MachineMatrixGridProps> = ({ 
  looms, 
  onSelectLoom,
  onConfigureLoom,
  onAssignLongStopReason
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterState>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [configuringMachine, setConfiguringMachine] = useState<LoomClientState | null>(null);
  const [activeLongStopMachine, setActiveLongStopMachine] = useState<LoomClientState | null>(null);

  // Live ticking timestamp for real-time downtime stopwatch calculation (1000ms tick)
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Form states for Configure Loom Modal
  const [configLoomNumber, setConfigLoomNumber] = useState<number>(1);
  const [configFamily, setConfigFamily] = useState('OmniPlus-i');
  const [configArticle, setConfigArticle] = useState('Twill Sheeting');
  const [configSetRpm, setConfigSetRpm] = useState<number>(874);
  const [configDensity, setConfigDensity] = useState<number>(27.2);
  const [isConfiguring, setIsConfiguring] = useState(false);

  // Form states for Long Stop Declaration
  const [selectedReason, setSelectedReason] = useState<OperatorReasonCode>('KNT');
  const [operatorName, setOperatorName] = useState('Akram Khan (Lead Supervisor)');
  const [stopNotes, setStopNotes] = useState('');
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);

  const rawLoomList = useMemo(() => {
    return Object.values(looms).sort((a, b) => (a.loomNumber ?? 999) - (b.loomNumber ?? 999));
  }, [looms]);

  const runningCount = rawLoomList.filter(l => l.state === 'RUNNING').length;
  const stoppedCount = rawLoomList.filter(l => l.state === 'STOPPED').length;
  const longStopCount = rawLoomList.filter(l => {
    if (l.state !== 'STOPPED') return false;
    const elapsed = l.since ? Math.max(0, currentTime - new Date(l.since).getTime()) : 0;
    return l.isLongStop || elapsed >= 300000;
  }).length;

  const filteredLooms = useMemo(() => {
    return rawLoomList.filter(loom => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchLoom = `loom ${loom.loomNumber ?? ''}`.includes(q) || (loom.loomNumber?.toString() === q);
        const matchSerial = loom.machineId.toLowerCase().includes(q);
        if (!matchLoom && !matchSerial) return false;
      }

      // 2. Status Filter
      if (activeFilter === 'RUNNING') return loom.state === 'RUNNING';
      if (activeFilter === 'STOPPED') return loom.state === 'STOPPED';
      if (activeFilter === 'LONG_STOP') {
        const elapsed = loom.since ? Math.max(0, currentTime - new Date(loom.since).getTime()) : 0;
        return loom.state === 'STOPPED' && (loom.isLongStop || elapsed >= 300000);
      }
      return true;
    });
  }, [rawLoomList, activeFilter, searchQuery, currentTime]);

  const formatDowntime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const formatStopCategoryLabel = (cat: string | null) => {
    if (!cat) return 'Unclassified Stoppage';
    switch (cat) {
      case 'WARP': return 'Warp Stop (Drop-Wire)';
      case 'FILLING': return 'Filling Stop (Weft Feeder)';
      case 'SELVEDGE': return 'Selvedge / Lenodefect';
      case 'OTHER': return 'Manual / Other Stop';
      default: return cat;
    }
  };

  const handleLongStopSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLongStopMachine) return;
    setIsSubmittingStop(true);
    try {
      await onAssignLongStopReason(
        activeLongStopMachine.machineId,
        activeLongStopMachine.stopId,
        selectedReason,
        stopNotes,
        operatorName
      );
      setActiveLongStopMachine(null);
      setStopNotes('');
    } finally {
      setIsSubmittingStop(false);
    }
  };

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringMachine || !onConfigureLoom) return;
    setIsConfiguring(true);
    try {
      await onConfigureLoom(configuringMachine.machineId, {
        loomNumber: configLoomNumber,
        family: configFamily,
        articleName: configArticle,
        setRpm: configSetRpm,
        weftDensity: configDensity
      });
      setConfiguringMachine(null);
    } finally {
      setIsConfiguring(false);
    }
  };

  return (
    <div className="space-y-2.5 sm:space-y-3">
      {/* Mobile-First Interactive Filter & Search Controls */}
      <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200/90 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {/* Horizontal Scrollable Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              activeFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            All ({rawLoomList.length})
          </button>

          <button
            onClick={() => setActiveFilter('RUNNING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'RUNNING'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Running ({runningCount})</span>
          </button>

          <button
            onClick={() => setActiveFilter('STOPPED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'STOPPED'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span>Stopped ({stoppedCount})</span>
          </button>

          <button
            onClick={() => setActiveFilter('LONG_STOP')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'LONG_STOP'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Long stop &gt;5m ({longStopCount})</span>
          </button>
        </div>

        {/* Quick Search Input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-48">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Loom # or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* HONEST EMPTY STATE (When 0 machines are connected) */}
      {rawLoomList.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-6 sm:p-10 text-center max-w-2xl mx-auto my-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3 shadow-sm border border-blue-100">
            <Radio size={24} className="animate-pulse" />
          </div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 mb-1">
            No Looms Connected
          </h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto mb-4 leading-relaxed">
            The SCADA server is online and listening for incoming WT32-ETH01 hardware frames over the local network. Machines auto-register immediately upon first heartbeat.
          </p>

          <div className="bg-slate-900 text-slate-100 p-3 rounded-xl font-mono text-xs inline-flex items-center gap-2 max-w-full overflow-x-auto border border-slate-700 shadow-inner">
            <span className="text-blue-400 font-bold select-none">POST</span>
            <span className="text-emerald-400 select-all">/api/ingest/v1/batch</span>
            <span className="text-slate-500 text-[10px] hidden sm:inline">(x-weavesync-key required)</span>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs font-mono text-slate-500 mt-4">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Listening for WT32-ETH01 hardware frames...</span>
          </div>
        </div>
      ) : (
        /* Machine Matrix Grid (2 cols on phone, 3 on sm, 4 on md, 6 on lg) */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3 pb-8">
          {filteredLooms.map(loom => {
            const isRunning = loom.state === 'RUNNING';
            const isOffline = loom.state === 'OFFLINE';
            const hasDeclaredReason = !!loom.operatorReasonCode;

            // Live downtime calculation
            const stopTimestamp = loom.since ? new Date(loom.since).getTime() : currentTime;
            const elapsedMs = Math.max(0, currentTime - stopTimestamp);
            const isLongStop = !isRunning && !isOffline && (loom.isLongStop || elapsedMs >= 300000);

            return (
              <div
                key={loom.machineId}
                onClick={() => onSelectLoom(loom.machineId)}
                className={`text-left bg-white p-2.5 sm:p-3 rounded-xl border transition-all duration-150 shadow-sm relative flex flex-col justify-between min-h-[155px] sm:min-h-[170px] cursor-pointer active:scale-[0.98] group select-none ${
                  isLongStop && !hasDeclaredReason
                    ? 'border-red-500 ring-2 ring-red-400/90 bg-red-50/80 shadow-md'
                    : isLongStop && hasDeclaredReason
                    ? 'border-amber-400 bg-amber-50/60'
                    : isRunning
                    ? 'border-slate-200 hover:border-emerald-400 bg-gradient-to-b from-white to-slate-50/50 hover:shadow-md'
                    : isOffline
                    ? 'border-slate-300 bg-slate-100 opacity-70'
                    : 'border-red-200 bg-red-50/30 hover:border-red-400'
                }`}
              >
                {/* Header: Machine Number, Serial ID, and Live Indicator */}
                <div>
                  <div className="flex justify-between items-start mb-0.5">
                    <div className="flex flex-col">
                      <span className="font-black text-slate-900 text-sm sm:text-base leading-tight">
                        Loom {loom.loomNumber ?? '—'}
                      </span>
                      <span className="text-[10px] sm:text-[11px] font-mono font-bold text-blue-700 tracking-tight">
                        {loom.machineId}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {loom.isPilotNode && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          Node
                        </span>
                      )}
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isRunning 
                          ? 'bg-emerald-500' 
                          : isOffline
                          ? 'bg-slate-400'
                          : 'bg-red-500'
                      }`} />
                    </div>
                  </div>

                  {/* Family & Protocol Pill */}
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 truncate max-w-[90px] sm:max-w-none">
                      {loom.family}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 px-1 py-0.5 rounded bg-slate-50 border border-slate-200">
                      {loom.sources.join(', ')}
                    </span>
                  </div>
                </div>

                {/* Middle Metrics: Efficiency & State */}
                <div className="my-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg sm:text-2xl font-mono font-bold text-slate-900 tracking-tight tabular-nums">
                      {loom.efficiencyPercentage !== null ? `${loom.efficiencyPercentage.toFixed(1)}%` : '—'}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                      isRunning 
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60' 
                        : isOffline
                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                        : 'bg-red-50 text-red-800 border-red-200/60'
                    }`}>
                      {isRunning ? 'Running' : isOffline ? 'Offline' : (loom.stopCategory ? `${loom.stopCategory.charAt(0) + loom.stopCategory.slice(1).toLowerCase()}` : 'Stopped')}
                    </span>
                  </div>

                  {/* Stoppage Status & >5 Minute Long-Stop Stopwatch / Prompt */}
                  {!isRunning && !isOffline && (
                    <div className="mt-1 space-y-1">
                      {isLongStop && !hasDeclaredReason ? (
                        <>
                          <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-black text-red-700 bg-red-100/95 border border-red-300 px-1.5 py-0.5 rounded shadow-inner">
                            <span className="flex items-center gap-1">
                              <Clock size={10} className="text-red-600 animate-spin" style={{ animationDuration: '3s' }} />
                              <span>EXCEEDED 5m:</span>
                            </span>
                            <span className="font-mono tabular-nums font-black text-red-800">
                              {formatDowntime(elapsedMs)}
                            </span>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveLongStopMachine(loom);
                            }}
                            className="w-full bg-red-600 hover:bg-red-700 text-white text-[9px] sm:text-[10px] font-black py-1.5 px-1.5 rounded-lg shadow-md transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                          >
                            <AlertTriangle size={11} className="fill-white text-red-600" />
                            <span>ASSIGN REASON REQUIRED (&gt;5m)</span>
                          </button>
                        </>
                      ) : isLongStop && hasDeclaredReason ? (
                        <div className="text-[8px] sm:text-[9px] font-mono font-bold text-amber-900 bg-amber-100/90 border border-amber-300 px-1.5 py-0.5 rounded flex items-center justify-between truncate">
                          <div className="flex items-center gap-1 truncate">
                            <CheckCircle2 size={10} className="text-amber-700 flex-shrink-0" />
                            <span className="truncate">[{loom.operatorReasonCode}] {OPERATOR_REASON_LABELS[loom.operatorReasonCode!]}</span>
                          </div>
                          <span className="tabular-nums font-semibold text-amber-800 ml-1 flex-shrink-0">
                            ({formatDowntime(elapsedMs)})
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-semibold text-red-800 bg-red-100/80 border border-red-200 px-1.5 py-0.5 rounded">
                            <div className="flex items-center gap-1 truncate">
                              <AlertTriangle size={10} className="flex-shrink-0 text-red-600" />
                              <span className="truncate">{formatStopCategoryLabel(loom.stopCategory)}</span>
                            </div>
                            <span className="font-mono tabular-nums text-[9px] font-bold text-red-700 ml-1 flex-shrink-0 flex items-center gap-0.5">
                              <Clock size={9} /> {formatDowntime(elapsedMs)}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveLongStopMachine(loom);
                            }}
                            className="w-full text-[8px] sm:text-[9px] font-bold py-0.5 px-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors"
                          >
                            <Tag size={9} />
                            <span>Assign Reason</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer: Live RPM & Inspect Indicator */}
                <div className="pt-1.5 border-t border-slate-100 flex justify-between items-center text-xs">
                  <div className="font-mono tabular-nums text-slate-700 font-semibold">
                    <span className={isRunning ? 'text-slate-900 font-black' : 'text-slate-400'}>
                      {loom.rpm}
                    </span>
                    <span className="text-[9px] font-normal text-slate-400 ml-0.5">RPM</span>
                  </div>

                  <div className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">
                    <span>Inspect</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: LONG-STOP OPERATOR DECLARATION */}
      {activeLongStopMachine && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <Clock className="text-red-600 flex-shrink-0" size={22} />
              <div>
                <h3 className="text-base sm:text-lg font-black leading-tight">
                  Long-Stop Declaration ({activeLongStopMachine.machineId})
                </h3>
                <span className="text-[11px] text-slate-500 font-mono">
                  Machine {activeLongStopMachine.loomNumber ?? 1} stopped &gt; 5m • {formatStopCategoryLabel(activeLongStopMachine.stopCategory)}
                </span>
              </div>
            </div>

            <p className="text-[11px] sm:text-xs text-slate-600 mb-3 bg-slate-50 p-2 sm:p-2.5 rounded-lg border border-slate-200">
              Standard operating procedure: stoppages exceeding 5 minutes require an authorized supervisor code declaration.
            </p>

            <form onSubmit={handleLongStopSubmit} className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Select Reason Code
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-xs">
                  {(['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS'] as OperatorReasonCode[]).map(code => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setSelectedReason(code)}
                      className={`p-2 rounded-lg border text-left transition-colors cursor-pointer min-h-[44px] ${
                        selectedReason === code
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold ring-2 ring-blue-200'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-mono font-bold text-xs">[{code}]</div>
                      <div className="text-[10px] text-slate-500 truncate">{OPERATOR_REASON_LABELS[code]}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Supervisor / Operator Name
                </label>
                <input
                  type="text"
                  required
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Floor Notes / Diagnostics
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Warp beam replacement or broken heald frame wire..."
                  value={stopNotes}
                  onChange={(e) => setStopNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveLongStopMachine(null)}
                  className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStop}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer min-h-[40px]"
                >
                  {isSubmittingStop ? 'Submitting...' : 'Confirm Long-Stop Reason'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURE CONNECTED LOOM */}
      {configuringMachine && onConfigureLoom && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <Settings className="text-blue-600 flex-shrink-0" size={22} />
              <h3 className="text-base sm:text-lg font-black leading-tight">Configure Connected Loom</h3>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mb-3">
              Configure parameters for device {configuringMachine.machineId}.
            </p>

            <form onSubmit={handleConfigSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Loom Number
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={configLoomNumber}
                    onChange={(e) => setConfigLoomNumber(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Family
                  </label>
                  <input
                    type="text"
                    value={configFamily}
                    onChange={(e) => setConfigFamily(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-semibold text-slate-900 min-h-[40px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  Article Name
                </label>
                <input
                  type="text"
                  value={configArticle}
                  onChange={(e) => setConfigArticle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-semibold text-slate-900 min-h-[40px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Setpoint RPM
                  </label>
                  <input
                    type="number"
                    value={configSetRpm}
                    onChange={(e) => setConfigSetRpm(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Weft Density (p/cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={configDensity}
                    onChange={(e) => setConfigDensity(parseFloat(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px] text-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setConfiguringMachine(null)}
                  className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConfiguring}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer min-h-[40px]"
                >
                  {isConfiguring ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
