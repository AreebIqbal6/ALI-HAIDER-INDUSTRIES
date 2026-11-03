import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { OperatorReasonCode, OPERATOR_REASON_LABELS } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { machineId, stopId, reasonCode, notes, operatorName } = body;

    if (!machineId || !reasonCode) {
      return NextResponse.json(
        { success: false, error: 'machineId and reasonCode are required' },
        { status: 400 }
      );
    }

    if (!['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS'].includes(reasonCode)) {
      return NextResponse.json(
        { success: false, error: `Invalid reasonCode: ${reasonCode}. Allowed: ART, KNT, ELE, MEC, BST, DOF, OLS` },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    const declaredAt = new Date().toISOString();
    const reasonDescription = OPERATOR_REASON_LABELS[reasonCode as OperatorReasonCode];

    // 1. Update downtime_logs if stopId is provided
    if (stopId) {
      await supabase
        .from('downtime_logs')
        .update({
          operator_reason: reasonCode,
          acknowledged_by: operatorName || 'Floor Operator',
          technician_notes: notes || reasonDescription
        })
        .eq('stop_id', stopId);
    }

    // 2. Insert into long_stop_declarations audit log
    await supabase.from('long_stop_declarations').insert({
      stop_id: stopId || null,
      machine_id: machineId,
      reason_code: reasonCode,
      reason_description: reasonDescription,
      declared_by: operatorName || 'Floor Operator',
      notes: notes || null,
      declared_at: declaredAt
    });

    // 3. Update current live state with operator reason
    await supabase
      .from('loom_live_state')
      .update({
        operator_reason: reasonCode,
        operator_note: notes || reasonDescription,
        declared_at: declaredAt
      })
      .eq('machine_id', machineId);

    return NextResponse.json({
      success: true,
      declaration: {
        machineId,
        stopId,
        reasonCode,
        reasonDescription,
        declaredBy: operatorName || 'Floor Operator',
        declaredAt
      }
    });

  } catch (err: any) {
    console.error('Error declaring long stop:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to submit long-stop declaration' },
      { status: 500 }
    );
  }
}
