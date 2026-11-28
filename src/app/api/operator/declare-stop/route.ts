import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceSupabase } from '@/lib/supabase';
import { assignStopReason } from '@/lib/localStore';
import { isUuid } from '@/lib/contract/uuid';
import {
  authorizeOperatorRequest,
  checkOperatorRateLimit,
  readBoundedJsonBody,
} from '@/lib/operatorAuth';
import { OperatorReasonCode, OPERATOR_REASON_LABELS } from '@/types';

const DeclareStopSchema = z.object({
  machineId: z.string().trim().min(1).max(64),
  stopId: z.string().trim().max(128).nullable().optional(),
  reasonCode: z.enum(['ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS']),
  notes: z.string().trim().max(500).optional(),
  operatorName: z.string().trim().min(1).max(64).optional(),
  declaredBy: z.string().trim().min(1).max(64).optional(),
});

export async function POST(req: NextRequest) {
  if (!checkOperatorRateLimit(req)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const auth = await authorizeOperatorRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const parsedBody = await readBoundedJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json(
        { success: false, error: parsedBody.error },
        { status: parsedBody.status },
      );
    }

    const parseResult = DeclareStopSchema.safeParse(parsedBody.body);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Validation error', details: parseResult.error.flatten() },
        { status: 400 },
      );
    }

    const { machineId, stopId, reasonCode, notes, operatorName, declaredBy } = parseResult.data;
    const declaredAt = new Date().toISOString();
    const reasonDescription = OPERATOR_REASON_LABELS[reasonCode as OperatorReasonCode];
    const resolvedOperator = operatorName || declaredBy || 'Floor Operator';

    // 1. Update localStore if present
    const updatedLocal = assignStopReason({
      machineId,
      reasonCode,
      notes,
    });

    // 2. Persist to Supabase when configured
    const supabase = getServiceSupabase();
    if (supabase) {
      const { data: loomRow, error: lookupError } = await supabase
        .from('looms')
        .select('machine_id')
        .eq('machine_id', machineId)
        .maybeSingle();

      if (lookupError) {
        return NextResponse.json(
          { success: false, error: 'Failed to verify machine in database' },
          { status: 502 },
        );
      }

      if (!loomRow) {
        return NextResponse.json(
          { success: false, error: `Unknown machine ${machineId}` },
          { status: 404 },
        );
      }

      const validUuidStopId = stopId && isUuid(stopId) ? stopId : null;

      if (validUuidStopId) {
        const { error: downtimeErr } = await supabase
          .from('downtime_logs')
          .update({
            operator_reason: reasonCode,
            acknowledged_by: resolvedOperator,
            technician_notes: notes || reasonDescription,
          })
          .eq('stop_id', validUuidStopId);
        if (downtimeErr) {
          return NextResponse.json(
            { success: false, error: 'Failed to update downtime log' },
            { status: 502 },
          );
        }
      }

      const { error: insertErr } = await supabase.from('long_stop_declarations').insert({
        stop_id: validUuidStopId,
        machine_id: machineId,
        reason_code: reasonCode,
        reason_description: reasonDescription,
        declared_by: resolvedOperator,
        notes: notes || null,
        declared_at: declaredAt,
      });
      if (insertErr) {
        return NextResponse.json(
          { success: false, error: 'Failed to record long-stop declaration' },
          { status: 502 },
        );
      }

      const { error: liveErr } = await supabase
        .from('loom_live_state')
        .update({
          operator_reason: reasonCode,
          operator_note: notes || reasonDescription,
          declared_at: declaredAt,
        })
        .eq('machine_id', machineId);
      if (liveErr) {
        return NextResponse.json(
          { success: false, error: 'Failed to update live loom state' },
          { status: 502 },
        );
      }
    } else if (!updatedLocal) {
      return NextResponse.json(
        { success: false, error: `Unknown machine ${machineId}` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      machineId,
      reasonCode,
      reasonDescription,
      declaredAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json(
      { success: false, error: 'Server error', message },
      { status: 500 },
    );
  }
}
