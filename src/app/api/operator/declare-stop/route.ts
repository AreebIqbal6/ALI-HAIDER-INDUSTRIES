import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceSupabase } from '@/lib/supabase';
import { assignStopReason } from '@/lib/localStore';
import { OperatorReasonCode, OPERATOR_REASON_LABELS } from '@/types';

const DeclareStopSchema = z.object({
  machineId: z.string().min(1).max(64),
  stopId: z.string().max(128).nullable().optional(),
  reasonCode: z.enum(['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS']),
  notes: z.string().max(500).optional(),
  operatorName: z.string().max(64).optional()
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = DeclareStopSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { machineId, stopId, reasonCode, notes, operatorName } = parseResult.data;

    // 1. Update in-memory localStore
    assignStopReason({
      machineId,
      reasonCode,
      notes
    });

    // 2. Best-effort write to Supabase
    const declaredAt = new Date().toISOString();
    const reasonDescription = OPERATOR_REASON_LABELS[reasonCode as OperatorReasonCode];

    try {
      const supabase = getServiceSupabase();

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

      await supabase.from('long_stop_declarations').insert({
        stop_id: stopId || null,
        machine_id: machineId,
        reason_code: reasonCode,
        reason_description: reasonDescription,
        declared_by: operatorName || 'Floor Operator',
        notes: notes || null,
        declared_at: declaredAt
      });

      await supabase
        .from('loom_live_state')
        .update({
          operator_reason: reasonCode,
          operator_note: notes || reasonDescription,
          declared_at: declaredAt
        })
        .eq('machine_id', machineId);
    } catch (dbErr) {
      // Safe fallback when Supabase is unreachable/offline
    }

    return NextResponse.json({
      success: true,
      machineId,
      reasonCode,
      reasonDescription,
      declaredAt
    });

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'Server error', message: err.message },
      { status: 500 }
    );
  }
}
