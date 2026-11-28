"use client";
import React, { useState, useMemo, useEffect } from 'react';
import {
  LoomClientState,
  OperatorReasonCode,
  OPERATOR_REASON_LABELS,
  SystemStatusMode,
} from '../../types';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  Tag,
  Search,
  X,
  Radio,
  Settings,
} from 'lucide-react';

interface MachineMatrixGridProps {
  looms: Record<string, LoomClientState>;
  systemStatus?: SystemStatusMode;
  onSelectLoom: (machineId: string) => void;
  onConfigureLoom?: (
    machineId: string,
    updates: {
      loomNumber?: number;
      family?: string;
      articleName?: string;
      setRpm?: number;
      weftDensity?: number;
    },
  ) => Promise<boolean>;
  onAssignLongStopReason: (
    machineId: string,
    stopId: string | null,
    reasonCode: OperatorReasonCode,
    notes?: string,
    operatorName?: string,
  ) => Promise<boolean>;
}

type FilterState = 'ALL' | 'RUNNING' | 'STOPPED' | 'LONG_STOP';

export const MachineMatrixGrid: React.FC<MachineMatrixGridProps> = ({
  looms,
  systemStatus = 'LOCAL_LAN',
  onSelectLoom,
  onConfigureLoom,
  onAssignLongStopReason,
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

  // Close open modals on Escape key
  useEffect(() => {
    if (!activeLongStopMachine && !configuringMachine) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveLongStopMachine(null);
        setConfiguringMachine(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeLongStopMachine, configuringMachine]);

  // Form states for Configure Loom Modal
  const [configLoomNumber, setConfigLoomNumber] = useState<string>('1');
  const [configFamily, setConfigFamily] = useState('OmniPlus-i');
  const [configArticle, setConfigArticle] = useState('Standard Weave');
  const [configSetRpm, setConfigSetRpm] = useState<string>('874');
  const [configDensity, setConfigDensity] = useState<string>('27.2');
  const [configError, setConfigError] = useState<string | null>(null);
  const [isConfiguring, setIsConfiguring] = useState(false);

  // Form states for Long Stop Declaration
  const [selectedReason, setSelectedReason] = useState<OperatorReasonCode>('KNT');
  const [operatorName, setOperatorName] = useState('Akram Khan (Lead Supervisor)');
  const [stopNotes, setStopNotes] = useState('');
  const [isSubmittingStop, setIsSubmittingStop] = useState(false);

  const openLongStopModal = (loom: LoomClientState) => {
    setSelectedReason(loom.operatorReasonCode ?? 'KNT');
    setStopNotes(loom.operatorReasonNote ?? '');
    setActiveLongStopMachine(loom);
  };

  const openConfigureModal = (loom: LoomClientState) => {
    setConfigLoomNumber(loom.loomNumber !== null ? String(loom.loomNumber) : '');
    setConfigFamily(loom.family || 'OmniPlus-i');
    setConfigArticle(loom.articleName || 'Standard Weave');
    setConfigSetRpm(String(loom.setRpm || 874));
    setConfigDensity(String(loom.weftDensityPicksPerCm || 27.2));
    setConfigError(null);
    setConfiguringMachine(loom);
  };

  const getElapsedMs = (since: string | undefined, nowMs: number): number => {
    if (!since) return 0;
    const parsed = new Date(since).getTime();
    if (Number.isNaN(parsed)) return 0;
    return Math.max(0, nowMs - parsed);
  };

  const rawLoomList = useMemo(() => {
    return Object.values(looms).sort((a, b) => (a.loomNumber ?? 999) - (b.loomNumber ?? 999));
  }, [looms]);

  const runningCount = rawLoomList.filter((l) => l.state === 'RUNNING').length;
  const stoppedCount = rawLoomList.filter((l) => l.state === 'STOPPED').length;
  const longStopCount = rawLoomList.filter((l) => {
    if (l.state !== 'STOPPED') return false;
    const elapsed = getElapsedMs(l.since, currentTime);
    return l.isLongStop || elapsed >= 300000;
  }).length;

  const filteredLooms = useMemo(() => {
    return rawLoomList.filter((loom) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchLoom =
          `loom ${loom.loomNumber ?? ''}`.includes(q) || loom.loomNumber?.toString() === q;
        const matchSerial = loom.machineId.toLowerCase().includes(q);
        if (!matchLoom && !matchSerial) return false;
      }

      if (activeFilter === 'RUNNING') return loom.state === 'RUNNING';
      if (activeFilter === 'STOPPED') return loom.state === 'STOPPED';
      if (activeFilter === 'LONG_STOP') {
        const elapsed = getElapsedMs(loom.since, currentTime);
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
    if (!cat) return 'Unclassified stoppage';
    switch (cat) {
      case 'WARP':
        return 'Warp stop (drop wire)';
      case 'FILLING':
        return 'Filling stop (weft feeder)';
      case 'SELVEDGE':
        return 'Selvedge / leno defect';
      case 'OTHER':
        return 'Manual / other stop';
      default:
        return cat;
    }
  };

  const handleLongStopSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLongStopMachine) return;
    setIsSubmittingStop(true);
    try {
      const ok = await onAssignLongStopReason(
        activeLongStopMachine.machineId,
        activeLongStopMachine.stopId,
        selectedReason,
        stopNotes,
        operatorName,
      );
      if (ok) {
        setActiveLongStopMachine(null);
        setStopNotes('');
      }
    } finally {
      setIsSubmittingStop(false);
    }
  };

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringMachine || !onConfigureLoom) return;
    const parsedNumber = configLoomNumber.trim() ? Number(configLoomNumber) : undefined;
    const parsedRpm = Number(configSetRpm);
    const parsedDensity = Number(configDensity);

    if (
      parsedNumber !== undefined &&
      (!Number.isInteger(parsedNumber) || parsedNumber < 1)
    ) {
      setConfigError('Loom number must be a whole number >= 1.');
      return;
    }
    if (!Number.isFinite(parsedRpm) || parsedRpm < 1 || parsedRpm > 2000) {
      setConfigError('Setpoint RPM must be between 1 and 2000.');
      return;
    }
    if (!Number.isFinite(parsedDensity) || parsedDensity < 1 || parsedDensity > 200) {
      setConfigError('Weft density must be between 1 and 200 p/cm.');
      return;
    }

    setConfigError(null);
    setIsConfiguring(true);
    try {
      const ok = await onConfigureLoom(configuringMachine.machineId, {
        loomNumber: parsedNumber,
        family: configFamily.trim() || undefined,
        articleName: configArticle.trim() || undefined,
        setRpm: parsedRpm,
        weftDensity: parsedDensity,
      });
      if (ok) {
        setConfiguringMachine(null);
      }
    } finally {
      setIsConfiguring(false);
    }
  };

  const emptyStateCopy =
    systemStatus === 'CLOUD_LIVE'
      ? {
          title: 'No Looms Connected',
          description:
            'Cloud ingest is online and waiting for provisioned LDL / WT32-ETH01 loggers over HTTPS. Machines appear automatically once provisioned and sending heartbeats.',
          authHint: '(Authorization: Bearer <device token>)',
          statusDotClass: 'bg-emerald-500',
          statusText: 'Listening for Contract v1 telemetry batches...',
        }
      : systemStatus === 'LOCAL_LAN'
        ? {
            title: 'No Looms Connected',
            description:
              'Local LAN ingest is online and waiting for WT32-ETH01 hardware frames on the shed network. Machines auto-register upon first heartbeat.',
            authHint: '(x-weavesync-key or device token)',
            statusDotClass: 'bg-blue-500',
            statusText: 'Listening for local LAN telemetry frames...',
          }
        : systemStatus === 'CONNECTING'
          ? {
              title: 'Connecting to Cloud Telemetry',
              description:
                'Checking Supabase Cloud for provisioned LDL / WT32-ETH01 loggers and active shift telemetry.',
              authHint: '(Authorization: Bearer <device token>)',
              statusDotClass: 'bg-amber-500',
              statusText: 'Connecting to Supabase Cloud...',
            }
          : {
              title: 'Telemetry Backend Unreachable',
              description:
                'Unable to reach Supabase Cloud or the local LAN ingest endpoint. Check network connectivity and server status.',
              authHint: '(Authorization: Bearer <device token>)',
              statusDotClass: 'bg-red-500',
              statusText: 'Reconnecting to telemetry backend...',
            };

  return (
    <div className="space-y-3">
      {/* Interactive Filter & Search Controls */}
      <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200/90 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 flex-wrap py-0.5">
          <button
            type="button"
            onClick={() => setActiveFilter('ALL')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              activeFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            All ({rawLoomList.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('RUNNING')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'RUNNING'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Running ({runningCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('STOPPED')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeFilter === 'STOPPED'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span>Stopped ({stoppedCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('LONG_STOP')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
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
              aria-label="Search looms by number or machine ID"
              placeholder="Search Loom # or ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
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
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto mb-3 border border-slate-200">
            <Radio size={20} strokeWidth={1.75} />
          </div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-1.5">
            {emptyStateCopy.title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto mb-4 leading-relaxed">
            {emptyStateCopy.description}
          </p>

          <div className="bg-slate-900 text-slate-100 px-3.5 py-2.5 rounded-lg font-mono text-xs inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 max-w-full border border-slate-700">
            <span className="text-blue-400 font-semibold select-none">POST</span>
            <span className="text-emerald-400 select-all">/api/ingest/v1/batch</span>
            <span className="text-slate-400 text-[11px]">{emptyStateCopy.authHint}</span>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs font-mono text-slate-500 mt-4">
            <span className={`w-2 h-2 rounded-full ${emptyStateCopy.statusDotClass}`} />
            <span>{emptyStateCopy.statusText}</span>
          </div>
        </div>
      ) : filteredLooms.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm p-8 text-center max-w-lg mx-auto my-6">
          <p className="text-sm font-medium text-slate-700">No looms match the current filter.</p>
          <button
            type="button"
            onClick={() => {
              setActiveFilter('ALL');
              setSearchQuery('');
            }}
            className="mt-3 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium cursor-pointer hover:bg-slate-800 transition-colors"
          >
            Reset filters
          </button>
        </div>
      ) : (
        /* Machine Matrix Grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3 pb-8">
          {filteredLooms.map((loom) => {
            const isRunning = loom.state === 'RUNNING';
            const isOffline = loom.state === 'OFFLINE';
            const hasDeclaredReason = Boolean(loom.operatorReasonCode);

            const elapsedMs = getElapsedMs(loom.since, currentTime);
            const isLongStop =
              !isRunning && !isOffline && (loom.isLongStop || elapsedMs >= 300000);

            return (
              <div
                key={loom.machineId}
                role="button"
                tabIndex={0}
                onClick={() => onSelectLoom(loom.machineId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectLoom(loom.machineId);
                  }
                }}
                className={`text-left bg-white p-2.5 sm:p-3 rounded-xl border transition-colors duration-150 shadow-sm relative flex flex-col justify-between min-h-[156px] sm:min-h-[172px] cursor-pointer active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 group select-none ${
                  isLongStop && !hasDeclaredReason
                    ? 'border-red-500 ring-2 ring-red-400/80 bg-red-50/70'
                    : isLongStop && hasDeclaredReason
                      ? 'border-amber-400 bg-amber-50/60'
                      : isRunning
                        ? 'border-slate-200 hover:border-slate-400'
                        : isOffline
                          ? 'border-slate-300 bg-slate-100 opacity-75'
                          : 'border-red-200 bg-red-50/30 hover:border-red-400'
                }`}
              >
                {/* Header: Machine Number, Serial ID, and Live Indicator */}
                <div>
                  <div className="flex justify-between items-start mb-0.5">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900 text-sm sm:text-base leading-tight">
                        Loom {loom.loomNumber ?? '—'}
                      </span>
                      <span className="text-[11px] font-mono font-medium text-blue-700 tracking-tight">
                        {loom.machineId}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {loom.isPilotNode && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          Node
                        </span>
                      )}
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          isRunning
                            ? 'bg-emerald-500'
                            : isOffline
                              ? 'bg-slate-400'
                              : 'bg-red-500'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Family & Protocol Pill */}
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 truncate max-w-[90px] sm:max-w-none">
                      {loom.family}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 px-1 py-0.5 rounded bg-slate-50 border border-slate-200">
                      {loom.sources.join(', ')}
                    </span>
                  </div>
                </div>

                {/* Middle Metrics: Efficiency & State */}
                <div className="my-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg sm:text-2xl font-mono font-bold text-slate-900 tracking-tight tabular-nums">
                      {loom.efficiencyPercentage !== null
                        ? `${loom.efficiencyPercentage.toFixed(1)}%`
                        : '—'}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                        isRunning
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60'
                          : isOffline
                            ? 'bg-slate-100 text-slate-600 border-slate-200'
                            : 'bg-red-50 text-red-800 border-red-200/60'
                      }`}
                    >
                      {isRunning
                        ? 'Running'
                        : isOffline
                          ? 'Offline'
                          : loom.stopCategory
                            ? `${loom.stopCategory.charAt(0) + loom.stopCategory.slice(1).toLowerCase()}`
                            : 'Stopped'}
                    </span>
                  </div>

                  {/* Stoppage Status & >5 Minute Long-Stop Stopwatch / Prompt */}
                  {!isRunning && !isOffline && (
                    <div className="mt-1 space-y-1">
                      {isLongStop && !hasDeclaredReason ? (
                        <>
                          <div className="flex items-center justify-between text-[10px] font-semibold text-red-700 bg-red-100/95 border border-red-300 px-1.5 py-0.5 rounded">
                            <span className="flex items-center gap-1">
                              <Clock size={10} className="text-red-600" />
                              <span>Stopped &gt;5m</span>
                            </span>
                            <span className="font-mono tabular-nums font-bold text-red-800">
                              {formatDowntime(elapsedMs)}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLongStopModal(loom);
                            }}
                            className="w-full bg-red-600 hover:bg-red-700 text-white text-[10px] font-semibold py-1.5 px-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <AlertTriangle size={11} />
                            <span>Assign reason (&gt;5m)</span>
                          </button>
                        </>
                      ) : isLongStop && hasDeclaredReason ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLongStopModal(loom);
                          }}
                          title="Click to update declared stop reason"
                          className="w-full text-[10px] font-mono font-semibold text-amber-900 bg-amber-100/90 hover:bg-amber-200/80 border border-amber-300 px-1.5 py-1 rounded flex items-center justify-between truncate cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-1 truncate">
                            <CheckCircle2 size={10} className="text-amber-700 flex-shrink-0" />
                            <span className="truncate">
                              [{loom.operatorReasonCode}]{' '}
                              {OPERATOR_REASON_LABELS[loom.operatorReasonCode!]}
                            </span>
                          </div>
                          <span className="tabular-nums font-semibold text-amber-800 ml-1 flex-shrink-0">
                            ({formatDowntime(elapsedMs)})
                          </span>
                        </button>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-medium text-red-800 bg-red-100/80 border border-red-200 px-1.5 py-0.5 rounded">
                            <div className="flex items-center gap-1 truncate">
                              <AlertTriangle size={10} className="flex-shrink-0 text-red-600" />
                              <span className="truncate">
                                {formatStopCategoryLabel(loom.stopCategory)}
                              </span>
                            </div>
                            <span className="font-mono tabular-nums text-[10px] font-semibold text-red-700 ml-1 flex-shrink-0 flex items-center gap-0.5">
                              <Clock size={9} /> {formatDowntime(elapsedMs)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLongStopModal(loom);
                            }}
                            className="w-full text-[10px] font-medium py-0.5 px-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors"
                          >
                            <Tag size={10} />
                            <span>{hasDeclaredReason ? `Reason: [${loom.operatorReasonCode}]` : 'Assign reason'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer: Live RPM, Configure & Inspect Indicator */}
                <div className="pt-1.5 border-t border-slate-100 flex justify-between items-center text-xs">
                  <div className="font-mono tabular-nums text-slate-700 font-semibold">
                    <span className={isRunning ? 'text-slate-900 font-bold' : 'text-slate-400'}>
                      {loom.rpm}
                    </span>
                    <span className="text-[10px] font-normal text-slate-400 ml-0.5">RPM</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {onConfigureLoom && (
                      <button
                        type="button"
                        aria-label={`Configure ${loom.machineId}`}
                        title="Configure loom parameters"
                        onClick={(e) => {
                          e.stopPropagation();
                          openConfigureModal(loom);
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <Settings size={13} />
                      </button>
                    )}
                    <div className="text-[11px] font-medium text-slate-500 group-hover:text-slate-900 transition-colors">
                      <span>Inspect</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: LONG-STOP OPERATOR DECLARATION */}
      {activeLongStopMachine && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="long-stop-dialog-title"
          onClick={() => setActiveLongStopMachine(null)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto"
          >
            <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-start justify-between gap-2 mb-2 text-slate-900">
              <div className="flex items-center gap-2">
                <Clock className="text-red-600 flex-shrink-0" size={20} />
                <div>
                  <h3
                    id="long-stop-dialog-title"
                    className="text-base sm:text-lg font-semibold leading-tight"
                  >
                    Long-stop declaration ({activeLongStopMachine.machineId})
                  </h3>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Machine {activeLongStopMachine.loomNumber ?? '—'} •{' '}
                    {formatStopCategoryLabel(activeLongStopMachine.stopCategory)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setActiveLongStopMachine(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              Standard operating procedure: stoppages exceeding 5 minutes require an authorized
              supervisor code declaration.
            </p>

            <form onSubmit={handleLongStopSubmit} className="space-y-3 sm:space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Select reason code
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2 text-xs">
                  {(['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS'] as OperatorReasonCode[]).map(
                    (code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setSelectedReason(code)}
                        className={`p-2 rounded-lg border text-left transition-colors cursor-pointer min-h-[44px] ${
                          selectedReason === code
                            ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold ring-2 ring-blue-200'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-mono font-semibold text-xs">[{code}]</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {OPERATOR_REASON_LABELS[code]}
                        </div>
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="operator-name-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Supervisor / operator name
                </label>
                <input
                  id="operator-name-input"
                  type="text"
                  required
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px]"
                />
              </div>

              <div>
                <label
                  htmlFor="stop-notes-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Floor notes / diagnostics
                </label>
                <textarea
                  id="stop-notes-input"
                  rows={2}
                  placeholder="e.g. Warp beam replacement or broken heald frame wire"
                  value={stopNotes}
                  onChange={(e) => setStopNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 sm:p-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setActiveLongStopMachine(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStop}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer min-h-[40px] disabled:opacity-50"
                >
                  {isSubmittingStop ? 'Submitting...' : 'Confirm stop reason'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURE CONNECTED LOOM */}
      {configuringMachine && onConfigureLoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="configure-loom-dialog-title"
          onClick={() => setConfiguringMachine(null)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-2 mb-2 text-slate-900">
              <div className="flex items-center gap-2">
                <Settings className="text-blue-600 flex-shrink-0" size={20} />
                <h3
                  id="configure-loom-dialog-title"
                  className="text-base sm:text-lg font-semibold leading-tight"
                >
                  Configure connected loom
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setConfiguringMachine(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Configure parameters for device {configuringMachine.machineId}.
            </p>

            {configError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {configError}
              </div>
            )}

            <form onSubmit={handleConfigSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="config-loom-number"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Loom number
                  </label>
                  <input
                    id="config-loom-number"
                    type="number"
                    min={1}
                    value={configLoomNumber}
                    onChange={(e) => setConfigLoomNumber(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-semibold min-h-[40px] text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="config-loom-family"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Family
                  </label>
                  <input
                    id="config-loom-family"
                    type="text"
                    value={configFamily}
                    onChange={(e) => setConfigFamily(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-medium text-slate-900 min-h-[40px]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="config-loom-article"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Article name
                </label>
                <input
                  id="config-loom-article"
                  type="text"
                  value={configArticle}
                  onChange={(e) => setConfigArticle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-medium text-slate-900 min-h-[40px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="config-loom-rpm"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Setpoint RPM
                  </label>
                  <input
                    id="config-loom-rpm"
                    type="number"
                    min={1}
                    max={2000}
                    value={configSetRpm}
                    onChange={(e) => setConfigSetRpm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-semibold min-h-[40px] text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="config-loom-density"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Weft density (p/cm)
                  </label>
                  <input
                    id="config-loom-density"
                    type="number"
                    step="0.1"
                    min={1}
                    max={200}
                    value={configDensity}
                    onChange={(e) => setConfigDensity(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-mono font-semibold min-h-[40px] text-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setConfiguringMachine(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConfiguring}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer min-h-[40px] disabled:opacity-50"
                >
                  {isConfiguring ? 'Saving...' : 'Save configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
