# intelli-memo

## 필수 규칙

**코드 수정 후 반드시 빌드를 실행한다:**

```bash
npm run build
```

빌드 없이 수정 완료를 보고하지 않는다.

## 프로젝트 구조

- `IntelliMemoApp.jsx` — **메인 소스 파일** (여기를 수정한다)
- `src/main.jsx` — React 진입점 (IntelliMemoApp.jsx를 import)
- `scripts/build-standalone.mjs` — 빌드 스크립트 (Vite로 번들 후 `index.html` 단일 파일 생성)
- `index.html` — **빌드 산출물** (직접 수정 금지, 빌드로 덮어씌워짐)

## 개발 흐름

1. `IntelliMemoApp.jsx` 수정
2. `npm run build` 실행
3. 결과물 `index.html`에 변경사항 반영됨
