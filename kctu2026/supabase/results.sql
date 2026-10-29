-- 선거 특보 개표 결과 (meiro.kr/kctu2026/). 누구나 읽고, 관리자만 고침. 여러 번 실행해도 괜찮습니다.
CREATE TABLE IF NOT EXISTS public.kctu_election (
  id text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.kctu_election (id) VALUES ('2026') ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON public.kctu_election TO anon, authenticated;
GRANT UPDATE (data, updated_at) ON public.kctu_election TO authenticated;
GRANT ALL ON public.kctu_election TO service_role;
ALTER TABLE public.kctu_election ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kctu_election' AND policyname = 'anyone reads') THEN
    CREATE POLICY "anyone reads" ON public.kctu_election FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kctu_election' AND policyname = 'admin writes') THEN
    CREATE POLICY "admin writes" ON public.kctu_election FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
