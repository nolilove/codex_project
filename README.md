# 태초서약 선취득 내기 트래커

## 개요
- 참가자 목록을 동적으로 추가/삭제
- Neople API 캐릭터 검색(서버/모험단 모드)
- 타임라인 코드(550~556) 기반으로 `태초서약`, `태초서약결정` 획득 집계
- 기준 시각(`2026-03-30 12:00:00 +09:00`) 이후 태초서약 최초 획득 시각으로 꼴찌 자동 판정

## 필수 환경변수
- `NEOPLE_API_KEY` (Neople Developers 발급 키)
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob 연결 시 자동 주입)

## API 엔드포인트
- `GET /api/state` : 현재 상태 조회
- `GET /api/search` : 캐릭터 검색
- `POST /api/participants` : 참가자 추가/삭제/동기화
  - `action=add|remove|refresh`

## 배포
```bash
npx vercel --prod --yes
```

## 주의
- 모험단 검색은 공식 API 제약으로 캐릭터 검색 결과를 기본정보(`adventureName`)로 보강해 필터링합니다.
- 상태 데이터는 Vercel Blob에 저장되어 다중 사용자/새로고침에서도 유지됩니다.
