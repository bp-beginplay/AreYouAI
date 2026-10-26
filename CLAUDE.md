# Are You AI? (대화를 통해 AI인지 사람인지 맞추는 게임)

## 프로젝트 개요

5명의 사람들중에 AI가 숨어있다. 대화를 통해 투표로 누가 AI인지 정하고 맞추면 승리하는 게임.
모티브는 튜링 테스트

## 기술 스택

\-Next.js 16 (App Router)
-Tailwind CSS
-MongoDB Atlas (AI의 승률 저장)
-Vercel(배포)

## 주요 기능

* 구글 로그인
* 채팅방
* AI의 승률 집계
* AI투표(5분마다 실행)
* 광고(게임 대기중에 광고 표시)

## 코드 규칙

\-TypeScript 사용
-컴포넌트는 src/components/ 아래에 작성
-환경 변수는 .env .local에 저장 (절대 커밋하지 않음)
-모바일 우선 반응형 디자인

