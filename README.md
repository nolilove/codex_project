# 태초서약 내기 트래커

## 개요
- 참가자 4명(`이단`, `배메`, `앵콜없는도태버퍼`, `헌터`) 고정
- 각자 획득 수량 입력/수정
- 수량이 `0 -> 1 이상`이 되는 최초 시점 기록
- 4명 모두 기록되면 가장 늦은 시각 1명을 자동 표시
- 기준 시각: `2026-03-30 12:00:00 +09:00`

## Vercel 서버리스 배포
이 프로젝트는 `api/*.js` Vercel Functions + Vercel KV(Upstash) 저장소를 사용합니다.

1. Vercel 프로젝트에 KV 연결
- Vercel Dashboard -> Project -> `Storage` -> `KV` 생성/연결
- 아래 환경변수가 자동 주입되어야 합니다.
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`

2. GitHub Push
```bash
git add .
git commit -m "feat: migrate to vercel serverless + kv"
git push origin main
```

3. 배포 확인
- 메인 페이지: `https://<your-domain>/`
- 상태 조회: `https://<your-domain>/api/state`
- 수량 업데이트: `POST https://<your-domain>/api/update`

## 로컬 실행(기존 Node 서버)
아래는 기존 파일 기반 서버 실행 방법입니다.
```bash
node server.js
```
기본 주소: `http://localhost:8080`

## 주의
- 수량을 `0`으로 저장하면 해당 캐릭터 최초 획득 시각도 초기화됩니다.
- Vercel 배포에서는 `data/state.json`이 저장소로 사용되지 않습니다.
