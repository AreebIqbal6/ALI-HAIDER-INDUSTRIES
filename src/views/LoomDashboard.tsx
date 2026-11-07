"use client";
import React, { useState } from 'react';
import { useTelemetry } from '../contexts/TelemetryContext';
import { 
  ArrowLeft, 
  Activity, 
  Cloud, 
  List, 
  Cpu, 
  Gauge, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Tag,
  Zap
} from 'lucide-react';
import { SensorDashboard } from '../components/omniplus/SensorDashboard';
import { ClimateMonitoring } from '../components/omniplus/ClimateMonitoring';
import { ActionCenter } from '../components/omniplus/ActionCenter';
import { HardwarePinInspector } from '../components/omniplus/HardwarePinInspector';
import { OPERATOR_REASON_LABELS } from '../types';

type Tab = 'subsystems' | 'hardware' | 'sensors' | 'climate' | 'logs';

export const LoomDashboard: React.FC = () => {
  const { 
    looms, 
    selectedMachineId, 
    setSelectedMachineId, 
    acknowledgeStop, 
    shiftKpis 
  } = useTelemetry();

  const [activeTab, setActiveTab] = useState<Tab>('subsystems');

  const loom = selectedMachineId !== 'GLOBAL' ? looms[selectedMachineId] : null;

  if (!loom) {
    return (
      <div className="p-6 sm:p-8 text-center text-slate-800 flex flex-col items-center justify-center min-h-[50vh]">
        <p className="mb-4 font-semibold text-sm">No machine selected or machine not found on bus.</p>
        <button
          onClick={() => setSelectedMachineId('GLOBAL')}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer shadow-sm active:scale-95"
        >
          Return to 36-Machine Matrix
        </button>
      </div>
    );
  }

  const isRunning = loom.state === 'RUNNING';
  const isStopped = loom.state === 'STOPPED';

  const formatStopCategory = (cat: string | null) => {
    switch (cat) {
      case 'WARP': return 'Warp Drop Wire Contact (TSF Load-Cell Break)';
      case 'FILLING': return 'Weft Optical Detector FD1 (Arrival Failure)';
      case 'SELVEDGE': return 'ELSY Leno Selvedge Break';
      case 'OTHER': return 'Other Mechanical / Air Stoppage';
      default: return 'Machine Operating Normally';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-56px)] bg-[#e8ebf0]">
      {/* Top Breadcrumb & Inspection Header (Mobile-Optimized) */}
      <div className="bg-white border-b border-slate-300 px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={() => setSelectedMachineId('GLOBAL')}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            <ArrowLeft size={15} />
            <span className="hidden xs:inline">Fleet</span> Grid
          </button>

          <div className="h-5 w-px bg-slate-200 hidden xs:block" />

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-none">
              Loom #{loom.loomNumber}
            </h1>
            <span className="text-[11px] sm:text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              {loom.machineId}
            </span>
            <span className="text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              {loom.family}
            </span>
            <span className="text-[9px] sm:text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              {loom.sources.join('+')}
            </span>
          </div>
        </div>

        {/* Live Status Pill & Safe Acknowledge Action */}
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          <div className={`px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-extrabold flex items-center gap-1.5 ${
            isRunning 
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' 
              : 'bg-red-50 text-red-800 border border-red-300 animate-pulse'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span>{isRunning ? 'RUNNING' : `STOPPED: ${loom.stopCategory || 'UNKNOWN'}`}</span>
          </div>

          {!isRunning && (
            <button
              onClick={() => acknowledgeStop(loom.machineId)}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg text-[11px] sm:text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              Acknowledge
            </button>
          )}

          <div className="text-[10px] font-mono text-slate-400 hidden lg:block">
            {loom.setRpm} RPM Set • {loom.weftDensityPicksPerCm} p/cm • {loom.ipAddress}
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs (Horizontal Swipe on Phone) */}
      <div className="bg-white px-2 sm:px-4 border-b border-slate-200 flex gap-1 sm:gap-2 overflow-x-auto scrollbar-none py-1">
        <button
          onClick={() => setActiveTab('subsystems')}
          className={`flex items-center gap-1.5 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'subsystems'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Cpu size={15} />
          <span>Subsystems</span>
        </button>
        <button
          onClick={() => setActiveTab('hardware')}
          className={`flex items-center gap-1.5 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'hardware'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100'
          }`}
        >
          <Zap size={15} className={activeTab === 'hardware' ? 'text-white' : 'text-amber-600'} />
          <span>XP_CBMP_P9 Pin Inspector</span>
        </button>
        <button
          onClick={() => setActiveTab('sensors')}
          className={`flex items-center gap-1.5 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'sensors'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Activity size={15} />
          <span>Sensors & Dynamics</span>
        </button>
        <button
          onClick={() => setActiveTab('climate')}
          className={`flex items-center gap-1.5 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'climate'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Cloud size={15} />
          <span>Shed Climate</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-1.5 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'logs'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <List size={15} />
          <span>Logbook & Dispatch</span>
        </button>
      </div>

      {/* Main Tab Views */}
      <div className="flex-1 overflow-y-auto overscroll-y-contain p-2.5 sm:p-5">
        {activeTab === 'subsystems' && (
          <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto">
            {/* Stoppage Banner with Long Stop Declaration info */}
            {isStopped && (
              <div className="p-3 sm:p-4 bg-red-100/90 border border-red-300 rounded-xl sm:rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={18} />
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-red-900 leading-tight">
                      Active Stoppage: {loom.stopCategory || 'WARP'}
                    </h3>
                    <p className="text-[11px] text-red-800 mt-0.5">
                      Triggered Cause: <strong>{formatStopCategory(loom.stopCategory)}</strong>. Since: {new Date(loom.since).toLocaleTimeString()}.
                    </p>
                  </div>
                </div>

                {loom.operatorReasonCode ? (
                  <div className="self-start sm:self-auto px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-[11px] font-mono font-bold text-amber-900 flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-amber-700" />
                    <span>[{loom.operatorReasonCode}] {OPERATOR_REASON_LABELS[loom.operatorReasonCode]}</span>
                  </div>
                ) : loom.isLongStop ? (
                  <div className="self-start sm:self-auto flex items-center gap-1.5 text-xs font-bold text-red-700 animate-pulse">
                    <Tag size={14} />
                    <span>Long Stop (&gt;5m) - Reason Required</span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Quick KPI Overview (Section 11 Verified Formulas) - 2x2 on Mobile */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Pick Rate (RPM)
                </span>
                <div className="text-xl sm:text-3xl font-black font-mono tabular-nums text-slate-900 mt-0.5">
                  {loom.rpm}
                </div>
                <span className="text-[9px] sm:text-[10px] text-slate-400 block mt-0.5">
                  Rated: {loom.setRpm} Max
                </span>
              </div>

              <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Efficiency
                </span>
                <div className="text-xl sm:text-3xl font-black font-mono tabular-nums text-emerald-600 mt-0.5">
                  {loom.efficiencyPercentage.toFixed(1)}%
                </div>
                <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono block mt-0.5">
                  Run: {(loom.runMsShift / 3600000).toFixed(1)}h
                </span>
              </div>

              <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Metres Woven
                </span>
                <div className="text-xl sm:text-3xl font-black font-mono tabular-nums text-slate-900 mt-0.5">
                  {loom.metresWoven.toFixed(1)} m
                </div>
                <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono block mt-0.5">
                  {loom.picksDeltaShift.toLocaleString()} picks
                </span>
              </div>

              <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-sm">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  CMPX (Stops/10⁵)
                </span>
                <div className="text-xl sm:text-3xl font-black font-mono tabular-nums text-slate-900 mt-0.5">
                  {loom.cmpx.toFixed(2)}
                </div>
                <span className="text-[9px] sm:text-[10px] text-slate-400 block mt-0.5">
                  Warp: {loom.stopsShift.WARP} | Weft: {loom.stopsShift.FILLING}
                </span>
              </div>
            </div>

            {/* Live XP_CBMP_P9 Optocoupler Pin Inspector */}
            <HardwarePinInspector loom={loom} />

            {/* Subsystem Hardware Diagnostics Matrix */}
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-3.5 sm:p-5 shadow-sm">
              <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                <Cpu size={16} className="text-blue-600" />
                <span>Picanol Subsystem Diagnostics</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3.5">
                {/* Sumo Motor */}
                <div className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-700">Sumo Main Motor</span>
                    <span className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                      <CheckCircle2 size={11} /> {loom.subsystems.sumoMotorStatus}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Direct-drive switched reluctance drive with dynamic brake.</p>
                </div>

                {/* ELO Electronic Let-Off */}
                <div className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-700">ELO Warp Tension</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums text-xs sm:text-sm">
                      {loom.warpTensionKn.toFixed(2)} kN
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">TSF load-cell feedback. Target range: 1.70 - 2.20 kN.</p>
                </div>

                {/* Air-Jet Main Line Pressure */}
                <div className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-700">Air-Jet Nozzle Line</span>
                    <span className={`font-mono font-bold tabular-nums text-xs sm:text-sm ${
                      loom.airPressureBar < 6.5 ? 'text-red-600 font-black' : 'text-slate-900'
                    }`}>
                      {loom.airPressureBar.toFixed(2)} Bar
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Supply line for insertion nozzles (Critical min: 6.5 Bar).</p>
                </div>

                {/* Optical Weft Detectors FD1 / FD2 */}
                <div className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-700">Weft Sensor FD1 (Arrival)</span>
                    <span className={`inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded ${
                      loom.subsystems.fd1Detector === 'OK' 
                        ? 'text-emerald-700 bg-emerald-100' 
                        : 'text-red-700 bg-red-100'
                    }`}>
                      <CheckCircle2 size={11} />
                      {loom.subsystems.fd1Detector}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Photoelectric eye checking pick arrival at right selvedge.</p>
                </div>

                <div className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-700">Weft Sensor FD2 (Clamping)</span>
                    <span className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                      <CheckCircle2 size={11} /> {loom.subsystems.fd2Detector}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Secondary optical sensor detecting broken or loose pick tails.</p>
                </div>

                {/* Relay Nozzle Buffer Tanks */}
                <div className="p-3 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-200/90">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-700">Relay Buffer Tanks</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums text-xs sm:text-sm">
                      {loom.subsystems.leftRelayBar} / {loom.subsystems.rightRelayBar} Bar
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Intermediate air buffer tanks powering relay nozzle valves.</p>
                </div>
              </div>
            </div>

            {/* Current Shift Downtime Logs */}
            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-3.5 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Clock size={16} className="text-slate-500" />
                  <span>Shift Downtime Log ({loom.machineId})</span>
                </h3>
                <span className="text-[10px] font-mono text-slate-400">{shiftKpis.shift.name}</span>
              </div>

              <div className="overflow-x-auto scrollbar-none -mx-3.5 sm:mx-0 px-3.5 sm:px-0">
                <table className="w-full text-left text-xs min-w-[500px]">
                  <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-[9px] border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-2.5">Time</th>
                      <th className="py-2 px-2.5">Category</th>
                      <th className="py-2 px-2.5">Duration</th>
                      <th className="py-2 px-2.5">Reason Code</th>
                      <th className="py-2 px-2.5">Action Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    <tr>
                      <td className="py-2.5 px-2.5 font-mono text-slate-600">14:22:10</td>
                      <td className="py-2.5 px-2.5 font-bold text-red-600">WARP (Drop Wire)</td>
                      <td className="py-2.5 px-2.5 font-mono">01m 45s</td>
                      <td className="py-2.5 px-2.5 font-mono text-slate-700">[ART] Article Setup</td>
                      <td className="py-2.5 px-2.5 text-emerald-700 font-semibold">Tied by Weaver</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-2.5 font-mono text-slate-600">11:05:44</td>
                      <td className="py-2.5 px-2.5 font-bold text-amber-600">FILLING (Weft FD1)</td>
                      <td className="py-2.5 px-2.5 font-mono">00m 52s</td>
                      <td className="py-2.5 px-2.5 font-mono text-slate-500">-</td>
                      <td className="py-2.5 px-2.5 text-slate-600">Feeder Cleared</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-2.5 font-mono text-slate-600">09:18:02</td>
                      <td className="py-2.5 px-2.5 font-bold text-slate-700">OTHER (Manual)</td>
                      <td className="py-2.5 px-2.5 font-mono">03m 10s</td>
                      <td className="py-2.5 px-2.5 font-mono text-slate-500">-</td>
                      <td className="py-2.5 px-2.5 text-emerald-700 font-semibold">Selvedge check OK</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'hardware' && (
          <div className="max-w-5xl mx-auto">
            <HardwarePinInspector loom={loom} />
          </div>
        )}
        {activeTab === 'sensors' && <SensorDashboard machineId={loom.machineId} />}
        {activeTab === 'climate' && <ClimateMonitoring />}
        {activeTab === 'logs' && <ActionCenter machineId={loom.machineId} loomNumber={loom.loomNumber} />}
      </div>
    </div>
  );
};
