"use client";
import React from 'react';
import { LoomClientState } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Cpu, Server, CheckCircle2, Clock } from 'lucide-react';

interface HardwarePinInspectorProps {
  loom: LoomClientState;
}

export const HardwarePinInspector: React.FC<HardwarePinInspectorProps> = ({ loom }) => {
  const diag = loom.hardwareDiagnostics;

  if (!diag || !diag.pins) {
    return (
      <Card className="p-8 text-center border-dashed border-2 border-zinc-200 bg-white">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 mb-3">
          <Cpu className="h-5 w-5" />
        </div>
        <CardTitle className="text-base font-semibold text-zinc-900 mb-1">
          No Pin Telemetry Reported
        </CardTitle>
        <p className="text-xs text-zinc-500 max-w-sm mx-auto">
          No hardware edge diagnostics have been transmitted by this node. Live optocoupler signals will appear when the physical adapter is connected.
        </p>
      </Card>
    );
  }

  const { pins } = diag;
  const rawHistory = pins.rawPinHistory || [];

  const pinList = [
    {
      id: 'PI_STRT',
      pin: 'GPIO 4 (Pin 9)',
      name: 'Run / Stop Status',
      active: pins.piStrt,
      desc: 'Active-low optical input for main motor run state',
    },
    {
      id: 'PI_PP',
      pin: 'GPIO 32 [PCNT] (Pin 7)',
      name: 'Pick Pulse (Beat-Up)',
      active: pins.piPp,
      desc: 'Hardware pulse counter channel (glitch filtered)',
    },
    {
      id: 'PI_WD',
      pin: 'GPIO 33 (Pin 8)',
      name: 'Warp Stop',
      active: pins.piWd,
      desc: 'Drop wire contact closure detection',
    },
    {
      id: 'PI_FD',
      pin: 'GPIO 14 (Pin 10)',
      name: 'Filling (Weft) Stop',
      active: pins.piFd,
      desc: 'Optical feeder arrival sensor check',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Node Identity Card */}
      <Card className="p-4 bg-white border-zinc-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-3 mb-3">
          <div>
            <h3 className="font-semibold text-sm text-zinc-950 flex items-center gap-2">
              <Server className="h-4 w-4 text-zinc-600" />
              <span>WT32-ETH01 Hardware Node</span>
            </h3>
            <span className="text-xs text-zinc-500 font-mono">
              MAC: {diag.macAddress || loom.deviceId || '—'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px]">
              Firmware {diag.firmwareVersion || 'v2.1'}
            </Badge>
            <Badge variant={diag.lanPhyStatus === 'CONNECTED' ? 'running' : 'offline'}>
              {diag.lanPhyStatus === 'CONNECTED' ? 'LAN Link Up' : 'LAN Link Down'}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div>
            <span className="text-zinc-400 block font-sans text-[10px] uppercase">IP Address</span>
            <span className="text-zinc-900 font-medium">{diag.ipAddress || loom.ipAddress || '—'}</span>
          </div>
          <div>
            <span className="text-zinc-400 block font-sans text-[10px] uppercase">Last Heartbeat</span>
            <span className="text-zinc-900 font-medium">{new Date(diag.lastHeartbeat).toLocaleTimeString()}</span>
          </div>
          <div>
            <span className="text-zinc-400 block font-sans text-[10px] uppercase">Connector</span>
            <span className="text-zinc-900 font-medium">XP_CBMP_P9</span>
          </div>
          <div>
            <span className="text-zinc-400 block font-sans text-[10px] uppercase">Pulse Counter</span>
            <span className="text-zinc-900 font-medium">PCNT Unit 0</span>
          </div>
        </div>
      </Card>

      {/* Optical Input Pin Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pinList.map(p => (
          <Card key={p.id} className="p-3.5 bg-white border-zinc-200 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-bold text-xs text-zinc-900">{p.id}</span>
                <span className="text-[11px] text-zinc-500">({p.pin})</span>
              </div>
              <p className="text-xs font-medium text-zinc-800">{p.name}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{p.desc}</p>
            </div>

            <Badge variant={p.active ? 'running' : 'offline'} className="font-mono text-[11px]">
              {p.active ? 'HIGH' : 'LOW'}
            </Badge>
          </Card>
        ))}
      </div>

      {/* Real Edge History (if available) */}
      {rawHistory.length > 0 && (
        <Card className="p-4 bg-white border-zinc-200">
          <CardHeader className="p-0 pb-3 mb-3 border-b border-zinc-100">
            <CardTitle className="text-xs font-semibold text-zinc-900 uppercase tracking-wider">
              Recent Raw Pin Transitions
            </CardTitle>
          </CardHeader>
          <div className="space-y-1.5 font-mono text-xs">
            {rawHistory.map((evt, idx) => (
              <div key={idx} className="flex items-center justify-between py-1 px-2 rounded bg-zinc-50 text-zinc-700">
                <span className="font-semibold text-zinc-900">{evt.pin}</span>
                <span>Level: {evt.level}</span>
                <span className="text-zinc-500">
                  {evt.offsetMsFromStop !== undefined ? `${evt.offsetMsFromStop} ms from stop` : 'Recorded'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
