import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configureLoom, hasLoomNumberConflict } from '@/lib/localStore';
import {
  authorizeOperatorRequest,
  checkOperatorRateLimit,
  readBoundedJsonBody,
} from '@/lib/operatorAuth';
import { getServiceSupabase } from '@/lib/supabase';

const ConfigureLoomSchema = z.object({
  machineId: z.string().trim().min(1).max(50),
  loomNumber: z.number().int().positive().optional(),
  family: z.string().trim().min(1).max(50).optional(),
  articleName: z.string().trim().min(1).max(100).optional(),
  setRpm: z.number().positive().max(2000).optional(),
  weftDensity: z.number().positive().max(200).optional(),
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

    const result = ConfigureLoomSchema.safeParse(parsedBody.body);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { machineId, loomNumber, family, articleName, setRpm, weftDensity } = result.data;

    const supabase = getServiceSupabase();
    if (supabase) {
      const updates: Record<string, string | number> = {};
      if (loomNumber !== undefined) updates.loom_number = loomNumber;
      if (family) updates.family = family;
      if (articleName) updates.article_name = articleName;
      if (setRpm) updates.set_rpm = setRpm;
      if (weftDensity) updates.weft_density_picks_per_cm = weftDensity;

      const { data: updatedRow, error: dbErr } = Object.keys(updates).length > 0
        ? await supabase
            .from('looms')
            .update(updates)
            .eq('machine_id', machineId)
            .select('machine_id, loom_number, family, article_name, set_rpm, weft_density_picks_per_cm')
            .maybeSingle()
        : await supabase
            .from('looms')
            .select('machine_id, loom_number, family, article_name, set_rpm, weft_density_picks_per_cm')
            .eq('machine_id', machineId)
            .maybeSingle();

      if (dbErr) {
        if (dbErr.code === '23505') {
          return NextResponse.json(
            { success: false, error: `Loom number ${loomNumber} is already assigned to another machine` },
            { status: 409 },
          );
        }
        return NextResponse.json(
          { success: false, error: 'Failed to configure loom in database' },
          { status: 502 },
        );
      }
      if (!updatedRow) {
        return NextResponse.json(
          { success: false, error: `Unknown machine ${machineId}` },
          { status: 404 },
        );
      }

      return NextResponse.json({
        success: true,
        loom: updatedRow,
      });
    }

    if (loomNumber !== undefined && hasLoomNumberConflict(machineId, loomNumber)) {
      return NextResponse.json(
        { success: false, error: `Loom number ${loomNumber} is already assigned to another machine` },
        { status: 409 },
      );
    }

    const updatedLocal = configureLoom({
      machineId,
      loomNumber,
      family,
      articleName,
      setRpm,
      weftDensity,
    });

    if (!updatedLocal) {
      return NextResponse.json(
        { success: false, error: `Unknown machine ${machineId}` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      loom: updatedLocal,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to configure loom';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
