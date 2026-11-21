"use client";
import React, { useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer 
} from 'recharts';
import { useTelemetry } from '../contexts/TelemetryContext';
import { BarChart3, Clock, ArrowLeft, Radio } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import Link from 'next/link';

export const AnalyticsDashboard: React.FC = () => {
  const { shiftKpis, looms } = useTelemetry();

  const loomList = useMemo(() => {
    return Object.values(looms).sort((a, b) => (a.loomNumber ?? 999) - (b.loomNumber ?? 999));
  }, [looms]);

  const hasData = loomList.length > 0 && (shiftKpis.totalPicks > 0 || shiftKpis.totalStops > 0);

  // Downtime categories strictly compiled from real records
  const downtimeData = useMemo(() => {
    if (!hasData) return [];
    return [
      { category: 'Warp Stop', count: shiftKpis.stopsByCategory.WARP },
      { category: 'Weft / Filling', count: shiftKpis.stopsByCategory.FILLING },
      { category: 'Selvedge', count: shiftKpis.stopsByCategory.SELVEDGE },
      { category: 'Other Mechanical', count: shiftKpis.stopsByCategory.OTHER },
    ];
  }, [hasData, shiftKpis.stopsByCategory]);

  return (
    <div className="p-4 sm:p-6 min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-950 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-zinc-700" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-950">
              Shift Production Analytics
            </h1>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Real-time aggregate production performance for {shiftKpis.shift.name}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Badge variant="outline" className="bg-white font-mono text-xs">
            {shiftKpis.shift.name}
          </Badge>
          <Link href="/">
            <Button variant="outline" size="sm" className="text-xs">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Floor Overview
            </Button>
          </Link>
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3.5 bg-white border-zinc-200">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block">Shift Efficiency</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-zinc-950 tabular-nums block mt-1">
            {shiftKpis.averageEfficiency !== null ? `${shiftKpis.averageEfficiency.toFixed(1)}%` : '—'}
          </span>
          <span className="text-[10px] text-zinc-400 block mt-0.5">Runtime / Total</span>
        </Card>

        <Card className="p-3.5 bg-white border-zinc-200">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block">Running Speed</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-zinc-950 tabular-nums block mt-1">
            {shiftKpis.averageRpm > 0 ? `${shiftKpis.averageRpm} RPM` : '—'}
          </span>
          <span className="text-[10px] text-zinc-400 block mt-0.5">Fleet Average</span>
        </Card>

        <Card className="p-3.5 bg-white border-zinc-200">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block">Total Meters</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-zinc-950 tabular-nums block mt-1">
            {shiftKpis.totalMetresWoven.toFixed(1)} m
          </span>
          <span className="text-[10px] text-zinc-400 block mt-0.5">Cloth Woven</span>
        </Card>

        <Card className="p-3.5 bg-white border-zinc-200">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block">CMPX (Stops/10⁵)</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-zinc-950 tabular-nums block mt-1">
            {shiftKpis.cmpxAverage > 0 ? shiftKpis.cmpxAverage.toFixed(2) : '—'}
          </span>
          <span className="text-[10px] text-zinc-400 block mt-0.5">Stop Rate</span>
        </Card>

        <Card className="p-3.5 bg-white border-zinc-200">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block">MTBF</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-zinc-950 tabular-nums block mt-1">
            {shiftKpis.mtbfMinutes > 0 ? `${shiftKpis.mtbfMinutes.toFixed(1)} m` : '—'}
          </span>
          <span className="text-[10px] text-zinc-400 block mt-0.5">Mean Time Between</span>
        </Card>

        <Card className="p-3.5 bg-white border-zinc-200">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block">Total Stops</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-zinc-950 tabular-nums block mt-1">
            {shiftKpis.totalStops}
          </span>
          <span className="text-[10px] text-zinc-400 block mt-0.5">Recorded Stoppages</span>
        </Card>
      </div>

      {/* Downtime Breakdown Section */}
      <Card className="p-5 bg-white border-zinc-200">
        <CardHeader className="p-0 pb-4 mb-4 border-b border-zinc-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-zinc-950">
              Shift Stoppages by Category
            </CardTitle>
            <p className="text-xs text-zinc-500 mt-0.5">
              Physical root causes detected via XP_CBMP_P9 optocoupler inputs
            </p>
          </div>
        </CardHeader>

        {hasData && downtimeData.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={downtimeData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis 
                  dataKey="category" 
                  tick={{ fontSize: 12, fill: '#71717a' }} 
                  axisLine={{ stroke: '#e4e4e7' }} 
                  tickLine={false} 
                />
                <YAxis 
                  tick={{ fontSize: 12, fill: '#71717a' }} 
                  axisLine={{ stroke: '#e4e4e7' }} 
                  tickLine={false} 
                  allowDecimals={false}
                />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e4e4e7', borderRadius: '6px', fontSize: '12px' }} 
                />
                <Bar dataKey="count" fill="#18181b" radius={[4, 4, 0, 0]} name="Stops Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-12 text-center text-zinc-500">
            <Radio className="h-8 w-8 mx-auto mb-2 text-zinc-400" />
            <p className="text-sm font-medium text-zinc-700">No production data recorded for this shift yet</p>
            <p className="text-xs text-zinc-400 mt-1">Stoppage charts will render when machines transmit shift pulses.</p>
          </div>
        )}
      </Card>

      {/* Machine Performance Table */}
      <Card className="p-5 bg-white border-zinc-200">
        <CardHeader className="p-0 pb-4 mb-4 border-b border-zinc-100">
          <CardTitle className="text-sm font-semibold text-zinc-950">
            Individual Machine Shift Performance
          </CardTitle>
        </CardHeader>

        {loomList.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200 font-medium">
                <tr>
                  <th className="py-2.5 px-3">Loom #</th>
                  <th className="py-2.5 px-3">Machine ID</th>
                  <th className="py-2.5 px-3">Model</th>
                  <th className="py-2.5 px-3">Article</th>
                  <th className="py-2.5 px-3 text-right">Speed</th>
                  <th className="py-2.5 px-3 text-right">Efficiency</th>
                  <th className="py-2.5 px-3 text-right">Shift Meters</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-mono">
                {loomList.map(l => (
                  <tr key={l.machineId} className="hover:bg-zinc-50/50">
                    <td className="py-2.5 px-3 font-semibold font-sans text-zinc-950">
                      {l.loomNumber ? `Loom ${l.loomNumber}` : 'Unassigned'}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600">{l.machineId}</td>
                    <td className="py-2.5 px-3 font-sans text-zinc-700">{l.family}</td>
                    <td className="py-2.5 px-3 font-sans text-zinc-600">{l.articleName || 'Standard'}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-zinc-900">{l.rpm} RPM</td>
                    <td className="py-2.5 px-3 text-right text-zinc-900">{l.efficiencyPercentage.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right text-zinc-900">{l.metresWoven.toFixed(1)} m</td>
                    <td className="py-2.5 px-3 text-center font-sans">
                      <Badge variant={l.state === 'RUNNING' ? 'running' : l.state === 'STOPPED' ? 'stopped' : 'offline'}>
                        {l.state}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-zinc-500 text-xs">
            No looms registered on the factory network.
          </div>
        )}
      </Card>
    </div>
  );
};
