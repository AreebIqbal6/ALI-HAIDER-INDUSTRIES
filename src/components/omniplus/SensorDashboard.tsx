"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { useTelemetry } from '../../contexts/TelemetryContext';

interface SensorDashboardProps {
  machineId?: string;
}

export const SensorDashboard: React.FC<SensorDashboardProps> = ({ machineId }) => {
  const { looms, selectedMachineId, ambient } = useTelemetry();
  const effectiveId = machineId || (selectedMachineId !== 'GLOBAL' ? selectedMachineId : 'PIC-427708');
  const loom = looms[effectiveId] || Object.values(looms)[0] || null;

  const efficiencyTrendData = useMemo(() => {
    const eff = loom ? loom.efficiencyPercentage : 92.5;
    return [
      { time: '08:00', efficiency: Number(Math.max(78, eff - 2.8).toFixed(1)), target: 90 },
      { time: '10:00', efficiency: Number(Math.max(80, eff - 1.2).toFixed(1)), target: 90 },
      { time: '12:00', efficiency: Number(Math.max(80, eff - 2.5).toFixed(1)), target: 90 },
      { time: '14:00', efficiency: Number(Math.min(99, eff + 1.1).toFixed(1)), target: 90 },
      { time: '16:00', efficiency: Number(Math.min(99, eff + 0.8).toFixed(1)), target: 90 },
      { time: '18:00', efficiency: Number(eff.toFixed(1)), target: 90 },
      { time: '20:00', efficiency: Number(eff.toFixed(1)), target: 90 },
    ];
  }, [loom?.efficiencyPercentage]);

  const stopsData = useMemo(() => {
    const warp = loom ? loom.stopsShift.WARP : 1;
    const filling = loom ? loom.stopsShift.FILLING : 1;
    const selvedge = loom ? loom.stopsShift.SELVEDGE : 0;
    return [
      { time: '08:00–11:00', warp: Math.max(0, Math.floor(warp / 2)), weft_fd1: Math.max(0, Math.floor(filling / 2)), weft_fd2: 0, selvedge: 0 },
      { time: '11:00–14:00', warp: Math.ceil(warp / 2), weft_fd1: 0, weft_fd2: Math.max(0, Math.floor(filling / 2)), selvedge },
      { time: '14:00–17:00', warp: 0, weft_fd1: Math.ceil(filling / 2), weft_fd2: 0, selvedge: 0 },
      { time: '17:00–20:00', warp: 0, weft_fd1: 0, weft_fd2: 0, selvedge: 0 },
    ];
  }, [loom?.stopsShift]);

  const baseRpm = loom ? loom.rpm : 0;
  const isStopped = !loom || loom.state === 'STOPPED' || loom.state === 'OFFLINE' || baseRpm === 0;

  const [displayAirConsumption, setDisplayAirConsumption] = useState(74.4);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (!isStopped && baseRpm > 0) {
      interval = setInterval(() => {
        // Air consumption micro-oscillation around 74.4 Nm3/h
        setDisplayAirConsumption(74.4 + (Math.random() * 0.8 - 0.4));
      }, 500);
    } else {
      setDisplayAirConsumption(0);
    }
    return () => clearInterval(interval);
  }, [baseRpm, isStopped]);

  const warpTensionVal = loom?.warpTensionKn ?? 1.92;
  const warpTension = warpTensionVal.toFixed(2);
  const airPressure = ambient.mainAirPressureBar.toFixed(2);
  const motorLoad = isStopped ? '0' : '68.5';

  const sensorMetrics = [
    { 
      label: 'ELO Warp Tension', 
      value: warpTension, 
      unit: 'kN', 
      status: (warpTensionVal < 1.65 || warpTensionVal > 2.40) ? 'warning' : 'normal', 
      target: 'Range: 1.70 - 2.20' 
    },
    { 
      label: 'Air Consumption', 
      value: displayAirConsumption.toFixed(1), 
      unit: 'Nm³/h', 
      status: 'normal', 
      target: 'Air-Jet Insertion' 
    },
    { 
      label: 'Line Pressure', 
      value: airPressure, 
      unit: 'Bar', 
      status: ambient.mainAirPressureBar < 6.5 ? 'warning' : 'normal', 
      target: 'Min: 6.5 Bar' 
    },
    { 
      label: 'Pick Rate', 
      value: baseRpm.toString(), 
      unit: 'picks/m', 
      status: isStopped ? 'warning' : 'normal', 
      target: `Rated: ${loom?.setRpm || 850}` 
    },
    { 
      label: 'SmartShed Height', 
      value: '38.5', 
      unit: 'mm', 
      status: 'normal', 
      target: 'Opening Geometry' 
    },
    { 
      label: 'Sumo Motor Load', 
      value: motorLoad, 
      unit: '%', 
      status: Number(motorLoad) > 85 ? 'warning' : 'normal', 
      target: 'Reluctance Drive' 
    },
  ];

  return (
    <div className="space-y-3 sm:space-y-4 max-w-5xl mx-auto">
      {/* 6 Core Sensor Cards (2 cols on Phone, 3 on SM+) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        {sensorMetrics.map((metric, idx) => {
          const isWarn = metric.status === 'warning';
          return (
            <div
              key={idx}
              className={`rounded-xl p-3 sm:p-3.5 border transition-colors shadow-sm ${
                isWarn ? 'bg-amber-50/70 border-amber-300' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex justify-between items-start mb-0.5">
                <span className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider truncate">
                  {metric.label}
                </span>
                {isWarn && (
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.2 rounded flex-shrink-0">
                    CHECK
                  </span>
                )}
              </div>
              
              <div className="flex items-baseline gap-1 my-0.5">
                <span className={`text-xl sm:text-2xl font-black font-mono tabular-nums ${
                  isWarn ? 'text-amber-700' : 'text-slate-900'
                }`}>
                  {metric.value}
                </span>
                <span className="text-[10px] sm:text-xs font-semibold text-slate-400 font-mono">{metric.unit}</span>
              </div>

              <div className="text-[9px] sm:text-[10px] text-slate-500 font-medium truncate">
                {metric.target}
              </div>
            </div>
          );
        })}
      </div>

      {/* Real-time Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {/* Efficiency Trend */}
        <div className="bg-white rounded-xl p-3.5 sm:p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Shift Efficiency Trend (%)
            </h3>
            <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-600">
              Avg {loom?.efficiencyPercentage || 92.5}%
            </span>
          </div>

          <div className="h-48 sm:h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={efficiencyTrendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEffLoom" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[80, 100]} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '11px'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="efficiency"
                  name="Efficiency %"
                  stroke="#2563eb"
                  fillOpacity={1}
                  fill="url(#colorEffLoom)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Picanol Stop Reasons Stacked Bar */}
        <div className="bg-white rounded-xl p-3.5 sm:p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Stops Breakdown (Shift B)
            </h3>
            <span className="text-[10px] sm:text-[11px] font-mono text-slate-500">Warp vs Weft FD1/FD2</span>
          </div>

          <div className="h-48 sm:h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stopsData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontSize: '11px'
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }} />
                <Bar dataKey="warp" name="Warp" stackId="a" fill="#ef4444" barSize={18} />
                <Bar dataKey="weft_fd1" name="Weft FD1" stackId="a" fill="#f59e0b" barSize={18} />
                <Bar dataKey="weft_fd2" name="Weft FD2" stackId="a" fill="#3b82f6" barSize={18} />
                <Bar dataKey="selvedge" name="Selvedge" stackId="a" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
