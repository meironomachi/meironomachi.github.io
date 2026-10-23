-- $TDL 가계부 데이터베이스
-- 일기장과 같은 Supabase 프로젝트에서 실행합니다. (일기장의 is_approved 함수를 함께 씁니다)
-- Supabase 대시보드 → SQL Editor → + New query 에 이 파일 전체를 붙여 넣고 Run. 여러 번 실행해도 괜찮습니다.
-- 계좌번호, 카드번호, 은행 비밀번호는 저장하지 않습니다.

-- 계좌 (카카오뱅크, 하나, 농협, 현금 …)
CREATE TABLE IF NOT EXISTS public.money_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  bank text NOT NULL DEFAULT 'etc' CHECK (bank IN ('kakao', 'hana', 'nh', 'cash', 'etc')),
  opening_balance bigint NOT NULL DEFAULT 0,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 분류 (식비, 카페 … / 용돈, 급여 … / 이체, 저축)
CREATE TABLE IF NOT EXISTS public.money_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'saving')),
  color text NOT NULL DEFAULT '#868e96',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 거래. amount는 들어오면 +, 나가면 −
CREATE TABLE IF NOT EXISTS public.money_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid NOT NULL REFERENCES public.money_accounts(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  amount bigint NOT NULL CHECK (amount <> 0),
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income', 'transfer', 'saving', 'cancel')),
  category_id uuid REFERENCES public.money_categories(id) ON DELETE SET NULL,
  place text NOT NULL DEFAULT '',
  memo text NOT NULL DEFAULT '',
  tx_type text NOT NULL DEFAULT '',
  balance_after bigint,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  import_key text,
  pair_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS money_tx_time ON public.money_transactions (user_id, occurred_at);
-- 같은 파일을 두 번 올려도 겹치지 않게
CREATE UNIQUE INDEX IF NOT EXISTS money_tx_import ON public.money_transactions (user_id, import_key) WHERE import_key IS NOT NULL;

-- 자동 분류 규칙: 이 곳(place)은 다음부터 이 분류
CREATE TABLE IF NOT EXISTS public.money_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  place text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'saving')),
  category_id uuid REFERENCES public.money_categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, place)
);

-- 예산: category_id가 비어 있으면 한 달 전체 지출 예산. 매달 같은 금액
CREATE TABLE IF NOT EXISTS public.money_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  category_id uuid REFERENCES public.money_categories(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS money_budget_one ON public.money_budgets (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 권한: 승인된 본인만
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['money_accounts', 'money_categories', 'money_transactions', 'money_rules', 'money_budgets'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "own rows" ON public.%I', t);
    EXECUTE format('CREATE POLICY "own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id AND public.is_approved(auth.uid())) WITH CHECK (auth.uid() = user_id AND public.is_approved(auth.uid()))', t);
  END LOOP;
END $$;

-- 거래는 내 계좌에만 넣을 수 있게
DROP POLICY IF EXISTS "own account only" ON public.money_transactions;
CREATE POLICY "own account only" ON public.money_transactions AS RESTRICTIVE FOR ALL TO authenticated
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM public.money_accounts a WHERE a.id = account_id AND a.user_id = auth.uid()));
