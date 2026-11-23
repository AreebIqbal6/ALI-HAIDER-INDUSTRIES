"use client";
import React from 'react';
import { LoomClientState } from '../../types';
import { 
  Cpu, 
  Activity, 
  Network,
  ShieldCheck,
  Radio,
  Clock,
  History
} from 'lucide-react';

interface HardwarePinInspectorProps {
  loom: LoomClientState;
}

export const HardwarePinInspector: React.FC<HardwarePinInspectorProps> = ({ loom }) => {
  const diag = loom.hardwareDiagnostics;
  const pinData = diag?.pins || diag?.optocouplerPins;

  // STRICT ZERO-MOCK: If no real hardware diagnostics received from device, show honest empty state
  if (!diag || !pinData) {
    return (
      <div className="bg-[#1e293b] p-6 sm:p-8 rounded-2xl text-center text-slate-300 border border-slate-700 max-w-2xl mx-auto shadow-md">
        <div className="w-12 h-12 rounded-xl bg-slate-800 text-blue-400 flex items-center justify-center mx-auto mb-3 border border-slate-700">
          <Radio size={22} className="animate-pulse" />
        </div>
        <h4 className="font-mono text-sm sm:text-base font-bold text-white mb-1">
          No pin telemetry reported
        </h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Hardware node <span className="font-mono text-blue-400 font-semibold">{loom.machineId}</span> ({loom.deviceId || 'Ethernet'}) has not transmitted raw XP_CBMP_P9 optocoupler transitions yet.
        </p>
      </div>
    );
  }

  const rawHistory = pinData.rawPinHistory || [];

  const pins = [
    {
      id: 'PI_STRT',
      pinNum: 'XP Pin 9 -> GPIO 4',
      name: 'Run/Stop Status',
      active: Boolean(pinData.piStrt),
      description: 'SUMO motor drive enable status signal (GPIO 4)',
      activeColor: 'bg-emerald-500 text-emerald-400 border-emerald-500/40',
      inactiveColor: 'bg-slate-800 text-slate-500 border-slate-700'
    },
    {
      id: 'PI_PP',
      pinNum: 'XP Pin 7 -> GPIO 32 [PCNT]',
      name: 'Pick Pulse (Beat-Up)',
      active: Boolean(pinData.piPp),
      description: 'ESP32 Hardware PCNT counter register (GPIO 32, 200 APB cycle glitch filter)',
      activeColor: 'bg-blue-500 text-blue-400 border-blue-500/40',
      inactiveColor: 'bg-slate-800 text-slate-500 border-slate-700'
    },
    {
      id: 'PI_WD',
      pinNum: 'XP Pin 8 -> GPIO 33',
      name: 'Warp Stop Trigger',
      active: Boolean(pinData.piWd),
      description: 'TSF drop wire bus contact closure (GPIO 33)',
      activeColor: 'bg-red-500 text-red-400 border-red-500/40',
      inactiveColor: 'bg-slate-800 text-slate-500 border-slate-700'
    },
    {
      id: 'PI_FD',
      pinNum: 'XP Pin 10 -> GPIO 14',
      name: 'Filling (Weft) Stop',
      active: Boolean(pinData.piFd),
      description: 'FD1/FD2 optical sensor arrival check (GPIO 14)',
      activeColor: 'bg-amber-500 text-amber-400 border-amber-500/40',
      inactiveColor: 'bg-slate-800 text-slate-500 border-slate-700'
    }
  ];

  return (
    <div className="bg-[#1e293b] text-slate-200 p-3.5 sm:p-5 rounded-2xl border border-slate-700 shadow-md space-y-4 select-none">
      {/* Header: Node Identity & Audit Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-700 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-blue-950/80 border border-blue-500/50 flex items-center justify-center text-blue-400 shadow-sm flex-shrink-0">
            <Cpu size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-sm sm:text-base font-bold text-white tracking-tight leading-tight">
                XP_CBMP_P9 Hardware Pin Inspector
              </h3>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700">
                LIVE
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Direct physical optocoupler states from WT32-ETH01 tapping Picanol 15-pin D-SUB port.
            </p>
          </div>
        </div>

        {/* Network & Node Telemetry Badge */}
        <div className="flex items-center gap-2 text-xs font-mono self-start sm:self-auto">
          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 flex items-center gap-1.5">
            <Network size={12} className="text-emerald-400" />
            <span>{diag.ipAddress || '192.168.10.101'}</span>
          </span>
          <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 text-[10px]">
            {diag.macAddress || loom.deviceId}
          </span>
        </div>
      </div>

      {/* 4 Optocoupled Pins Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {pins.map((pin) => (
          <div 
            key={pin.id} 
            className={`p-3 rounded-xl border transition-all ${
              pin.active 
                ? 'bg-slate-900/90 border-slate-600 shadow-sm' 
                : 'bg-slate-900/50 border-slate-800/80'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono font-bold text-xs text-white">
                {pin.id}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-black border uppercase tracking-wider ${
                pin.active ? pin.activeColor : pin.inactiveColor
              }`}>
                {pin.active ? 'HIGH (1)' : 'LOW (0)'}
              </span>
            </div>

            <div className="text-[11px] font-bold text-slate-300">
              {pin.name}
            </div>
            <div className="text-[10px] font-mono text-blue-400 mt-0.5">
              {pin.pinNum}
            </div>
            <p className="text-[10px] text-slate-400 mt-1 leading-snug">
              {pin.description}
            </p>
          </div>
        ))}
      </div>

      {/* Verified Edge Transition History */}
      <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <History size={14} className="text-blue-400" />
            <span>Raw Pin Transition Evidence</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            {rawHistory.length} recorded edge events
          </span>
        </div>

        {rawHistory.length === 0 ? (
          <p className="text-xs text-slate-500 font-mono py-2 text-center">
            No transition edge events recorded for active running state.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px]">
                  <th className="pb-1.5">Signal Pin</th>
                  <th className="pb-1.5">GPIO Mapping</th>
                  <th className="pb-1.5">Logic Level</th>
                  <th className="pb-1.5">Stop Offset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {rawHistory.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40">
                    <td className="py-1.5 font-bold text-white">{item.pin}</td>
                    <td className="py-1.5 text-slate-400">
                      {item.pin === 'PI_STRT' ? 'GPIO 4' : item.pin === 'PI_PP' ? 'GPIO 32 [PCNT]' : item.pin === 'PI_WD' ? 'GPIO 33' : 'GPIO 14'}
                    </td>
                    <td className="py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        item.level === 1 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {item.level === 1 ? 'HIGH (1)' : 'LOW (0)'}
                      </span>
                    </td>
                    <td className="py-1.5 font-bold">
                      <span className={item.offsetMsFromStop < 0 ? 'text-amber-400' : item.offsetMsFromStop === 0 ? 'text-red-400' : 'text-blue-400'}>
                        {item.offsetMsFromStop > 0 ? `+${item.offsetMsFromStop}ms` : `${item.offsetMsFromStop}ms`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
