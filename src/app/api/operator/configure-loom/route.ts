import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configureLoom } from '@/lib/localStore';
import { getServiceSupabase } from '@/lib/supabase';

const ConfigureLoomSchema = z.object({
  machineId: z.string().min(1).max(50),
  loomNumber: z.number().int().positive().optional(),
  family: z.string().min(1).max(50).optional(),
  articleName: z.string().min(1).max(100).optional(),
  setRpm: z.number().positive().max(2000).optional(),
  weftDensity: z.number().positive().max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const result = ConfigureLoomSchema.safeParse(rawBody);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { machineId, loomNumber, family, articleName, setRpm, weftDensity } = result.data;

    // 1. Update in localStore
    const updatedLocal = configureLoom({
      machineId,
      loomNumber,
      family,
      articleName,
      setRpm,
      weftDensity,
    });

    // 2. Update Supabase if available
    try {
      const supabase = getServiceSupabase();
      if (supabase) {
        const updates: Record<string, any> = {};
        if (loomNumber !== undefined) updates.loom_number = loomNumber;
        if (family) updates.family = family;
        if (articleName) updates.article_name = articleName;
        if (setRpm) updates.set_rpm = setRpm;
        if (weftDensity) updates.weft_density_picks_per_cm = weftDensity;

        if (Object.keys(updates).length > 0) {
          await supabase.from('looms').update(updates).eq('machine_id', machineId);
        }
      }
    } catch (dbErr) {
      console.warn('Local mode: Supabase update skipped:', dbErr);
    }

    return NextResponse.json({
      success: true,
      loom: updatedLocal,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to configure loom' },
      { status: 500 }
    );
  }
}
