// meiro.kr 로그인 문: 로그인하지 않았으면 페이지를 그리지 않고 일기장 로그인·가입 화면으로 보냄.
// <head>에서 바로(동기) 불러서 화면이 잠깐도 보이지 않게 함. 각 사이트와 같은 Supabase 로그인(이 브라우저에 저장된 세션)을 확인.
// 주의: 화면을 가리는 장치일 뿐, 저장소(github.com)에 올린 파일 자체는 공개라 누구나 열 수 있음.
(function () {
  var KEY = "sb-eonixnwmqpiktmcaeznf-auth-token";
  var LOGIN = "/saytqtul/#/auth";
  try {
    var s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && s.refresh_token) return; // 접근 토큰이 만료돼도 새로 고칠 수 있으면 로그인 상태로 봄
  } catch (e) { /* 저장소를 못 쓰면 로그인 안 한 것으로 봄 */ }
  document.documentElement.style.visibility = "hidden";
  location.replace(LOGIN);
})();
