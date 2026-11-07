"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { 
  LoomClientState, 
  LoomFamily, 
  SourceKind, 
  OperatorReasonCode, 
  OPERATOR_REASON_LABELS 
} from '../../types';
import { 
  Plus, 
  Cpu, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  Tag, 
  Search,
  ArrowRight,
  Filter,
  X,
  Zap
} from 'lucide-react';

interface MachineMatrixGridProps {
  looms: Record<string, LoomClientState>;
  onSelectLoom: (machineId: string) => void;
  onAddMachine?: (
    machineId: string,
    loomNumber: number,
    family: LoomFamily,
    sources: SourceKind[],
    setRpm?: number,
    weftDensity?: number,
    ipAddress?: string
  ) => Promise<string>;
  onAssignLongStopReason: (
    machineId: string,
    stopId: string,
    reasonCode: OperatorReasonCode,
    notes?: string,
    operatorName?: string
  ) => Promise<boolean>;
}

type FilterState = 'ALL' | 'RUNNING' | 'STOPPED' | 'LONG_STOP' | 'OMNI_I' | 'OMNI_800' | 'SUMMUM';

export const MachineMatrixGrid: React.FC<MachineMatrixGridProps> = ({ 
  looms, 
  onSelectLoom,
  onAddMachine,
  onAssignLongStopReason
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterState>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeLongStopMachine, setActiveLongStopMachine] = useState<LoomClientState | null>(null);

  // Live ticking timestamp for real-time downtime stopwatch calculation (1000ms tick)
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Form states for Commissioning Modal (Supports Picanol & Toyota expansion)
  const [prefix, setPrefix] = useState<'PIC' | 'TOY'>('PIC');
  const [newLoomNumber, setNewLoomNumber] = useState<number>(37);
  const [newSerial, setNewSerial] = useState('458901');
  const [newFamily, setNewFamily] = useState<LoomFamily>('OmniPlus-i');
  const [newSetRpm, setNewSetRpm] = useState<number>(874);
  const [newDensity, setNewDensity] = useState<number>(27.2);
  const [isCommissioning, setIsCommissioning] = useState(false);

  // Form states for Long Stop Declaration
  const [selectedReason, setSelectedReason] = useState<OperatorReasonCode>('KNT');
  const [operatorName, setOperatorName] = useState('Akram Khan (Lead Supervisor)');
  const [stopNotes, setStopNotes] = useState('');
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);

  const rawLoomList = useMemo(() => {
    return Object.values(looms).sort((a, b) => a.loomNumber - b.loomNumber);
  }, [looms]);

  const runningCount = rawLoomList.filter(l => l.state === 'RUNNING').length;
  const stoppedCount = rawLoomList.filter(l => l.state === 'STOPPED').length;
  const longStopCount = rawLoomList.filter(l => {
    if (l.state !== 'STOPPED') return false;
    const elapsed = l.since ? Math.max(0, currentTime - new Date(l.since).getTime()) : 0;
    return l.isLongStop || elapsed >= 300000;
  }).length;
  const omniICount = rawLoomList.filter(l => l.family === 'OmniPlus-i').length;
  const omni800Count = rawLoomList.filter(l => l.family === 'OmniPlus 800').length;
  const summumCount = rawLoomList.filter(l => l.family === 'OmniPlus Summum').length;

  const filteredLooms = useMemo(() => {
    return rawLoomList.filter(loom => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchLoom = `loom ${loom.loomNumber}`.includes(q) || loom.loomNumber.toString() === q;
        const matchSerial = loom.machineId.toLowerCase().includes(q);
        const matchFamily = loom.family.toLowerCase().includes(q);
        if (!matchLoom && !matchSerial && !matchFamily) return false;
      }

      // 2. Status Filter
      if (activeFilter === 'RUNNING') return loom.state === 'RUNNING';
      if (activeFilter === 'STOPPED') return loom.state === 'STOPPED';
      if (activeFilter === 'LONG_STOP') {
        const elapsed = loom.since ? Math.max(0, currentTime - new Date(loom.since).getTime()) : 0;
        return loom.state === 'STOPPED' && (loom.isLongStop || elapsed >= 300000);
      }
      if (activeFilter === 'OMNI_I') return loom.family === 'OmniPlus-i';
      if (activeFilter === 'OMNI_800') return loom.family === 'OmniPlus 800';
      if (activeFilter === 'SUMMUM') return loom.family === 'OmniPlus Summum';
      return true;
    });
  }, [rawLoomList, activeFilter, searchQuery, currentTime]);

  const formatDowntime = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  };

  const handleCommissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddMachine) return;
    setIsCommissioning(true);
    try {
      const machineId = `${prefix}-${newSerial.trim()}`;
      const sources: SourceKind[] = 
        newFamily === 'OmniPlus 800' 
          ? ['LDL'] 
          : newFamily === 'Toyota JAT810' 
          ? ['SENSOR_KIT'] 
          : ['LDL', 'BICOM_ETH'];
      await onAddMachine(machineId, newLoomNumber, newFamily, sources, newSetRpm, newDensity);
      setShowAddModal(false);
      setNewLoomNumber(prev => prev + 1);
      setNewSerial(prev => (parseInt(prev, 10) + 1).toString());
    } finally {
      setIsCommissioning(false);
    }
  };

  const handleLongStopSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLongStopMachine) return;
    setIsSubmittingStop(true);
    try {
      await onAssignLongStopReason(
        activeLongStopMachine.machineId,
        activeLongStopMachine.stopId || `stop-${activeLongStopMachine.machineId}`,
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

  const formatStopCategoryLabel = (category: string | null) => {
    if (!category) return 'STOPPED';
    switch (category) {
      case 'WARP': return 'WARP BREAK';
      case 'FILLING': return 'WEFT (FILLING)';
      case 'SELVEDGE': return 'LENO SELVEDGE';
      case 'OTHER': return 'OTHER STOP';
      default: return category;
    }
  };

  return (
    <div className="space-y-2.5 sm:space-y-3">
      {/* Mobile-First Interactive Filter & Search Controls */}
      <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200/90 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {/* Horizontal Scrollable 7 Filter Chips (Touch Friendly) */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {/* Tab 1: All */}
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeFilter === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({rawLoomList.length})
          </button>

          {/* Tab 2: Running */}
          <button
            onClick={() => setActiveFilter('RUNNING')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'RUNNING'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Running ({runningCount})
          </button>

          {/* Tab 3: Stopped */}
          <button
            onClick={() => setActiveFilter('STOPPED')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'STOPPED'
                ? 'bg-red-600 text-white'
                : 'bg-red-50 text-red-800 border border-red-200 hover:bg-red-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-400" />
            Stopped ({stoppedCount})
          </button>

          {/* Tab 4: Long Stop >5m */}
          <button
            onClick={() => setActiveFilter('LONG_STOP')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'LONG_STOP'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100'
            }`}
          >
            <AlertTriangle size={12} className={activeFilter === 'LONG_STOP' ? 'text-white' : 'text-amber-600'} />
            Long Stop &gt;5m ({longStopCount})
          </button>

          {/* Tab 5: OmniPlus-i */}
          <button
            onClick={() => setActiveFilter('OMNI_I')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeFilter === 'OMNI_I'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            OmniPlus-i ({omniICount})
          </button>

          {/* Tab 6: OmniPlus 800 */}
          <button
            onClick={() => setActiveFilter('OMNI_800')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeFilter === 'OMNI_800'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            OmniPlus 800 ({omni800Count})
          </button>

          {/* Tab 7: Summum */}
          <button
            onClick={() => setActiveFilter('SUMMUM')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              activeFilter === 'SUMMUM'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Summum ({summumCount})
          </button>
        </div>

        {/* Quick Search & + Commission Loom Button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-44">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Loom #..."
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

          {onAddMachine && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer active:scale-95"
            >
              <Plus size={14} />
              <span>+ Commission Loom</span>
            </button>
          )}
        </div>
      </div>

      {/* 36-Machine Matrix Grid (2 cols on phone, 3 on sm, 4 on md, 6 on lg) */}
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
                      Loom {loom.loomNumber}
                    </span>
                    <span className="text-[10px] sm:text-[11px] font-mono font-bold text-blue-700 tracking-tight">
                      {loom.machineId}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {(loom.isPilotNode || loom.machineId === 'PIC-427708' || loom.loomNumber === 1) && (
                      <span className="text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 uppercase tracking-wider flex items-center gap-1 shadow-sm animate-pulse">
                        <Zap size={9} className="fill-slate-950" /> PILOT
                      </span>
                    )}
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      isRunning 
                        ? 'bg-emerald-500 ring-2 sm:ring-4 ring-emerald-100' 
                        : isOffline
                        ? 'bg-slate-400 ring-2 sm:ring-4 ring-slate-100'
                        : 'bg-red-500 ring-2 sm:ring-4 ring-red-100 animate-pulse'
                    }`} />
                  </div>
                </div>

                {/* Family & Protocol Pill */}
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 truncate max-w-[85px] sm:max-w-none">
                    {loom.family === 'OmniPlus Summum' ? 'Summum' : loom.family}
                  </span>
                  <span className="text-[8px] sm:text-[9px] font-mono font-semibold px-1 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {loom.sources.join('+')}
                  </span>
                </div>
              </div>

              {/* Middle Metrics: Efficiency & State */}
              <div className="my-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg sm:text-2xl font-mono font-black text-slate-900 tracking-tight tabular-nums">
                    {loom.efficiencyPercentage.toFixed(1)}%
                  </span>
                  <span className={`text-[9px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                    isRunning 
                      ? 'bg-emerald-100 text-emerald-800' 
                      : isOffline
                      ? 'bg-slate-200 text-slate-700'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {loom.state}
                  </span>
                </div>

                {/* Stoppage Status & >5 Minute Long-Stop Stopwatch / Prompt */}
                {!isRunning && !isOffline && (
                  <div className="mt-1 space-y-1">
                    {/* Exceeded 5 minutes (>300,000ms) without declared supervisor reason */}
                    {isLongStop && !hasDeclaredReason ? (
                      <>
                        {/* Live Stopwatch Badge: ⏱️ EXCEEDED 5m: MMm SSs */}
                        <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-black text-red-700 bg-red-100/95 border border-red-300 px-1.5 py-0.5 rounded shadow-inner animate-pulse">
                          <span className="flex items-center gap-1">
                            <Clock size={10} className="text-red-600 animate-spin" style={{ animationDuration: '3s' }} />
                            <span>⏱️ EXCEEDED 5m:</span>
                          </span>
                          <span className="font-mono tabular-nums font-black text-red-800">
                            {formatDowntime(elapsedMs)}
                          </span>
                        </div>

                        {/* Prominent High-Visibility Prompt Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveLongStopMachine(loom);
                          }}
                          className="w-full bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-700 hover:to-amber-700 text-white text-[9px] sm:text-[10px] font-black py-1.5 px-1.5 rounded-lg shadow-md transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 ring-2 ring-red-400/50"
                        >
                          <AlertTriangle size={11} className="fill-white text-red-600 animate-bounce" />
                          <span>⚠️ ASSIGN REASON REQUIRED (&gt;5m)</span>
                        </button>
                      </>
                    ) : isLongStop && hasDeclaredReason ? (
                      /* Exceeded 5m with declared reason */
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
                      /* Stopped under 5 minutes: show stop category and live elapsed downtime */
                      <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-semibold text-red-800 bg-red-100/80 border border-red-200 px-1.5 py-0.5 rounded">
                        <div className="flex items-center gap-1 truncate">
                          <AlertTriangle size={10} className="flex-shrink-0 text-red-600" />
                          <span className="truncate">{formatStopCategoryLabel(loom.stopCategory)}</span>
                        </div>
                        <span className="font-mono tabular-nums text-[9px] font-bold text-red-700 ml-1 flex-shrink-0">
                          ⏱️ {formatDowntime(elapsedMs)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer: Live RPM (Tabular Nums) & Tap Indicator */}
              <div className="pt-1.5 border-t border-slate-100 flex justify-between items-center text-xs">
                <div className="font-mono tabular-nums text-slate-700 font-semibold">
                  <span className={isRunning ? 'text-slate-900 font-black' : 'text-slate-400'}>
                    {loom.rpm}
                  </span>
                  <span className="text-[9px] font-normal text-slate-400 ml-0.5">RPM</span>
                </div>

                <div className="text-[10px] font-bold text-blue-600 group-hover:text-blue-800 flex items-center gap-0.5 transition-colors">
                  <span>Inspect</span> <ArrowRight size={10} />
                </div>
              </div>
            </div>
          );
        })}

        {/* Dynamic Commissioning Card for Looms 37, 38, 39 */}
        {onAddMachine && (
          <button
            onClick={() => setShowAddModal(true)}
            className="border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50/50 p-3 sm:p-4 rounded-xl flex flex-col items-center justify-center text-center transition-all group min-h-[155px] sm:min-h-[170px] cursor-pointer active:scale-95"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center text-slate-500 group-hover:text-blue-600 mb-1.5 transition-colors">
              <Plus size={18} />
            </div>
            <span className="text-xs font-bold text-slate-800 group-hover:text-blue-600">
              + Commission Loom
            </span>
            <span className="text-[9px] sm:text-[10px] text-slate-500 mt-0.5 font-mono">
              Onboard 37–39
            </span>
          </button>
        )}
      </div>

      {/* MODAL 1: LONG-STOP OPERATOR DECLARATION (Mobile Bottom Sheet / Desktop Modal) */}
      {activeLongStopMachine && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            {/* Mobile Grab Handle */}
            <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <Clock className="text-red-600 flex-shrink-0" size={22} />
              <div>
                <h3 className="text-base sm:text-lg font-black leading-tight">
                  Long-Stop Declaration ({activeLongStopMachine.machineId})
                </h3>
                <span className="text-[11px] text-slate-500 font-mono">
                  Machine {activeLongStopMachine.loomNumber} stopped &gt; 5m • {formatStopCategoryLabel(activeLongStopMachine.stopCategory)}
                </span>
              </div>
            </div>

            <p className="text-[11px] sm:text-xs text-slate-600 mb-3 bg-slate-50 p-2 sm:p-2.5 rounded-lg border border-slate-200">
              Under ISO standards, stoppages exceeding 5 minutes require an authorized supervisor code declaration.
            </p>

            <form onSubmit={handleLongStopSubmit} className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Select Reason Code (Section 10.4)
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

      {/* MODAL 2: + COMMISSION LOOM MODAL (Dynamic Fleet Expansion) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            {/* Mobile Grab Handle */}
            <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <Cpu className="text-blue-600 flex-shrink-0" size={22} />
              <h3 className="text-base sm:text-lg font-black leading-tight">+ Commission Loom (Dynamic Fleet Expansion)</h3>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mb-3">
              Onboard Ali Haider Industries' 3 new looms (Looms 37–39) or neighboring 55 Toyota looms in seconds.
            </p>

            <form onSubmit={handleCommissionSubmit} className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Prefix
                  </label>
                  <select
                    value={prefix}
                    onChange={(e) => {
                      const p = e.target.value as 'PIC' | 'TOY';
                      setPrefix(p);
                      if (p === 'TOY') {
                        setNewFamily('Toyota JAT810');
                        setNewSetRpm(750);
                        setNewDensity(27.2);
                      } else {
                        setNewFamily('OmniPlus-i');
                        setNewSetRpm(874);
                        setNewDensity(27.2);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px] text-slate-900"
                  >
                    <option value="PIC">PIC (Picanol)</option>
                    <option value="TOY">TOY (Toyota)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Loom #
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newLoomNumber}
                    onChange={(e) => setNewLoomNumber(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Serial #
                  </label>
                  <input
                    type="text"
                    value={newSerial}
                    onChange={(e) => setNewSerial(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px] text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  Machine Family
                </label>
                <select
                  value={newFamily}
                  onChange={(e) => {
                    const f = e.target.value as LoomFamily;
                    setNewFamily(f);
                    if (f === 'OmniPlus 800') {
                      setNewSetRpm(501);
                      setNewDensity(38.2);
                    } else if (f === 'OmniPlus Summum') {
                      setNewSetRpm(850);
                      setNewDensity(27.2);
                    } else if (f === 'Toyota JAT810') {
                      setNewSetRpm(750);
                      setNewDensity(27.2);
                    } else {
                      setNewSetRpm(874);
                      setNewDensity(27.2);
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-semibold text-slate-800 min-h-[40px]"
                >
                  <option value="OmniPlus-i">Picanol OmniPlus-i (2021 • 874 RPM • LDL+BICOM)</option>
                  <option value="OmniPlus Summum">Picanol OmniPlus Summum (2012/15 • 850 RPM • LDL+BICOM)</option>
                  <option value="OmniPlus 800">Picanol OmniPlus 800 (2005/06 • 501 RPM • LDL)</option>
                  <option value="Toyota JAT810">Toyota JAT810 (Airjet • 750 RPM • Sensor Kit)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Default Set RPM
                  </label>
                  <input
                    type="number"
                    value={newSetRpm}
                    onChange={(e) => setNewSetRpm(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                    Weft Density (p/cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={newDensity}
                    onChange={(e) => setNewDensity(parseFloat(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold min-h-[40px]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCommissioning}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer min-h-[40px]"
                >
                  {isCommissioning ? 'Commissioning...' : '+ Commission Loom to Fleet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
