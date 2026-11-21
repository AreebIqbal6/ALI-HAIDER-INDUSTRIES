import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceSupabase } from '@/lib/supabase';
import { declareStopReason } from '@/lib/localStore';
import { OperatorReasonCode, OPERATOR_REASON_LABELS } from '@/types';

const DeclareStopSchema = z.object({
  machineId: z.string().min(1).max(50),
  stopId: z.string().nullable().optional(),
  reasonCode: z.enum(['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS']),
  notes: z.string().max(500).optional(),
  operatorName: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const result = DeclareStopSchema.safeParse(rawBody);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { machineId, stopId, reasonCode, notes, operatorName } = result.data;
    const declaredAt = new Date().toISOString();
    const reasonDescription = OPERATOR_REASON_LABELS[reasonCode as OperatorReasonCode];

    // 1. Update in-memory localStore
    declareStopReason({
      machineId,
      stopId,
      reasonCode,
      notes: notes || reasonDescription,
      operatorName: operatorName || 'Floor Operator',
    });

    // 2. Persist to Supabase if available
    try {
      const supabase = getServiceSupabase();

      if (stopId) {
        await supabase
          .from('downtime_logs')
          .update({
            operator_reason: reasonCode,
            acknowledged_by: operatorName || 'Floor Operator',
            technician_notes: notes || reasonDescription,
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
        declared_at: declaredAt,
      });

      await supabase
        .from('loom_live_state')
        .update({
          operator_reason: reasonCode,
          operator_note: notes || reasonDescription,
          declared_at: declaredAt,
        })
        .eq('machine_id', machineId);
    } catch (dbErr) {
      console.warn('Local mode: Supabase declaration logging deferred:', dbErr);
    }

    return NextResponse.json({
      success: true,
      declaration: {
        machineId,
        stopId,
        reasonCode,
        reasonDescription,
        declaredBy: operatorName || 'Floor Operator',
        declaredAt,
      },
    });
  } catch (err: any) {
    console.error('Error declaring stop:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to submit stop declaration' },
      { status: 500 }
    );
  }
}
