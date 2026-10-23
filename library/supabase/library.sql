-- STDL 圖書館 데이터베이스
-- 일기장과 같은 Supabase 프로젝트에서 실행합니다. (일기장의 is_approved 함수를 함께 씁니다)
-- Supabase 대시보드 → SQL Editor → + New query 에 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 괜찮습니다.

-- 책
CREATE TABLE IF NOT EXISTS public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL,
  authors text[] NOT NULL DEFAULT '{}',
  publisher text NOT NULL DEFAULT '',
  isbn text NOT NULL DEFAULT '',
  cover_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'reading' CHECK (status IN ('want', 'reading', 'done', 'dropped')),
  format text NOT NULL DEFAULT 'ebook' CHECK (format IN ('ebook', 'paper')),
  progress_unit text NOT NULL DEFAULT 'percent' CHECK (progress_unit IN ('percent', 'page')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  total_pages integer CHECK (total_pages IS NULL OR total_pages > 0),
  started_on date,
  finished_on date,
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  one_line text NOT NULL DEFAULT '',
  q_thoughts text NOT NULL DEFAULT '',
  q_further text NOT NULL DEFAULT '',
  q_learned text NOT NULL DEFAULT '',
  review text NOT NULL DEFAULT '',
  genre text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS books_user ON public.books (user_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books TO authenticated;
GRANT ALL ON public.books TO service_role;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own books all" ON public.books;
CREATE POLICY "own books all" ON public.books FOR ALL TO authenticated
  USING (auth.uid() = user_id AND public.is_approved(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.is_approved(auth.uid()));

-- 밑줄 (밀리의 서재 하이라이트)
CREATE TABLE IF NOT EXISTS public.highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  text text NOT NULL,
  page integer,
  highlighted_at timestamptz,
  color text NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'red', 'lime', 'sky', 'purple', 'underline')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS highlights_book ON public.highlights (book_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlights TO authenticated;
GRANT ALL ON public.highlights TO service_role;
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own highlights all" ON public.highlights;
CREATE POLICY "own highlights all" ON public.highlights FOR ALL TO authenticated
  USING (auth.uid() = user_id AND public.is_approved(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.is_approved(auth.uid())
    AND EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.user_id = auth.uid()));
