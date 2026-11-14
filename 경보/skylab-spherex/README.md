# Stellarium Web Lab + SPHEREx v1.3.0

브라우저에서 실행하고 정적 웹 호스팅에 배포할 수 있는 Stellarium 기반 천체 탐색기입니다. 팀원이 만든 **Stellarium Web Lab v1.2.0**을 바탕으로, NASA SPHEREx 적외선 전천 영상 레이어와 TrueBlink 연결을 더한 수정판입니다(NASA Space Apps Challenge 2026, 과제 “Planet X and SPHEREx”).

데스크톱 `v1`의 Qt 실행 파일을 변환한 것이 아니라, 공식 [Stellarium Web Engine](https://github.com/Stellarium/stellarium-web-engine)을 소스에서 WebAssembly로 빌드하고 한국어 웹 화면을 연결했습니다. 데스크톱의 모든 기능이나 플러그인이 포함되지는 않습니다. SPHEREx는 **화면 표시용 영상**만 연결했습니다. 스펙트럼 조회·측광은 이 앱의 기능이 아닙니다.

## v1.3.0에서 달라진 점

- **SPHEREx 적외선 전천 영상 레이어:** 오른쪽 ‘적외선’ 버튼 또는 레이어 메뉴의 ‘SPHEREx 적외선 전천 영상’으로 켭니다. 하늘 보기(지표면 포함)와 전천 지도 모두에서 실제 하늘 위치에 맞춰 표시되며, 별·별자리 선·이름은 영상 위에 그대로 그려집니다. 레이어를 켜는 동안 번들 은하수(가시광) 배경은 숨겨 두 영상이 섞이지 않게 합니다.
- **파장 선택:** 카드의 막대 또는 ‹ › 버튼으로 102개 채널 중 하나를 고릅니다(0.75~4.99 µm, 검출기 1~6). 채널 51·52는 원본에 영상이 없어 건너뜁니다. 기본값은 채널 21(1.20 µm)입니다. 막대를 끌 때는 멈춘 채널만 내려받습니다.
- **설명과 출처:** 카드에 “NASA SPHEREx 전천 영상(1년 평균)입니다. 시간에 따른 변화는 보이지 않습니다. 변화를 보려면 TrueBlink에서 깜빡여 보세요.”라는 안내와 출처(NASA/JPL-Caltech/IPAC · IRSA, DOI 10.26131/IRSA679)를 표시합니다. 전천 지도에서는 카드가 지도 아래 한 줄 막대로 바뀌고, 안내 문구는 지도 제목 아래로 옮겨집니다.
- **TrueBlink 연결:** ‘TrueBlink에서 깜빡여 보기’ 버튼이 선택한 천체(없으면 화면 중심)의 ICRF 적경·적위로 TrueBlink를 새 탭에서 엽니다. 선택 정보 창과 좌표계 칸에도 같은 버튼이 있습니다.
- **시작 링크 매개변수:** `ra`, `dec`, `fov`, `view`, `spherex`, `name`을 받습니다(아래 ‘TrueBlink와 연결’ 참고).
- 미리보기 서버(`scripts/serve.mjs`)가 SPHEREx 채널 변환 경로 `/hips/spherex/`를 함께 제공합니다.

## 바로 실행

Node.js 22 이상이 필요합니다. 현재 개발 PC에는 Node.js 24가 설치되어 있습니다.

1. 이 폴더의 `Start-Web.cmd`를 더블 클릭합니다.
2. 정적 파일을 생성한 뒤 기본 브라우저에서 `http://127.0.0.1:4173/`을 엽니다.
3. 사용 중에는 서버 창을 열어 두세요. 종료는 서버 창에서 `Ctrl+C`입니다.

터미널에서 실행할 수도 있습니다. npm 패키지 설치나 별도 데이터베이스는 필요 없습니다.

```powershell
npm run build
npm run preview
```

포트가 사용 중이면 `npm run preview -- --port 4174`를 실행합니다. `index.html`을 직접 더블 클릭하는 `file://` 실행은 지원하지 않습니다.

## 사용법

- **전천 지도:** 탐색 도구 위쪽의 ‘전천 지도’ 또는 오른쪽 ‘전천’ 버튼으로 전환합니다. 360° 하늘을 몰바이데(Mollweide) 투영의 2:1 타원 지도에 표시하며, 화면 크기에 맞춰 양쪽 극과 가장자리가 잘리지 않게 맞춥니다. 드래그·휠·터치로 이동과 확대가 가능하고, ‘전체 보기’ 또는 시야 초기화 버튼은 적경 0h·적위 0° 중심의 360° 지도로 돌아갑니다. 이름 검색과 적경·적위 입력도 사용할 수 있습니다.
- 전천 모드에서는 지형·안개·대기를 숨기고 천구 좌표계를 사용합니다. ‘하늘 보기’로 돌아오면 이전 시야, 좌표계와 레이어 설정을 복원합니다. 일반 접속은 기존처럼 지표면이 켜진 하늘 보기로 시작하며, `view=allsky` 공유 링크는 전천 지도로 직접 열립니다. 모바일에서는 지도를 가리지 않도록 전환 시 탐색 도구가 접힙니다.
- **지도 자료:** 기본 전천 지도는 Stellarium의 별·별자리·은하수 자료를 사용합니다. SPHEREx 레이어를 켜면 실제 SPHEREx 파장별 전천 영상이 깔립니다. 관측 영역 표시와 스펙트럼 조회는 연결하지 않았습니다. DSS 영상은 기존과 같이 시야 10° 이하에서만 표시되는 별도 레이어입니다.
- **천구 좌표계:** ‘좌표계’ 메뉴에서 ‘천구 좌표계 · 적경/적위’를 선택하거나 오른쪽 ‘천구’ 버튼을 누르세요. 카메라의 이동 축이 적도 방향으로 바뀌고 천구 격자가 켜집니다. 화면 중심의 적경·적위를 확인하거나 적경 0~24시간, 적위 −90~+90°를 입력해 이동할 수 있습니다. 24h는 0h와 같은 방향입니다. 격자와 숫자는 **ICRF 축 기준**이며, 원시 카메라 각도를 적경으로 사용하지 않습니다. ‘지평 좌표계’로 돌아가면 방위각·고도가 표시됩니다.
- 좌표계를 전환해도 보고 있던 천구 방향을 유지합니다. 전환 시 천체 추적은 해제되며, 다시 검색하면 추적할 수 있습니다. 천구 모드의 시야 초기화는 적경 0h·적위 0°로 이동합니다. 지표면은 별도 스위치로 조절하며, 첫 방문에는 이전과 같이 켜진 상태로 시작합니다.
- 드래그로 하늘을 이동하고 휠이나 +/− 버튼으로 확대합니다. 터치 기기는 드래그와 두 손가락 확대를 지원합니다.
- 기본 시작 화면은 **현재 시각**, 서울 위치, **실시간 ×1 재생** 상태입니다. 날짜 입력과 하단 시계는 브라우저 시간대입니다. 시각이 명시된 공유 링크는 해당 시각에서 ×1로 시작합니다.
- **시간 조작:** `<`와 `>`를 누를 때마다 Stellarium의 10배 단계 규칙으로 시간 속도가 바뀝니다. `… −100 → −10 → −1 → 정지 → +1 → +10 → +100 …` 순서에서 `>`는 오른쪽으로, `<`는 왼쪽으로 이동합니다. `⏹`는 즉시 정지합니다. 오른쪽 칸은 선택 메뉴가 아니라 **실제 재생 방향과 현재 배속**을 보여주는 표시창입니다. ‘실시간 ×1’은 선택한 관측 시각에서 1초씩 진행한다는 뜻입니다. 이 웹앱의 배속 범위는 −1,000,000~+1,000,000배이며 끝 단계에서는 해당 방향 버튼이 비활성화됩니다.
- **시간 도구 배치:** 윗줄에는 `< · ⏹ · >`, 아랫줄에는 왼쪽부터 ‘배속 입력’, ‘현재시간’, 실제 방향·배속 표시가 있습니다. 원하는 배속을 입력하고 Enter를 누르거나 입력칸 밖을 클릭하면 적용됩니다. 소수도 가능하며 음수는 역방향, 0은 정지입니다. ‘현재시간’은 컴퓨터의 현재 시각으로 돌아가 실시간 ×1로 재생합니다. 직접 입력한 배속에서도 화살표는 10배 단계 규칙을 따릅니다.
- 한국어 추천 검색을 제공합니다. 영문 천체명이나 카탈로그 번호를 Enter로 직접 검색할 수도 있습니다. 검색 범위는 포함된 카탈로그에 한정됩니다.
- 관측 위치, 시간, 시간 배속, 별자리 선·이름, 대기, 지형, 적도 좌표 격자를 바꿀 수 있습니다.
- **사용자 위치:** 관측 위치 목록에서 ‘사용자 위치’를 선택하고 위도·경도를 입력한 뒤 ‘적용’을 누르세요. 북위·동경은 양수, 남위·서경은 음수입니다. 위도는 −90~90°, 경도는 −180~180°를 지원합니다. 마지막으로 적용한 사용자 좌표는 이 브라우저에 저장되어 다시 선택할 수 있습니다.
- **국가별 수도:** 국가·수도 이름이나 영문 도시명으로 검색한 뒤 목록에서 선택하면 위도·경도와 하늘 화면이 바로 변경됩니다. 여러 수도나 정부 소재지가 있는 경우 구분된 도시를 제공합니다. 수도 좌표는 로컬 파일 `src/capitals.js`에 포함하며 자료 출처와 범위는 `docs/CAPITALS.md`에 기록되어 있습니다. 국가를 바꿔도 시간 입력란은 기기의 현지 시간대를 유지합니다.
- **지표면 켜기·끄기:** 하늘 보기를 열거나 새로고침하면 지표면이 켜진 상태로 시작합니다. 하늘 보기 공유 링크의 레이어 설정과 관계없이 이 시작 설정을 적용합니다. 전천 지도에서는 지형을 숨깁니다. 기본 시야는 지평선이 보이도록 고도 15°입니다. 오른쪽의 ‘지표면’ 버튼 또는 `G` 키를 사용하세요. 레이어 메뉴의 ‘지표면’ 스위치와 상태가 동기화됩니다. 끄면 지형과 지평선 안개가 사라져 지평선 아래의 하늘도 볼 수 있습니다. 입력란에서 글을 쓰는 중에는 단축키가 작동하지 않습니다.
- DSS는 별도의 **실제 관측 사진**(가시광) 레이어입니다. 켠 뒤 시야를 10° 이하로 확대하세요. IRSA 외부 서버와 인터넷 연결이 필요합니다. SPHEREx 레이어와 함께 켜면 좁은 시야에서 두 영상이 겹칩니다.
- 화면 공유 버튼은 위치·시간·보기 방식·좌표계·시야·레이어 설정과 SPHEREx 채널을 URL에 담습니다. 로컬 주소는 같은 PC에서만 열립니다. 배포한 주소에서 복사해야 다른 사람과 공유할 수 있습니다.
- 성능 설정은 렌더링 해상도 상한을 조절합니다. 브라우저의 그래픽 가속과 GPU 선택도 성능에 영향을 줍니다.

## SPHEREx 레이어의 동작 방식

- **원본:** IRSA의 SPHEREx DR1 전천 큐브 HiPS(`https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube`)입니다. 적도 좌표계, 차수 0~5, 512 px PNG 타일, 102개 채널로 이루어진 큐브입니다. 채널 c의 타일은 `Norder{K}/Dir{D}/Npix{N}.png`(c = 1) 또는 `Npix{N}_{c-1}.png`(c ≥ 2)입니다. 1년 동안의 관측을 평균한 영상이라 변화는 담겨 있지 않습니다.
- **채널 변환(per-channel rewriter):** 엔진의 HiPS 읽기 코드는 `<base>/Norder%d/Dir%d/Npix%d.<ext>`만 만들 수 있어 `_{z}` 접미사를 붙이지 못하고, 이 환경에서는 엔진을 다시 컴파일할 수 없습니다. 그래서 각 채널을 보통의 HiPS처럼 보이게 하는 작은 경로를 둡니다.
  - `GET /hips/spherex/<c>/properties` → 일반 영상 HiPS의 properties(`hips_order 5`, `hips_tile_format png`, `hips_frame equatorial`, `dataproduct_type image`, 출처 포함)
  - `GET /hips/spherex/<c>/Norder<k>/Dir<d>/Npix<n>.png` → 해당 채널의 IRSA 타일로 302 이동(`Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=86400`)
  - `Norder3/Allsky.png`는 IRSA의 같은 채널 Allsky 영상으로 이동하고, 나머지는 404입니다. GET·HEAD만 받습니다.
  - 구현: `scripts/spherex-hips.mjs`(Node), 채널표: `src/spherex-channels.js`. TrueBlink 사이트에서는 같은 규칙을 그 사이트의 함수가 제공합니다.
- **앱의 선택 순서:** `../hips/spherex/1/properties` → `./hips/spherex/1/properties` 순으로 확인합니다. 둘 다 없으면 IRSA에서 채널 1(0.75 µm)을 직접 불러오고, 파장 막대를 끈 뒤 카드에 이유를 표시합니다.
- **엔진 모듈:** 엔진에는 넓은 시야용 `milkyway`(시야 20° 이상에서 완전히 보이고 10° 아래에서 사라짐)와 좁은 시야용 `dss`(10° 이하에서 완전히 보이고 20° 위에서 사라짐) 두 HiPS 모듈이 있습니다. `stel.core.add('milkyway', {})`와 `stel.core.add('dss', {})`로 각각 **SPHEREx 전용 인스턴스**를 하나씩 더 만들어 같은 채널을 연결하므로 모든 시야에서 영상이 이어집니다. 그리기 순서(5, 6)가 별·선·이름보다 앞이라 이것들이 영상 위에 남습니다. `milkyway`는 데이터 소스를 한 번만 받으므로 채널을 바꾸면 새 인스턴스 한 쌍을 만들고, 새 타일이 도착할 시간(약 2.5초) 뒤에 이전 쌍을 숨기고 지웁니다.
- **밝기:** JavaScript에서 바꿀 수 있는 모듈 속성은 `visible`뿐입니다. 밝기는 엔진의 톤 매핑(`core.exposure_scale`, `core.tonemapper_p`)과 눈 적응(시야 안 가장 밝은 천체), 대기 밝기(`lwsky_average`)를 따르므로, 낮이나 달이 시야에 있을 때 영상이 어두워집니다. 별 밝기까지 바뀌므로 노출값은 건드리지 않았습니다.
- **정렬 확인(헤드리스 브라우저, 2026-11-14):** 오리온 벨트(Alnilam, 시야 4°)와 플레이아데스(Alcyone, 시야 2°)에서 엔진 별 위치와 SPHEREx 영상 속 별의 중심 차이는 하늘 보기 0.6′·0.16′, 전천 지도 0.25′·0.3′ 이하로, 타일 한 화소(약 13″) 안팎입니다. 전천 지도에서 은하면은 은하수 위치(백조자리–궁수자리–전갈자리)를 따라 나타납니다.
- **한계:** 밝은 별의 중심은 원본에서 값이 없는 화소(NaN, 투명)라 영상에서 검은 점으로 보입니다. 관측 시기가 다른 구역 사이에 배경 밝기 단차가 보일 수 있습니다(원본 자료의 특성). PNG는 화면용으로 늘린 영상이라 밝기 값으로 측광하면 안 됩니다. 타일은 IRSA에서 직접 받으므로 인터넷 연결이 필요합니다.

## TrueBlink와 연결

- **이 앱 → TrueBlink:** `<TrueBlink 주소>#ra=<도>&dec=<도>&name=<이름>`을 새 탭에서 엽니다. TrueBlink는 `name`이 있으면 좌표보다 이름 검색(CDS Sesame)을 먼저 하므로, 이름은 TrueBlink가 찾을 수 있을 때만 붙입니다. 시작 링크로 받은 이름(그 위치를 보고 있을 때), 선택한 별·성운·성단의 이름(M·NGC·IC 번호가 있으면 그 번호)이 여기에 해당합니다. 화면 중심 좌표와 행성·달 같은 태양계 천체는 `ra`·`dec`만 보냅니다. 이 앱이 `/sky/` 아래에서 실행되고 `../index.html`에 “TrueBlink”가 들어 있으면 `../`를 사용합니다. 그 밖에는 `index.html`의 `<meta name="trueblink-url">` 값(기본 `https://trueblink.pages.dev/`)을 사용합니다.
- **TrueBlink → 이 앱:** 쿼리 문자열로 다음을 받습니다. 기존 `lat`, `lon`, `time`, `layers` 등과 함께 쓸 수 있습니다.

| 매개변수 | 뜻 |
| --- | --- |
| `ra`, `dec` | ICRS 적경·적위(도). 해당 방향을 화면 중심에 둡니다. |
| `fov` | 시야(도). 하늘 보기 기본 30°, 전천 지도는 지정하지 않으면 360°를 유지합니다. |
| `view` | `sky`(기본, 지표면 유지) 또는 `allsky`(천구 좌표계 전천 지도) |
| `spherex` | 1~102. SPHEREx 레이어를 이 채널로 켭니다. 51·52는 가까운 채널로 바꿉니다. |
| `name` | 안내 메시지에 표시할 이름. 엔진 목록의 천체와 이름·위치(0.5° 이내)가 맞으면 선택합니다. |

- `view=sky`에서 대상이 지금 지평선 아래에 있으면 고도를 알려 주고 ‘전천 지도에서 보기’ 또는 ‘지표면 끄고 보기’를 제안합니다.
- 예: `./?ra=83.822&dec=-5.391&fov=30&name=M%2042&spherex=21`, `./?view=allsky&ra=56.87&dec=24.12&fov=60&spherex=60&name=Pleiades`

## 웹에 배포

`npm run build`로 만든 **`dist` 안의 전체 파일**을 정적 호스팅에 올리면 됩니다. 별도 Node 서버는 배포에 필요 없습니다. `dist/source`의 소스 배포와 라이선스 파일도 함께 올리세요.

### GitHub Pages

1. 이 프로젝트 폴더의 내용을 GitHub 저장소 루트에 올립니다. `engine/`의 JS와 WASM, `vendor/` 소스·데이터를 포함합니다. `dist/`는 빌드 과정에서 생성하므로 커밋하지 않습니다.
2. 저장소 **Settings → Pages → Source → GitHub Actions**를 선택합니다.
3. 포함된 `.github/workflows/pages.yml`이 `main` 푸시 또는 Actions의 수동 실행으로 사이트를 빌드·배포합니다.
4. Actions의 `github-pages` 배포 결과에 표시된 URL을 엽니다.

기존 저장소의 하위 폴더에 넣을 경우 워크플로의 작업 경로와 업로드 경로를 그 폴더에 맞게 수정해야 합니다. 현재 워크플로는 이 프로젝트가 저장소 루트에 있는 구성을 사용합니다.

### 그 밖의 정적 호스팅

- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
- Node.js: 22 이상
- 환경 변수·API 키·로그인: 필요 없음
- WASM 응답 MIME: `application/wasm`
- HTTPS 권장. 하위 경로 배포 지원(예: `/S/`). 자산 URL은 상대 경로에서 계산됩니다.
- SPHEREx 파장 선택에는 같은 사이트의 `/hips/spherex/` 채널 변환 경로가 필요합니다. 없으면 채널 1만 표시합니다.

### TrueBlink 사이트의 `/sky/`에 함께 배포

TrueBlink를 사이트 루트에, 이 앱의 `dist` 내용을 `/sky/`에, 채널 변환을 `/hips/spherex/`에 둡니다. 이 앱은 `../hips/spherex/`와 `../`(TrueBlink)를 자동으로 찾습니다. TrueBlink 쪽은 `./sky/`가 있을 때 ‘실시간 하늘에서 보기’ 링크를 보여 줍니다. 두 프로그램은 URL만 주고받으며 코드는 섞지 않습니다(TrueBlink: Apache-2.0, 이 앱: AGPL-3.0-only). `/sky/` 아래의 `source/`, `LICENSE-AGPL-3.0.txt`, `THIRD-PARTY-NOTICES.md`도 함께 올리세요.

## 폴더 구성

| 경로 | 용도 |
| --- | --- |
| `index.html`, `src/` | 한국어 화면과 엔진 연결 코드 |
| `engine/` | 이 소스에서 컴파일한 JS/WASM 배포 파일 |
| `vendor/stellarium-web-engine/` | 공식 엔진 소스, 외부 라이브러리와 기본 데이터 |
| `scripts/build.mjs` | 배포 파일 및 대응 소스 패키징 |
| `scripts/serve.mjs` | 로컬 미리보기 서버(SPHEREx 채널 변환 포함) |
| `scripts/spherex-hips.mjs` | SPHEREx 채널 변환 규칙(`/hips/spherex/`) |
| `src/spherex.js`, `src/spherex-channels.js`, `src/spherex.css` | SPHEREx 레이어·채널표·화면 |
| `scripts/build-engine.ps1` | 엔진 재컴파일 진입점 |
| `docs/ENGINE-API.md` | 데이터·좌표·엔진 API 참고 |
| `docs/ENGINE-BUILD.md` | 컴파일 환경과 적용한 패치 |
| `dist/` | 실제로 웹에 배포할 완성 파일 |

## 엔진을 다시 빌드할 때

일반 화면 수정과 웹 배포에는 `npm run build`만 필요합니다. C/C++ 또는 `vendor/.../src/js` 엔진 코드를 수정할 때만 Emscripten 컴파일이 필요합니다. 자세한 도구 버전과 절차는 `docs/ENGINE-BUILD.md` 및 `scripts/build-engine.ps1`을 참고하세요.

엔진 원본: `Stellarium/stellarium-web-engine`, commit `2103935134e09ba1715171241769fce03cebebe4`.
Emscripten은 원본의 `Dockerfile.jsbuild`와 같은 **1.39.17**을 사용합니다.

## 데이터와 확장 범위

기본 별·행성·별자리·은하수·지형은 엔진 저장소의 `apps/test-skydata`를 로컬로 포함합니다. 별 목록은 약 7등급까지인 시작용 데이터로, 전체 Stellarium 데이터베이스가 아닙니다. 기본 탐색은 외부 천체 API에 의존하지 않습니다.

v1.3.0에서 SPHEREx 적도 좌표계 영상 타일 레이어와 파장 선택 UI를 연결했습니다. 필요한 구역의 데이터 조회·스펙트럼 API는 연결하지 않았습니다. 엔진의 HiPS 모듈은 이미지용이며 FITS 수치 배열을 직접 분석하지 않습니다. 구체적인 제약과 API는 `docs/ENGINE-API.md`에 있습니다.

## 변경 사항(AGPL 고지)

이 프로그램은 같은 팀원이 만든 **Stellarium Web Lab v1.2.0**(AGPL-3.0-only)을 수정한 판입니다. 2026-11-14에 NASA Space Apps Challenge 2026 작업으로 다음을 바꾸었으며, 새 코드는 AI(Claude)의 도움을 받아 작성했습니다. 엔진(`engine/`, `vendor/`)은 바꾸지 않았습니다.

- 수정: `index.html`(SPHEREx 버튼·레이어 스위치·파장 카드, TrueBlink 버튼, 지평선 아래 안내, 이름·버전), `src/app.js`(레이어 연결, 시작 매개변수 `ra`·`dec`·`fov`·`view`·`spherex`·`name`, TrueBlink 링크, 전천 지도 배치), `scripts/serve.mjs`(`/hips/spherex/` 경로), `scripts/build.mjs`(버전·이름 표기), `package.json`(이름 `stellarium-web-lab-spherex`, 버전 1.3.0), `README.md`, `README.html`, `THIRD-PARTY-NOTICES.md`, `docs/ENGINE-API.md`(SPHEREx 레이어 절)
- 추가: `src/spherex.js`, `src/spherex-channels.js`, `src/spherex.css`, `scripts/spherex-hips.mjs`
- 원본 v1.2.0의 라이선스·고지 파일과 엔진 소스는 그대로 유지합니다. `npm run build`는 수정된 전체 소스를 `dist/source`에 함께 담습니다.

## 라이선스 및 출처

이 애플리케이션과 Stellarium Web Engine은 GNU AGPL v3로 배포됩니다. `LICENSE-AGPL-3.0.txt`, `THIRD-PARTY-NOTICES.md`와 엔진 소스 안의 각 외부 라이브러리 고지를 포함합니다. 배포 사이트의 도움말에서 대응 소스와 빌드 절차를 받을 수 있습니다. SPHEREx 영상 출처: NASA/JPL-Caltech/IPAC, IRSA — SPHEREx DR1 전천 큐브(DOI [10.26131/IRSA679](https://doi.org/10.26131/IRSA679)). This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration. 이 프로젝트는 Stellarium, NASA 또는 IRSA의 공식 서비스가 아닙니다.
