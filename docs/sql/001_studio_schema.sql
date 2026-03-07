-- ============================================================
-- Replay Dance Studio — Supabase Schema Migration
-- Version: 001 — Multi-studio / Multi-user support
--
-- Run this script in Supabase > SQL Editor on a FRESH project.
-- If you are migrating an existing rds_kv table, see the
-- "MIGRATION FROM EXISTING TABLE" section at the bottom.
--
-- Prerequisites:
--   • pgcrypto extension (enabled by default in Supabase)
--   • Supabase Auth enabled with Email provider
--   • Realtime enabled for the rds_kv table (see last step)
-- ============================================================

-- Enable pgcrypto (needed for gen_random_uuid on older PG versions)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. studios — one record per dance studio / tenant
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studios (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. studio_members — maps auth users to studios with a role
--    role values: 'admin' | 'staff' | 'viewer'
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_members (
  studio_id  uuid  NOT NULL REFERENCES public.studios(id)  ON DELETE CASCADE,
  user_id    uuid  NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  role       text  NOT NULL DEFAULT 'staff'
               CHECK (role IN ('admin','staff','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_id, user_id)
);

-- ============================================================
-- 3. rds_kv — key-value store scoped per studio
--    Replaces the old single-user rds_kv table.
--
-- If the table does not yet exist, this creates it fresh.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rds_kv (
  id         bigserial   PRIMARY KEY,
  studio_id  uuid        NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT rds_kv_studio_key_unique UNIQUE (studio_id, key)
);

-- Ensure full replica identity so DELETE events include all columns
-- (needed for Supabase Realtime to deliver the key on DELETE)
ALTER TABLE public.rds_kv REPLICA IDENTITY FULL;

-- ============================================================
-- 4. Trigger — keep updated_at current on every UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_rds_kv_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rds_kv_updated_at ON public.rds_kv;
CREATE TRIGGER rds_kv_updated_at
  BEFORE UPDATE ON public.rds_kv
  FOR EACH ROW EXECUTE FUNCTION public.set_rds_kv_updated_at();

-- ============================================================
-- 5. Row Level Security (RLS)
-- ============================================================

ALTER TABLE public.studios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rds_kv         ENABLE ROW LEVEL SECURITY;

-- Drop legacy catch-all policy if it exists
DROP POLICY IF EXISTS "Authenticated access" ON public.rds_kv;

-- ── studios ──────────────────────────────────────────────────
-- Any authenticated member of a studio can read that studio row.
CREATE POLICY "studios_select"
  ON public.studios FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid()
    )
  );

-- ── studio_members ────────────────────────────────────────────
-- A user can always see their own memberships.
CREATE POLICY "studio_members_select_own"
  ON public.studio_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins can see all memberships for their studio.
CREATE POLICY "studio_members_select_admin"
  ON public.studio_members FOR SELECT TO authenticated
  USING (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins can insert / update / delete studio memberships.
CREATE POLICY "studio_members_write_admin"
  ON public.studio_members FOR ALL TO authenticated
  USING (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ── rds_kv ────────────────────────────────────────────────────
-- Any studio member can read all KV entries for their studio.
CREATE POLICY "rds_kv_select"
  ON public.rds_kv FOR SELECT TO authenticated
  USING (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid()
    )
  );

-- Admins and staff can insert new keys.
CREATE POLICY "rds_kv_insert"
  ON public.rds_kv FOR INSERT TO authenticated
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role IN ('admin','staff')
    )
  );

-- Admins and staff can update existing keys.
CREATE POLICY "rds_kv_update"
  ON public.rds_kv FOR UPDATE TO authenticated
  USING (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role IN ('admin','staff')
    )
  )
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role IN ('admin','staff')
    )
  );

-- Only admins can delete KV entries.
CREATE POLICY "rds_kv_delete"
  ON public.rds_kv FOR DELETE TO authenticated
  USING (
    studio_id IN (
      SELECT studio_id FROM public.studio_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- 6. Enable Realtime for rds_kv
--    This publishes row-level changes over WebSocket.
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.rds_kv;

-- ============================================================
-- 7. Initial data — first studio + admin user
--    Replace the values below and run AFTER creating your
--    first user in Supabase > Authentication > Users.
--
--    See README.md for the full setup walkthrough.
-- ============================================================
-- DO $$
-- DECLARE
--   v_studio_id uuid;
--   v_user_id   uuid;
-- BEGIN
--   -- 1. Create the studio
--   INSERT INTO public.studios (name) VALUES ('Replay Dance Studio')
--   RETURNING id INTO v_studio_id;
--
--   -- 2. Look up the user by email
--   SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@example.com';
--
--   -- 3. Add them as admin
--   INSERT INTO public.studio_members (studio_id, user_id, role)
--   VALUES (v_studio_id, v_user_id, 'admin');
--
--   RAISE NOTICE 'Studio created: %', v_studio_id;
-- END $$;


-- ============================================================
-- MIGRATION FROM EXISTING TABLE
-- ============================================================
-- If you already have an rds_kv table with the OLD schema
-- (only key + value columns, no studio_id), run these steps
-- INSTEAD of the CREATE TABLE above:
--
-- Step 1 — add nullable columns (keeps existing rows intact)
--   ALTER TABLE public.rds_kv
--     ADD COLUMN IF NOT EXISTS studio_id  uuid        REFERENCES public.studios(id) ON DELETE CASCADE,
--     ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
--     ADD COLUMN IF NOT EXISTS updated_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL;
--
-- Step 2 — (optional) assign existing rows to your new studio
--   UPDATE public.rds_kv SET studio_id = '<your-studio-uuid>' WHERE studio_id IS NULL;
--
-- Step 3 — make studio_id NOT NULL and add the unique constraint
--   ALTER TABLE public.rds_kv
--     ALTER COLUMN studio_id SET NOT NULL,
--     ADD CONSTRAINT rds_kv_studio_key_unique UNIQUE (studio_id, key);
--
-- Step 4 — drop the old single-column PK if it was on "key"
--   -- Only needed if the old table had PRIMARY KEY (key):
--   ALTER TABLE public.rds_kv DROP CONSTRAINT IF EXISTS rds_kv_pkey;
--   ALTER TABLE public.rds_kv ADD COLUMN IF NOT EXISTS id bigserial;
--   ALTER TABLE public.rds_kv ADD PRIMARY KEY (id);
--
-- Then continue with steps 4-6 above (REPLICA IDENTITY, trigger,
-- RLS policies, and Realtime publication).
-- ============================================================
