-- MEIROPAY 데이터베이스 (근무 시간 → 월급 계산)
-- 일기장과 같은 Supabase 프로젝트에서 실행합니다. 여러 번 실행해도 괜찮습니다.

-- 일하는 곳: 시급, 세금 방식, 주휴수당, 5인 이상 가산수당
CREATE TABLE IF NOT EXISTS public.pay_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  color text NOT NULL DEFAULT '#0031b0',
  wage integer NOT NULL CHECK (wage > 0),
  tax_type text NOT NULL DEFAULT 'biz33' CHECK (tax_type IN ('biz33', 'insured', 'none')),
  weekly boolean NOT NULL DEFAULT true,
  extra boolean NOT NULL DEFAULT false, -- 연장수당
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 근무 한 번: 날짜, 시작·끝 시각(HH:MM, 끝이 이르면 다음 날까지), 휴게(분), 그날만 다른 시급
CREATE TABLE IF NOT EXISTS public.pay_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  place_id uuid NOT NULL REFERENCES public.pay_places(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  start_time text NOT NULL CHECK (start_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  end_time text NOT NULL CHECK (end_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  break_min integer NOT NULL DEFAULT 0 CHECK (break_min >= 0 AND break_min < 1440),
  wage integer CHECK (wage IS NULL OR wage > 0),
  memo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_shifts_user ON public.pay_shifts (user_id, work_date);

-- 권한: 승인된 본인만, 근무는 내 일하는 곳에만
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pay_places', 'pay_shifts'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'own rows') THEN
      EXECUTE format('CREATE POLICY "own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id AND public.is_approved(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_approved(auth.uid()))', t);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pay_shifts' AND policyname = 'own place only') THEN
    CREATE POLICY "own place only" ON public.pay_shifts AS RESTRICTIVE FOR ALL TO authenticated USING (true)
      WITH CHECK (EXISTS (SELECT 1 FROM public.pay_places p WHERE p.id = place_id AND p.user_id = auth.uid()));
  END IF;
END $$;

-- 야간수당을 연장수당과 따로 켜고 끔 (처음엔 둘이 한 칸이었음)
ALTER TABLE public.pay_places ADD COLUMN IF NOT EXISTS night boolean;
COMMENT ON COLUMN public.pay_places.night IS '야간수당. 비어 있으면 extra(연장수당)와 같게 계산';

-- 계정을 지우면 MEIROPAY 기록도 함께 지워짐
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pay_places_user_fk') THEN
    ALTER TABLE public.pay_places ADD CONSTRAINT pay_places_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pay_shifts_user_fk') THEN
    ALTER TABLE public.pay_shifts ADD CONSTRAINT pay_shifts_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
