-- 007_rls_security_hardening.sql: Close anon INSERT RLS loophole from 001_initial_schema.sql,
-- add missing query indexes, and harden view/function security context.
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Fix permissive WITH CHECK (true) on service_role policies from 001_initial_schema.sql.
--    In Postgres RLS, INSERT checks ONLY WITH CHECK (not USING), so WITH CHECK (true)
--    allowed anon/authenticated to INSERT arbitrary rows into all 7 tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
    pol TEXT;
    tables_and_policies TEXT[][] := ARRAY[
        ARRAY['looms', 'Allow service role all on looms'],
        ARRAY['loom_live_state', 'Allow service role all on live state'],
        ARRAY['loom_minute_counters', 'Allow service role all on counters'],
        ARRAY['loom_events', 'Allow service role all on events'],
        ARRAY['downtime_logs', 'Allow service role all on downtime'],
        ARRAY['long_stop_declarations', 'Allow service role all on declarations'],
        ARRAY['gateway_health', 'Allow service role all on gateway health']
    ];
    pair TEXT[];
BEGIN
    FOREACH pair SLICE 1 IN ARRAY tables_and_policies LOOP
        tbl := pair[1];
        pol := pair[2];
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR ALL ' ||
                'USING ((SELECT auth.role()) = ''service_role'' OR current_user IN (''postgres'', ''service_role'')) ' ||
                'WITH CHECK ((SELECT auth.role()) = ''service_role'' OR current_user IN (''postgres'', ''service_role''))',
                pol, tbl
            );
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Missing indexes for shift counter queries and downtime history lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS loom_minute_counters_window_start_idx
    ON public.loom_minute_counters (window_start DESC);

CREATE INDEX IF NOT EXISTS downtime_logs_machine_start_idx
    ON public.downtime_logs (machine_id, downtime_start DESC);

CREATE INDEX IF NOT EXISTS long_stop_declarations_machine_declared_idx
    ON public.long_stop_declarations (machine_id, declared_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Harden optional view/RPC objects if present
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'loom_shift_metrics'
    ) THEN
        EXECUTE 'ALTER VIEW public.loom_shift_metrics SET (security_invoker = true)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'calculate_shift_kpis'
    ) THEN
        EXECUTE 'ALTER FUNCTION public.calculate_shift_kpis(DATE, TEXT) SET search_path = public, pg_temp';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_latest_factory_state'
    ) THEN
        EXECUTE 'ALTER FUNCTION public.get_latest_factory_state() SET search_path = public, pg_temp';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Ensure Realtime publication includes looms & loom_live_state (idempotent)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH tbl IN ARRAY ARRAY['looms', 'loom_live_state'] LOOP
            IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl)
               AND NOT EXISTS (
                   SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
               ) THEN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
            END IF;
        END LOOP;
    END IF;
END $$;
