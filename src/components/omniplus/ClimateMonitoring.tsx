"use client";
import React from 'react';
import { Bell, Thermometer, Wind, Droplets } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTelemetry } from '../../contexts/TelemetryContext';
import toast from 'react-hot-toast';

const temperatureData = [
  { time: '06:00', temp: 26.2, target: 27.5 },
  { time: '08:00', temp: 27.0, target: 27.5 },
  { time: '10:00', temp: 27.8, target: 27.5 },
  { time: '12:00', temp: 28.4, target: 27.5 },
  { time: '14:00', temp: 28.1, target: 27.5 },
  { time: '16:00', temp: 27.8, target: 27.5 },
  { time: '18:00', temp: 27.4, target: 27.5 },
];

export const ClimateMonitoring: React.FC = () => {
  const { ambient } = useTelemetry();

  const temp = ambient.hallTemperatureCelsius;
  const humidity = ambient.hallHumidityPercentage;
  const pressure = ambient.mainAirPressureBar;
  
  const isTempWarning = temp > 30.0 || temp < 24.0;
  const isHumidWarning = humidity > 73.0 || humidity < 60.0;
  const isPressureWarning = pressure < 6.5;

  const handleNotifyHvac = () => {
    toast.success('Operational alert sent to Central HVAC Engineer (Hall 1).');
  };

  return (
    <div className="space-y-3.5 sm:space-y-4 max-w-5xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-base sm:text-xl font-black text-slate-800 tracking-tight leading-tight">
            Weaving Shed Climate & Air Telemetry
          </h2>
          <p className="text-[10px] sm:text-xs text-slate-500">
            2,000 sq yd Shed • Crucial for cotton yarn elasticity & static suppression
          </p>
        </div>
        <button
          onClick={handleNotifyHvac}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer"
        >
          <Bell size={14} /> Notify HVAC
        </button>
      </div>

      {/* 3 Core Climate Cards (1 col on Phone, 3 on SM+) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
        {/* Main Air Compressor Pressure */}
        <div className={`rounded-xl p-3 sm:p-4 border shadow-sm transition-colors ${
          isPressureWarning ? 'bg-red-50 border-red-300' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Main Compressor Line</p>
            <Wind size={16} className={isPressureWarning ? 'text-red-600' : 'text-blue-600'} />
          </div>
          <div className={`text-xl sm:text-2xl font-black font-mono tabular-nums ${isPressureWarning ? 'text-red-700' : 'text-slate-800'}`}>
            {pressure.toFixed(2)} Bar
          </div>
          <p className="text-[10px] text-slate-500 font-medium mt-0.5">
            {isPressureWarning ? '⚠️ Below 6.5 Bar threshold!' : 'Nominal: 7.0 - 9.0 Bar'}
          </p>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2">
            <div 
              className={`h-full rounded-full transition-all duration-700 ${isPressureWarning ? 'bg-red-500' : 'bg-blue-500'}`} 
              style={{ width: `${Math.min(100, Math.max(0, (pressure / 10) * 100))}%` }}
            />
          </div>
        </div>

        {/* Temperature Card */}
        <div className={`rounded-xl p-3 sm:p-4 border shadow-sm transition-colors ${
          isTempWarning ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Hall Temperature</p>
            <Thermometer size={16} className={isTempWarning ? 'text-amber-500' : 'text-orange-500'} />
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-slate-800">
            {temp.toFixed(1)}°C
          </div>
          <p className="text-[10px] text-slate-500 font-medium mt-0.5">Target: 26.0 - 28.5°C</p>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2">
            <div 
              className={`h-full rounded-full transition-all duration-700 ${isTempWarning ? 'bg-amber-500' : 'bg-orange-500'}`} 
              style={{ width: `${Math.min(100, Math.max(0, (temp / 40) * 100))}%` }}
            />
          </div>
        </div>

        {/* Humidity Card */}
        <div className={`rounded-xl p-3 sm:p-4 border shadow-sm transition-colors ${
          isHumidWarning ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Relative Humidity</p>
            <Droplets size={16} className={isHumidWarning ? 'text-amber-500' : 'text-blue-500'} />
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-slate-800">
            {humidity.toFixed(0)}%
          </div>
          <p className="text-[10px] text-slate-500 font-medium mt-0.5">Target: 65 - 72% RH</p>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2">
            <div 
              className={`h-full rounded-full transition-all duration-700 ${isHumidWarning ? 'bg-amber-500' : 'bg-blue-500'}`} 
              style={{ width: `${Math.min(100, Math.max(0, (humidity / 100) * 100))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Climate Trend Graph */}
      <div className="bg-white rounded-xl sm:rounded-2xl p-3.5 sm:p-5 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Temperature Profile (Shift A / B)
          </h3>
          <span className="text-[10px] font-mono font-bold text-emerald-600">Within Spec</span>
        </div>

        <div className="h-48 sm:h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={temperatureData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[24, 32]} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '11px'
                }}
              />
              <Line 
                type="monotone" 
                dataKey="temp" 
                name="Temp (°C)" 
                stroke="#f97316" 
                strokeWidth={2.5} 
                dot={{ r: 3 }} 
              />
              <Line 
                type="monotone" 
                dataKey="target" 
                name="Target (°C)" 
                stroke="#94a3b8" 
                strokeDasharray="4 4" 
                strokeWidth={1.5} 
                dot={false} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
