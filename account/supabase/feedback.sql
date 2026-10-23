-- FEEDBACK: 사이트 하단에서 누구나 보내고, 관리자만 회원 관리 창에서 읽음
-- 여러 번 실행해도 괜찮습니다.
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nickname text NOT NULL CHECK (length(trim(nickname)) BETWEEN 1 AND 40),
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 2000),
  page text NOT NULL DEFAULT '' CHECK (length(page) <= 200),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_time ON public.feedback (created_at DESC);

-- 보낸 사람은 서버가 정함: 로그인했으면 그 회원과 설정된 닉네임, 아니면 비회원(적은 닉네임)
CREATE OR REPLACE FUNCTION public.feedback_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.user_id := auth.uid();
  IF NEW.user_id IS NOT NULL THEN
    SELECT coalesce(nullif(trim(p.nickname), ''), split_part(p.email, '@', 1), '회원') INTO NEW.nickname FROM public.profiles p WHERE p.id = NEW.user_id;
    NEW.nickname := coalesce(NEW.nickname, '회원');
  END IF;
  NEW.nickname := left(trim(NEW.nickname), 40);
  NEW.is_read := false;
  NEW.created_at := now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.feedback_fill() FROM anon, authenticated, public;
CREATE OR REPLACE TRIGGER feedback_fill BEFORE INSERT ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.feedback_fill();

GRANT INSERT ON public.feedback TO anon, authenticated;
GRANT SELECT, DELETE ON public.feedback TO authenticated;
GRANT UPDATE (is_read) ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feedback' AND policyname = 'anyone sends') THEN
    CREATE POLICY "anyone sends" ON public.feedback FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feedback' AND policyname = 'admin reads') THEN
    CREATE POLICY "admin reads" ON public.feedback FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feedback' AND policyname = 'admin marks') THEN
    CREATE POLICY "admin marks" ON public.feedback FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feedback' AND policyname = 'admin removes') THEN
    CREATE POLICY "admin removes" ON public.feedback FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
