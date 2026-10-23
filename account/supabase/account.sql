-- 회원 관리 (meiro.kr/account/)
-- 일기장 schema.sql, accounts.sql 다음에 실행합니다. 여러 번 실행해도 괜찮습니다.

-- 이메일을 바꾸면(확인 메일을 누른 뒤) 프로필의 이메일 사본도 같이 바꿈
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET email = coalesce(NEW.email, '') WHERE id = NEW.id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email() FROM anon, authenticated, public;
CREATE OR REPLACE TRIGGER on_auth_user_email_changed AFTER UPDATE OF email ON auth.users
  FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION public.sync_profile_email();

-- 관리자는 회원 목록에서 누가 관리자인지 볼 수 있음
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'admin roles select') THEN
    CREATE POLICY "admin roles select" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
