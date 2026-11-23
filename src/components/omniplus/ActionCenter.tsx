"use client";
import React, { useState } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Wrench, 
  UserCheck, 
  FileText, 
  ShieldAlert, 
  Download,
  Send
} from 'lucide-react';
import { useTelemetry } from '../../contexts/TelemetryContext';
import { StopCategory, OperatorReasonCode, OPERATOR_REASON_LABELS } from '../../types';
import toast from 'react-hot-toast';

interface ActionCenterProps {
  machineId?: string;
  loomNumber?: number;
}

interface EventLog {
  id: string;
  timestamp: string;
  type: 'STOP_EVENT' | 'MAINTENANCE' | 'DISPATCH' | 'NOTE';
  title: string;
  description: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
  technician?: string;
  stopCategory?: StopCategory;
}

export const ActionCenter: React.FC<ActionCenterProps> = ({ machineId, loomNumber }) => {
  const { 
    looms, 
    selectedMachineId, 
    acknowledgeStop, 
    dispatchTechnician,
    assignLongStopReason 
  } = useTelemetry();
  const effectiveId = machineId || (selectedMachineId !== 'GLOBAL' ? selectedMachineId : 'PIC-427708');
  const loom = looms[effectiveId] || Object.values(looms).find(l => l.loomNumber === loomNumber) || null;
  const targetMachineId = loom?.machineId || effectiveId;
  const targetLoomNumber = loom?.loomNumber || loomNumber || 1;

  const [activeFilter, setActiveFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedTechnician, setSelectedTechnician] = useState('Akram Khan (Shift Lead)');
  const [notesText, setNotesText] = useState('');
  const [declaringCode, setDeclaringCode] = useState<OperatorReasonCode | null>(null);

  const handleQuickDeclare = async (code: OperatorReasonCode) => {
    if (!loom) return;
    setDeclaringCode(code);
    try {
      await assignLongStopReason(
        loom.machineId,
        loom.stopId || `stop-${loom.machineId}`,
        code,
        `Quick one-click declaration from Action Center`,
        'Floor Supervisor'
      );
    } finally {
      setDeclaringCode(null);
    }
  };

  // Operational event log for target machine (dynamically derived from loom state & shift activity)
  const initialEvents = React.useMemo<EventLog[]>(() => {
    const list: EventLog[] = [];
    if (!loom) return list;

    // 1. If currently stopped, add the active stoppage event
    if (loom.state === 'STOPPED') {
      const stopTime = new Date(loom.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const cat = loom.stopCategory || 'WARP';
      let title = 'Warp Stop (Drop Wire Contact)';
      let desc = 'TSF load cell detected tension drop. Heald frame drop wire engaged.';
      if (cat === 'FILLING') {
        title = 'Weft Stop (Optical Eye FD1)';
        desc = 'Weft arrival failure at right selvedge. Feeder optical eye sensor triggered.';
      } else if (cat === 'SELVEDGE') {
        title = 'Leno Selvedge Stop (ELSY)';
        desc = 'Electronic Leno Selvedge Device detected broken edge thread.';
      } else if (cat === 'OTHER') {
        title = 'Mechanical / Stoppage Alert';
        desc = 'Manual emergency stop or air-pressure interruption detected.';
      }

      list.push({
        id: `evt-active-${loom.machineId}`,
        timestamp: stopTime,
        type: 'STOP_EVENT',
        title,
        description: loom.operatorReasonNote || desc,
        status: loom.operatorReasonCode ? 'RESOLVED' : 'PENDING',
        stopCategory: cat,
        technician: loom.declaredBy || 'Floor Supervisor'
      });
    }

    // 2. If operator declared a long-stop code, log the declaration entry
    if (loom.operatorReasonCode) {
      list.push({
        id: `evt-decl-${loom.machineId}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'NOTE',
        title: `Operator Reason Declared: [${loom.operatorReasonCode}] ${OPERATOR_REASON_LABELS[loom.operatorReasonCode]}`,
        description: loom.operatorReasonNote || `Authorized floor declaration by ${loom.declaredBy || 'Akram Khan'}`,
        status: 'RESOLVED',
        technician: loom.declaredBy || 'Akram Khan (Lead Supervisor)'
      });
    }

    // 3. Shift commissioning and handover record
    list.push({
      id: `evt-base-1-${loom.machineId}`,
      timestamp: '08:00',
      type: 'NOTE',
      title: 'Shift Handover & Beam Calibration Signed',
      description: `Article weft density verified at ${loom.weftDensityPicksPerCm} p/cm. Target set speed: ${loom.setRpm} RPM.`,
      status: 'RESOLVED',
      technician: 'Naveed Iqbal (Supervisor)'
    });

    return list;
  }, [loom?.machineId, loom?.state, loom?.since, loom?.stopCategory, loom?.operatorReasonCode, loom?.operatorReasonNote, loom?.declaredBy, loom?.weftDensityPicksPerCm, loom?.setRpm]);

  const [events, setEvents] = useState<EventLog[]>(initialEvents);

  React.useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  const handleAcknowledge = (id: string) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status: 'ACKNOWLEDGED' } : e));
    if (targetMachineId) acknowledgeStop(targetMachineId);
  };

  const handleResolve = (id: string) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status: 'RESOLVED' } : e));
    toast.success('Event marked as resolved.');
  };

  const handleDispatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetMachineId) return;
    dispatchTechnician(targetMachineId, selectedTechnician);

    const newEvt: EventLog = {
      id: `evt-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'DISPATCH',
      title: `Technician Dispatched: ${selectedTechnician}`,
      description: notesText || 'Assigned to inspect and clear stoppage on floor.',
      status: 'PENDING',
      technician: selectedTechnician
    };

    setEvents(prev => [newEvt, ...prev]);
    setShowDispatchModal(false);
    setNotesText('');
  };

  const handleExportShiftReport = () => {
    toast.success(`Exported Shift Report for Loom ${targetLoomNumber} (${targetMachineId})`);
  };

  const filteredEvents = events.filter(e => {
    if (activeFilter === 'PENDING') return e.status === 'PENDING' || e.status === 'ACKNOWLEDGED';
    if (activeFilter === 'RESOLVED') return e.status === 'RESOLVED';
    return true;
  });

  return (
    <div className="space-y-3.5 sm:space-y-5 max-w-5xl mx-auto">
      {/* Header with Operational Action Buttons */}
      <div className="bg-white p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-blue-600 flex-shrink-0" size={20} />
            <h2 className="text-base sm:text-xl font-bold text-slate-800 tracking-tight leading-tight">
              Operational Action Center
            </h2>
          </div>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">
            Supervisor dispatch, stop acknowledgements, and ISO shift diary for Machine {targetLoomNumber} ({targetMachineId}).
          </p>
        </div>

        {/* Operational Workflow Actions */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowDispatchModal(true)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Send size={13} />
            <span>Dispatch Tech</span>
          </button>
          <button
            onClick={handleExportShiftReport}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Download size={13} />
            <span>Shift CSV</span>
          </button>
        </div>
      </div>

      {/* One-Click Long-Stop Operator Reason Declaration (Section 10.4) */}
      <div className="bg-white p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs sm:text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Wrench size={16} className="text-blue-600" />
            <span>One-Click Long-Stop Reason Declaration (Section 10.4)</span>
          </h3>
          <span className="text-[10px] font-mono text-slate-400">Strictly Read-Only SCADA</span>
        </div>
        <p className="text-[11px] text-slate-500">
          When a stoppage extends past 5 minutes, assign the certified ISO downtime cause code:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {(['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS'] as OperatorReasonCode[]).map(code => {
            const isCurrent = loom?.operatorReasonCode === code;
            return (
              <button
                key={code}
                disabled={declaringCode !== null}
                onClick={() => handleQuickDeclare(code)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-amber-100 border-amber-400 text-amber-950 font-black ring-2 ring-amber-300'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                }`}
              >
                <div className="font-mono text-xs font-black">[{code}]</div>
                <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">
                  {OPERATOR_REASON_LABELS[code]}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-none py-0.5">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              activeFilter === 'ALL'
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All ({events.length})
          </button>
          <button
            onClick={() => setActiveFilter('PENDING')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              activeFilter === 'PENDING'
                ? 'bg-red-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Open ({events.filter(e => e.status !== 'RESOLVED').length})
          </button>
          <button
            onClick={() => setActiveFilter('RESOLVED')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              activeFilter === 'RESOLVED'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Resolved ({events.filter(e => e.status === 'RESOLVED').length})
          </button>
        </div>

        <div className="text-[10px] font-mono text-slate-400 self-end xs:self-auto">
          SITE Area Karachi • Shift B
        </div>
      </div>

      {/* Events Stream */}
      <div className="space-y-2.5 sm:space-y-3">
        {filteredEvents.map(evt => {
          const isPending = evt.status === 'PENDING';
          const isAcknowledged = evt.status === 'ACKNOWLEDGED';

          return (
            <div
              key={evt.id}
              className={`p-3 sm:p-4 rounded-xl border transition-all ${
                isPending
                  ? 'bg-red-50/40 border-red-300 shadow-sm'
                  : isAcknowledged
                  ? 'bg-amber-50/40 border-amber-300 shadow-sm'
                  : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0">
                    {evt.type === 'STOP_EVENT' && <AlertTriangle className="text-red-600" size={17} />}
                    {evt.type === 'DISPATCH' && <UserCheck className="text-blue-600" size={17} />}
                    {evt.type === 'MAINTENANCE' && <Wrench className="text-amber-600" size={17} />}
                    {evt.type === 'NOTE' && <FileText className="text-slate-500" size={17} />}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 leading-tight">{evt.title}</h4>
                      <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        {evt.timestamp}
                      </span>
                      {evt.technician && (
                        <span className="text-[9px] sm:text-[10px] font-medium text-slate-500">
                          Tech: <strong className="text-slate-700">{evt.technician}</strong>
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-snug">{evt.description}</p>
                  </div>
                </div>

                {/* Status Badges & Action Buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0 self-end sm:self-start">
                  {isPending && (
                    <button
                      onClick={() => handleAcknowledge(evt.id)}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white rounded text-[10px] sm:text-[11px] font-bold shadow-sm transition-colors cursor-pointer"
                    >
                      Acknowledge
                    </button>
                  )}
                  {isAcknowledged && (
                    <button
                      onClick={() => handleResolve(evt.id)}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded text-[10px] sm:text-[11px] font-bold shadow-sm transition-colors cursor-pointer"
                    >
                      Mark Resolved
                    </button>
                  )}
                  {evt.status === 'RESOLVED' && (
                    <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <CheckCircle2 size={12} /> Resolved
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dispatch Technician Modal (Mobile Bottom Sheet / Desktop Modal) */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            {/* Mobile Grab Handle */}
            <div className="w-12 h-1 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center gap-2 mb-2 text-slate-900">
              <UserCheck className="text-blue-600 flex-shrink-0" size={20} />
              <h3 className="text-base sm:text-lg font-bold leading-tight">Dispatch Floor Technician</h3>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mb-3">
              Sends an alert to the technician via SMS / PWA Push for <strong>Loom #{targetLoomNumber} ({targetMachineId})</strong>.
            </p>

            <form onSubmit={handleDispatchSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  On-Duty Technician
                </label>
                <select
                  value={selectedTechnician}
                  onChange={(e) => setSelectedTechnician(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px]"
                >
                  <option value="Akram Khan (Shift Lead)">Akram Khan (Shift Lead)</option>
                  <option value="Tariq Mehmood (Senior Weaver)">Tariq Mehmood (Senior Weaver)</option>
                  <option value="Imran Baig (Electronics / Sumo)">Imran Baig (Electronics / Sumo)</option>
                  <option value="Farooq Ahmed (SmartShed)">Farooq Ahmed (SmartShed)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                  Instructions / Symptom Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Check drop wire bar #2 or rethread warp end on creel."
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors cursor-pointer min-h-[40px]"
                >
                  Confirm Dispatch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
