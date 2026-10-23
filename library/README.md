# MEIROBOOK

다 읽은 책을 천천히 정리하고, 감상을 남겨 두는 서재. `meiro.kr/library/` 에서 열립니다.
일기장(STDL)과 같은 Supabase 프로젝트와 로그인을 씁니다.

- 서재: 다 읽은 책은 완독 연도별 표지 책장, 읽는 중·읽고 싶은 책은 따로
- 책 추가: 카카오 책 검색으로 표지·저자·출판사 채우기, 또는 직접 입력
- 정리하기: 별점, 한 줄 평, 세 질문(읽고 든 생각 / 더 생각해 볼 지점 / 알게 된 것), 서식 있는 감상, 임시저장
- 밑줄: 밀리의 서재 하이라이트 붙여넣기(`24p · 2026.10.23 18:16` 형식을 알아봄), 6가지 색
- 진도: 전자책은 %, 종이책은 쪽수
- 독서 타이머: 책마다 읽기 시작·잠깐 멈춤·끝내기(진도 함께 저장), 직접 입력, 기록 고치기
- 독서 달력과 연속 기록 (하루는 새벽 6시 기준), 일기장 타임테이블에 '독서'로 자동 표시

## 처음 설정

1. Supabase **SQL Editor**에서 `supabase/library.sql` 실행 (일기장 `schema.sql`을 먼저 실행한 프로젝트에서)
2. **Edge Functions**에 `book-search` 함수 만들기: `supabase/functions/book-search/index.ts` 내용을 붙여 넣고 배포
3. **Edge Functions → Secrets**에 `KAKAO_REST_KEY` = 카카오 REST API 키
4. **Authentication → URL Configuration → Redirect URLs**에 `https://meiro.kr/library/` 추가

카카오 키는 Supabase 비밀 설정에만 둡니다. 이 저장소에는 넣지 않습니다.

## 올리기 전에 / 테스트

```sh
node tools/bump-version.mjs   # css·js 주소에 새 버전을 붙여 브라우저가 새 파일을 받게 함
node --test test/*.test.mjs
```
