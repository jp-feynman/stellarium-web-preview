# SPHEREx Sky Lab · v2.1.0

한결의 블랙홀 입장 화면, 중선의 Stellarium 플라네타리움, 경보의 TrueBlink 분석 도구를 연결한 통합 버전입니다.

공개 사이트: https://jp-feynman.github.io/stellarium-web-preview/

`main` 브랜치에 푸시하면 GitHub Actions가 세 화면을 빌드하고 같은 주소에 배포합니다. 공개 사이트의 SPHEREx 검색은 팀이 운영하는 `https://trueblink.pages.dev/api`를 사용합니다. 이 서버의 가용성에 따라 새로운 천체의 자료 조회가 영향을 받을 수 있습니다. 로컬 실행은 함께 제공하는 검색 서버를 사용합니다.

## 실행

1. Node.js 22 이상이 설치된 PC에서 이 폴더의 **`Start-Web.cmd`**를 실행합니다.
2. 처음 실행할 때 TrueBlink의 잠금 파일에 맞는 의존성을 설치하고, 세 화면을 `dist/`에 빌드합니다.
3. 기본 주소 `http://127.0.0.1:4173/`에서 시작합니다. 이미 사용 중이면 다음 빈 포트를 자동으로 선택하고, 실제 주소를 브라우저에서 엽니다. 사용 중에는 서버 창을 열어 두세요.
4. 입장 화면의 **플라네타리움 입장**을 누르고 천체를 클릭하거나 이름으로 검색합니다. 선택 정보의 **SPHEREx 분석**을 누르면 해당 좌표의 분석 도구가 열립니다. 분석창을 닫으면 보던 하늘로 돌아갑니다.

개발용 명령은 다음과 같습니다.

```powershell
npm run setup
npm run build
npm run preview
```

기본 실행은 사용 중인 포트를 피해 자동으로 시작합니다. 포트를 직접 고정하려면 `npm run preview -- --port 4174`로 실행하세요. `--port` 또는 `PORT`로 명시한 포트는 자동으로 바꾸지 않습니다. `index.html`을 파일 탐색기에서 직접 여는 방식은 WebAssembly와 자료 조회를 지원하지 않습니다.

## 구성

| 원본 폴더 | 통합 사이트 주소 | 역할 |
| --- | --- | --- |
| `한결/BLACKHOLE_BG` | `/` | 블랙홀 애니메이션과 입장 화면 |
| `중선/v1.2.0` | `/planetarium/` | 하늘·전천 지도, 위치·시간 설정, 천체 선택 |
| `경보/trueblink` | `/analysis/` | 선택한 위치의 SPHEREx 자료 조회와 분석 |

플라네타리움에서 분석 도구로 적경·적위(도)와 표시용 천체 이름을 전달합니다. 천체 이름을 다시 검색해서 다른 좌표로 바꾸지 않습니다. 분석창에서 쓰는 관측 자료는 SPHEREx가 실제로 수집한 과거 영상이며, 플라네타리움의 시뮬레이션 시각과 동일한 시점의 영상이라는 뜻은 아닙니다. 달·행성과 같은 이동 천체는 선택 시점의 하늘 위치 주변을 조회하며 궤도를 따라 과거 영상을 추적하지 않습니다.

## 자료 연결과 배포

`scripts/serve.mjs`는 정적 파일뿐 아니라 경보의 기존 `/api/sia` 검색 중계 서버와 `/hips/spherex/` 채널 처리를 함께 실행합니다. 임의의 천체 위치를 검색하려면 이 서버와 인터넷 연결이 필요합니다. 외부 서비스가 응답하지 않거나 해당 위치의 자료가 없으면 분석 도구에 오류 또는 빈 결과가 표시됩니다. 기본 제공 대상의 저장된 자료는 일부 오프라인 기능에 사용됩니다.

`npm run build` 결과는 루트의 `dist/`에 모입니다. GitHub Pages 같은 정적 호스팅에 이 폴더만 올리면 검색 중계 서버가 실행되지 않으므로 임의의 천체 조회에는 별도 중계 서버가 필요합니다. 별도 서버를 쓸 때는 `VITE_API_BASE`에 HTTPS 중계 서버의 `/api` 주소를 설정한 뒤 다시 빌드하세요. 이 저장소의 GitHub Pages 워크플로는 위 공개 분석 서버 주소를 빌드에 적용합니다. 로컬 파일 편집만으로 사이트가 바뀌지는 않으며, 이 저장소에 커밋·푸시해야 반영됩니다.

```powershell
$env:VITE_API_BASE = 'https://your-relay.example/api'
npm run build
Remove-Item Env:VITE_API_BASE
```

## 수정과 확인

각 팀 폴더에서 코드를 수정한 뒤 루트에서 `npm run build`를 실행하면 통합 결과가 갱신됩니다. `npm test`는 통합 서버의 정적 경로, WASM 응답, 검색 API 연결을 외부 요청 없이 검사합니다. 분석 도구의 기존 검사는 `npm --prefix 경보/trueblink test`로 실행할 수 있습니다.

Stellarium의 소스와 AGPL-3.0 라이선스는 플라네타리움의 프로젝트 안내·소스 링크에 포함됩니다. TrueBlink의 Apache-2.0 라이선스와 고지 문서는 `dist/analysis/LICENSE`, `THIRD_PARTY_NOTICES.md`, `AI_USE.md`에 함께 포함됩니다. 각 팀의 원본 구현과 고지를 유지합니다.
