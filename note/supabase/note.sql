-- MEIRONOTE 데이터베이스 (글 백업)
-- 일기장과 같은 Supabase 프로젝트에서 실행합니다. (일기장의 is_approved 함수, labels 표, diary-photos 저장소를 함께 씁니다)
-- Supabase 대시보드 → SQL Editor → + New query 에 이 파일 전체를 붙여 넣고 Run. 여러 번 실행해도 괜찮습니다.

-- 폴더
CREATE TABLE IF NOT EXISTS public.writing_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  color text NOT NULL DEFAULT '#0031b0',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 글. 올리기 전(draft)에는 마지막 임시저장 내용, 올린 뒤(published)에는 올린 내용
CREATE TABLE IF NOT EXISTS public.writing_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  folder_id uuid REFERENCES public.writing_folders(id) ON DELETE SET NULL,
  written_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  weather text,
  moods jsonb NOT NULL DEFAULT '[]',
  photos text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS writing_posts_user ON public.writing_posts (user_id, written_on DESC);

-- 버전: 자동 저장(auto), 임시저장(manual), 올림(publish) 때의 글 전체
CREATE TABLE IF NOT EXISTS public.writing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  post_id uuid NOT NULL REFERENCES public.writing_posts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('auto', 'manual', 'publish')),
  fields jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS writing_versions_post ON public.writing_versions (post_id, updated_at DESC);

-- 댓글
CREATE TABLE IF NOT EXISTS public.writing_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  post_id uuid NOT NULL REFERENCES public.writing_posts(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(trim(content)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 권한: 승인된 본인만
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['writing_folders', 'writing_posts', 'writing_versions', 'writing_comments'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'own rows') THEN
      EXECUTE format('CREATE POLICY "own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id AND public.is_approved(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_approved(auth.uid()))', t);
    END IF;
  END LOOP;
  -- 글은 내 폴더에만, 버전·댓글은 내 글에만
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'writing_posts' AND policyname = 'own folder only') THEN
    CREATE POLICY "own folder only" ON public.writing_posts AS RESTRICTIVE FOR ALL TO authenticated USING (true)
      WITH CHECK (folder_id IS NULL OR EXISTS (SELECT 1 FROM public.writing_folders f WHERE f.id = folder_id AND f.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'writing_versions' AND policyname = 'own post only') THEN
    CREATE POLICY "own post only" ON public.writing_versions AS RESTRICTIVE FOR ALL TO authenticated USING (true)
      WITH CHECK (EXISTS (SELECT 1 FROM public.writing_posts p WHERE p.id = post_id AND p.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'writing_comments' AND policyname = 'own post only') THEN
    CREATE POLICY "own post only" ON public.writing_comments AS RESTRICTIVE FOR ALL TO authenticated USING (true)
      WITH CHECK (EXISTS (SELECT 1 FROM public.writing_posts p WHERE p.id = post_id AND p.user_id = auth.uid()));
  END IF;
END $$;

-- 관리자의 계정 삭제(일기장 accounts.sql)에 MEIRONOTE 글과 사진도 포함
CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id uuid)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  photos text[];
  more text[];
  t text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id = auth.uid() THEN RAISE EXCEPTION '자기 계정은 여기서 지울 수 없어요'; END IF;
  SELECT coalesce(array_agg(p), '{}') INTO photos FROM public.entries e, unnest(e.photos) p WHERE e.user_id = _user_id;
  IF to_regclass('public.writing_posts') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(array_agg(DISTINCT p), ''{}'') FROM (
        SELECT unnest(photos) p FROM public.writing_posts WHERE user_id = $1
        UNION SELECT jsonb_array_elements_text(fields->''photos'') FROM public.writing_versions WHERE user_id = $1 AND jsonb_typeof(fields->''photos'') = ''array'') x'
      INTO more USING _user_id;
    photos := photos || more;
  END IF;
  -- 서재·가계부·노트 표는 아직 없을 수도 있어서 있는 것만 지움 (자식 표부터)
  FOREACH t IN ARRAY ARRAY['comments', 'entries', 'labels', 'reading_sessions', 'highlights', 'books',
                           'money_transactions', 'money_recurring', 'money_rules', 'money_budgets', 'money_categories', 'money_accounts',
                           'writing_comments', 'writing_versions', 'writing_posts', 'writing_folders'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', t) USING _user_id;
    END IF;
  END LOOP;
  DELETE FROM auth.users WHERE id = _user_id; -- profiles, user_roles는 함께 지워짐
  RETURN photos;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
