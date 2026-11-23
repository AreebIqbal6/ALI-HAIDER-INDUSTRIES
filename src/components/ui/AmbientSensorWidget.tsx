import React from 'react';
import { Thermometer, Droplets, Gauge } from 'lucide-react';
import { AmbientTelemetryState } from '../../types';

interface AmbientSensorWidgetProps {
  ambient: AmbientTelemetryState | null;
}

export const AmbientSensorWidget: React.FC<AmbientSensorWidgetProps> = ({ ambient }) => {
  const temp = ambient?.hallTemperatureCelsius ?? 27.8;
  const humidity = ambient?.hallHumidityPercentage ?? 68.2;
  const pressure = ambient?.mainAirPressureBar ?? 7.35;
  const isPressureLow = pressure < 6.5;

  return (
    <div className="bg-[#1e293b] p-4 rounded-xl shadow-md flex flex-col justify-between text-slate-200 min-h-[120px]">
      <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">
        <span>Shed Ambient</span>
        {isPressureLow && <span className="text-red-400 font-extrabold animate-pulse">LOW AIR</span>}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-slate-300"><Thermometer size={14}/> Temp</span>
        <span className="font-mono font-bold text-sm tabular-nums">{temp.toFixed(1)}°C</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="flex items-center gap-1.5 text-xs text-slate-300"><Droplets size={14}/> Humidity</span>
        <span className="font-mono font-bold text-sm text-blue-300 tabular-nums">{humidity.toFixed(0)}%</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="flex items-center gap-1.5 text-xs text-slate-300"><Gauge size={14}/> Air Pressure</span>
        <span className={`font-mono font-bold text-sm tabular-nums ${isPressureLow ? 'text-red-400' : 'text-emerald-300'}`}>
          {pressure.toFixed(2)} Bar
        </span>
      </div>
    </div>
  );
};
