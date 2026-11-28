"use client";
import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTelemetry } from '../contexts/TelemetryContext';
import { Radio } from 'lucide-react';

export const AnalyticsDashboard: React.FC = () => {
  const { looms, shiftKpis, systemStatus } = useTelemetry();

  const totalLooms = shiftKpis.totalLoomsCount;
  const hasConnectedLooms = totalLooms > 0;
  const loomsList = useMemo(() => Object.values(looms), [looms]);

  const paretoData = useMemo(() => {
    if (!hasConnectedLooms) return [];
    const warpCount = shiftKpis.stopsByCategory?.WARP || 0;
    const fillingCount = shiftKpis.stopsByCategory?.FILLING || 0;
    const selvedgeCount = shiftKpis.stopsByCategory?.SELVEDGE || 0;
    const otherCount = shiftKpis.stopsByCategory?.OTHER || 0;
    const totalStopMs = loomsList.reduce((acc, l) => acc + (l.stopMsShift || 0), 0);
    const totalStops = warpCount + fillingCount + selvedgeCount + otherCount;
    const exactMttrMins = totalStops > 0 && totalStopMs > 0 ? totalStopMs / 60000 / totalStops : 0;

    return [
      { reason: 'Warp (Drop Wire)', stops: warpCount, minutes: Math.round(warpCount * exactMttrMins) },
      { reason: 'Weft (Filling)', stops: fillingCount, minutes: Math.round(fillingCount * exactMttrMins) },
      { reason: 'Selvedge (Leno)', stops: selvedgeCount, minutes: Math.round(selvedgeCount * exactMttrMins) },
      { reason: 'Other / Mechanical', stops: otherCount, minutes: Math.round(otherCount * exactMttrMins) },
    ];
  }, [hasConnectedLooms, loomsList, shiftKpis.stopsByCategory]);

  const totalMinutesLost = useMemo(() => {
    return paretoData.reduce((acc, curr) => acc + curr.minutes, 0);
  }, [paretoData]);

  const availabilityPct = useMemo(() => {
    if (!hasConnectedLooms || totalLooms === 0) return null;
    const totalRunMs = loomsList.reduce((acc, l) => acc + (l.runMsShift || 0), 0);
    const totalStopMs = loomsList.reduce((acc, l) => acc + (l.stopMsShift || 0), 0);
    const observedMs = totalRunMs + totalStopMs;
    if (observedMs > 0) {
      return Number(((totalRunMs / observedMs) * 100).toFixed(1));
    }
    return Number(((shiftKpis.activeLoomsCount / totalLooms) * 100).toFixed(1));
  }, [hasConnectedLooms, loomsList, shiftKpis.activeLoomsCount, totalLooms]);

  const performancePct = useMemo(() => {
    if (!hasConnectedLooms || shiftKpis.averageRpm <= 0) return null;
    const runningLooms = loomsList.filter((l) => l.state === 'RUNNING');
    const pool = runningLooms.length > 0 ? runningLooms : loomsList;
    const avgSetRpm =
      pool.reduce((acc, l) => acc + (l.setRpm > 0 ? l.setRpm : 874), 0) / Math.max(1, pool.length);
    return Number(Math.min(100, (shiftKpis.averageRpm / avgSetRpm) * 100).toFixed(1));
  }, [hasConnectedLooms, loomsList, shiftKpis.averageRpm]);

  const emptyCopy =
    systemStatus === 'CLOUD_LIVE'
      ? {
          description:
            'Zero physical hardware units are currently transmitting telemetry. Connect a provisioned LDL or WT32-ETH01 logger over HTTPS (Contract v1) to record shift production, OEE ratios, and downtime Pareto metrics.',
          endpointNote: 'Listening for Contract v1 batches on /api/ingest/v1/batch',
          dotClass: 'bg-emerald-500',
        }
      : systemStatus === 'LOCAL_LAN'
        ? {
            description:
              'Zero physical hardware units are currently transmitting telemetry. Connect a WT32-ETH01 hardware node or Edge Gateway on the local LAN to record shift production, OEE ratios, and downtime Pareto metrics.',
            endpointNote: 'Listening for local LAN frames on /api/ingest/v1/batch',
            dotClass: 'bg-blue-500',
          }
        : systemStatus === 'CONNECTING'
          ? {
              description:
                'Connecting to Supabase Cloud to load provisioned hardware units, active shift counters, and OEE metrics.',
              endpointNote: 'Connecting to Supabase Cloud...',
              dotClass: 'bg-amber-500',
            }
          : {
              description:
                'Telemetry backend is currently unreachable. Reconnect to Supabase Cloud or the local LAN server to view live shift production and OEE metrics.',
              endpointNote: 'Reconnecting to /api/ingest/v1/batch',
              dotClass: 'bg-red-500',
            };

  return (
    <div className="p-2.5 sm:p-5 space-y-3.5 sm:space-y-5 h-[calc(100dvh-56px)] overflow-y-auto overscroll-y-contain bg-[#e8ebf0]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight leading-tight">
            Shift Production Analytics &amp; OEE
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {shiftKpis.shift.name} •{' '}
            {hasConnectedLooms
              ? `${totalLooms} connected machine${totalLooms > 1 ? 's' : ''}`
              : 'No looms connected'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-200/90 text-xs font-medium text-slate-700 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-slate-900 font-semibold">{shiftKpis.shift.name}</span>
          </div>
        </div>
      </div>

      {/* Shift KPI Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Shift efficiency</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums block mt-1">
            {shiftKpis.averageEfficiency !== null
              ? `${shiftKpis.averageEfficiency.toFixed(1)}%`
              : '—'}
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Target: 92.0%</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Average speed</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums block mt-1">
            {hasConnectedLooms ? `${shiftKpis.averageRpm} RPM` : '—'}
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Picks / run minute</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Shift output</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums block mt-1">
            {hasConnectedLooms ? `${shiftKpis.totalMetresWoven.toLocaleString()} m` : '—'}
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Meters woven</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">Stop frequency</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums block mt-1">
            {hasConnectedLooms ? shiftKpis.cmpxAverage.toFixed(2) : '—'}
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">CMPX (stops/10⁵)</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">MTBF</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums block mt-1">
            {hasConnectedLooms && shiftKpis.mtbfMinutes > 0 ? `${shiftKpis.mtbfMinutes}m` : '—'}
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Mean run between stops</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm">
          <span className="text-xs font-medium text-slate-500 block">MTTR</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums block mt-1">
            {hasConnectedLooms && shiftKpis.mttrMinutes > 0 ? `${shiftKpis.mttrMinutes}m` : '—'}
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Mean repair duration</span>
        </div>
      </div>

      {!hasConnectedLooms ? (
        /* Honest Industrial Empty State */
        <div className="bg-white rounded-xl border border-slate-200/90 p-8 sm:p-12 text-center shadow-sm max-w-2xl mx-auto my-8">
          <div className="w-12 h-12 bg-slate-100 text-slate-700 border border-slate-200 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Radio size={20} strokeWidth={1.75} />
          </div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
            No Looms Connected
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
            {emptyCopy.description}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-mono text-slate-700">
            <span className={`w-2 h-2 rounded-full ${emptyCopy.dotClass}`} />
            <span>{emptyCopy.endpointNote}</span>
          </div>
        </div>
      ) : (
        <>
          {/* Top Analytics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
            {/* OEE Score Dial */}
            <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-sm flex flex-col items-center justify-between min-h-[240px]">
              <div className="w-full flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-700">Equipment effectiveness</h2>
                <span className="text-[11px] font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  {shiftKpis.averageEfficiency !== null && shiftKpis.averageEfficiency >= 85
                    ? 'Target met'
                    : 'Operational'}
                </span>
              </div>

              <div
                className={`my-3 relative w-32 h-32 sm:w-36 sm:h-36 rounded-full border-[8px] sm:border-[10px] flex flex-col items-center justify-center bg-slate-50 ${
                  shiftKpis.averageEfficiency === null
                    ? 'border-slate-300'
                    : shiftKpis.averageEfficiency >= 85
                      ? 'border-emerald-500'
                      : 'border-amber-500'
                }`}
              >
                <span className="text-3xl sm:text-4xl font-bold text-slate-900 font-mono tabular-nums">
                  {shiftKpis.averageEfficiency !== null
                    ? `${shiftKpis.averageEfficiency.toFixed(1)}%`
                    : '—'}
                </span>
                <span className="text-[11px] font-medium text-slate-500">Shift efficiency</span>
              </div>

              <div className="w-full grid grid-cols-3 gap-1 pt-2.5 border-t border-slate-100 text-center font-mono">
                <div>
                  <div className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums">
                    {availabilityPct !== null ? `${availabilityPct}%` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-500 font-sans font-medium">
                    Availability
                  </div>
                </div>
                <div>
                  <div className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums">
                    {performancePct !== null ? `${performancePct}%` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-500 font-sans font-medium">
                    Performance
                  </div>
                </div>
                <div>
                  <div className="text-xs sm:text-sm font-bold text-slate-800 tabular-nums">
                    100.0%
                  </div>
                  <div className="text-[10px] text-slate-500 font-sans font-medium">Quality</div>
                </div>
              </div>
            </div>

            {/* Downtime Pareto Chart */}
            <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-sm col-span-1 md:col-span-2 min-h-[240px] flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-slate-700">
                  Downtime Pareto: minutes lost ({totalLooms} machine{totalLooms > 1 ? 's' : ''})
                </h2>
                <span className="text-xs font-mono text-slate-500">
                  Total: {totalMinutesLost} min
                </span>
              </div>

              {totalMinutesLost === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                  <span className="text-xs font-medium">
                    Zero downtime minutes recorded for this shift.
                  </span>
                </div>
              ) : (
                <div className="flex-1 w-full min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={paretoData} margin={{ top: 5, right: 10, left: -25, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis
                        dataKey="reason"
                        stroke="#64748b"
                        fontSize={9}
                        tickLine={false}
                        interval={0}
                        angle={-15}
                        textAnchor="end"
                      />
                      <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <RechartsTooltip
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{
                          borderRadius: '8px',
                          border: '1px solid #e2e8f0',
                          fontSize: '11px',
                        }}
                      />
                      <Bar
                        dataKey="minutes"
                        name="Minutes Lost"
                        fill="#475569"
                        radius={[4, 4, 0, 0]}
                        barSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Connected Fleet Production Summary Table */}
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs sm:text-sm font-semibold text-slate-800">
                Live machine telemetry breakdown
              </h2>
              <span className="text-xs font-mono text-slate-500">
                {loomsList.length} connected
              </span>
            </div>

            <div className="overflow-x-auto scrollbar-none">
              <table className="w-full text-left text-xs min-w-[600px]">
                <thead className="bg-slate-50 text-slate-600 font-medium text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Loom</th>
                    <th className="py-2.5 px-3">Hardware ID</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Speed (RPM)</th>
                    <th className="py-2.5 px-3">Shift efficiency</th>
                    <th className="py-2.5 px-3">Fabric output</th>
                    <th className="py-2.5 px-3">Total picks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium font-mono text-slate-700">
                  {loomsList.map((loom) => {
                    const isRunning = loom.state === 'RUNNING';
                    const isOffline = loom.state === 'OFFLINE';
                    return (
                      <tr key={loom.machineId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 font-sans">
                          Loom #{loom.loomNumber ?? '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">{loom.machineId}</td>
                        <td className="py-2.5 px-3 font-sans">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${
                              isRunning
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : isOffline
                                  ? 'bg-slate-100 text-slate-600 border border-slate-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isRunning
                                  ? 'bg-emerald-500'
                                  : isOffline
                                    ? 'bg-slate-400'
                                    : 'bg-red-500'
                              }`}
                            />
                            {isRunning ? 'Running' : isOffline ? 'Offline' : 'Stopped'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900 tabular-nums">
                          {loom.rpm} RPM
                        </td>
                        <td
                          className={`py-2.5 px-3 font-semibold tabular-nums ${
                            loom.efficiencyPercentage === null
                              ? 'text-slate-500'
                              : loom.efficiencyPercentage >= 85
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {loom.efficiencyPercentage !== null
                            ? `${loom.efficiencyPercentage.toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 tabular-nums">
                          {loom.metresWoven.toFixed(1)} m
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 tabular-nums">
                          {(loom.picksDeltaShift || loom.picksTotal).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
