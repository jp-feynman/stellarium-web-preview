# SPHEREx Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPHEREx의 시간·파장별 관측에서 이동·변광·스펙트럼 특이 후보를 찾아 원관측 근거와 함께 검색하는 기능을 TrueBlink에 추가한다.

**Architecture:** 로컬 Python 분석 엔진 → 물리/학습 후보 합집합 → native 관측 재적합 → 근거·검색 묶음 → 기존 정적 React 앱. 물리 기준선을 먼저 완료하고 학습·언어 기능은 별도 검증 후 활성화한다.

**Tech Stack:** 기존 React/TypeScript/Vite/Vitest 유지. Python 3.11, NumPy/SciPy/Astropy/Pydantic/pytest/SQLite. PyTorch는 `ml` extra. JSON Schema 2020-12, Ajv 2020 검증, json-schema-to-typescript 생성. 구현 시 호환되는 실제 버전을 설치 검증하고 lockfile에 고정한다.

**Spec:** [설계서](../specs/2026-11-14-spherex-vision-design.md), [데이터·평가 계획](../specs/2026-11-14-spherex-vision-data-evaluation.md).

## Global Constraints

- 지금은 계획 작성 단계다. 아래 체크박스는 아직 수행하지 않은 **향후 구현 작업**이다. 현재 작성한 문서를 구현 완료로 세지 않는다.
- 모든 경로는 `trueblink/` 기준. `vision/`의 새 패키지가 분석을 소유하고 `src/core/vision/`이 앱과 연결한다. 기존 파일이 이미 생성·수정되었으면 다시 읽고 필요한 변경만 적용한다.
- 기존 `docs/ARCHITECTURE.md`와 `src/core/types.ts`의 좌표·시간·단위·표시 규칙을 지킨다. 기존 mJy와 새 µJy의 경계는 명시적 adapter로 처리한다.
- 과학 보정은 full CWAVE/CBAND/ePSF에 근거한다. display WCS-WAVE, cube, 생성 영상으로 대체하지 않는다. 결측은 0 관측이 아니며 JSON은 유한값/null만 허용한다.
- 원자료에 없는 지원 범위·유의도·성능을 주장하지 않는다. 유료 API, GPU 학습, 전천 다운로드를 기본 실행에 포함하지 않는다.
- 원 참조 프로젝트의 코드/자산을 복사하지 않는다. 새 소스의 AI 사용 주석과 `AI_USE.md`는 현재 프로젝트 정책에 맞춘다.
- 네트워크 라이브 검증은 고정 fixture 테스트와 분리한다. 이전 실패를 숨기기 위해 테스트를 제거하거나 현재 앱의 미완성 부분을 무관하게 재작성하지 않는다.
- 현재 디렉터리는 git 저장소가 아님을 확인했다. 계획 때문에 git을 초기화하지 않는다. 구현 시 이미 저장소가 생겼다면 그때의 규칙과 상태를 따른다.

## Review Focus

| 실패 위험 | 반드시 검토할 증거 |
|---|---|
| 파장·PSF 차이를 시간 변화로 판정 | T03/T05의 다른 SED·다른 파장 상수 천체, 비교 불가 상태, T10 G1 |
| 모델/주입기가 진짜 신호를 지우거나 같은 원자료로 평가 누출 | T04 타깃 제외 보정, T05 leave-one-epoch-out, T10/T11 노출·천체 연결 성분 분할 |
| 단위·픽셀 원점·관측자 기준계 불일치 | T01 µJy→mJy, T03 WCS/ePSF, T06 운동과 시차, T09 화면 방향 |
| 모델 점수·LLM 설명을 과학 확증으로 오인 | T07 점수 종류, T13 보정 gate, T15 근거/수치 검사 및 fallback |
| 색인에 없는 범위·부분 분석·잘못된 조건을 완전 검색처럼 표시 | T02 자원 상한, T08 query 의미와 null, T09 coverage, T16 재개·export 검증 |

---

## 작업 의존성과 파일 책임

`T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09`가 P1의 주 경로다. `T10`은 T03부터 준비하고 T06 결과로 P1을 검증한다. `T11 → T12 → T13 → T14`는 P2이며 G0/G1 통과가 필요하다. `T15`는 P3 선택 기능이다. `T16`은 출시할 기능만 모아 최종 확인한다.

| 경로 | 책임 |
|---|---|
| `vision/src/spherex_vision/contracts.py` | 직렬화 타입과 스키마의 단일 기준 |
| `vision/src/spherex_vision/ingest/` | 아카이브 발견, FITS 읽기, 보정 자료 연결 |
| `vision/src/spherex_vision/science/` | 관측 모델, 측광, 기준 영상, 후보, 운동/변광 적합 |
| `vision/src/spherex_vision/data/` | 분할, 주입, 학습 배열 준비 |
| `vision/src/spherex_vision/models/` | 공간·시간·파장 모델과 head |
| `vision/src/spherex_vision/search/` | 조건·문자·유사 검색, 선택적 언어 처리 |
| `vision/src/spherex_vision/evidence.py`, `provenance.py`, `pipeline.py` | 근거, 계보, 재개 가능한 실행 |
| `vision/tests/` | 독립 수치·계약·평가 검사 |
| `contracts/`, `scripts/generate-vision-contracts.mjs` | 생성 스키마와 TS 타입 생성 명령 |
| `src/core/vision/`, `src/app/vision/` | 검증된 산출물 읽기·검색·표시 |
| `tests/vision/`, `e2e/vision.spec.ts` | 같은 질의/단위 계약 및 화면 검증 |
| `public/vision/` | 소형 검증 export만. 대용량 원자료·checkpoint 제외 |
| `vision/runs/`, `vision/cache/` | 로컬 run 산출물·cache, 소스 관리 제외 |

### 공통 함수 타입

아래 타입은 T01의 `contracts.py` 또는 내부 수치 타입 `science/types.py`에 정의한다. Python의 배열 메모리 객체와 JSON 저장 경로를 혼동하지 않는다.

- `AnalysisRequest`: 사용자 선택, 시간 미지정 가능. 발견 후 `AnalysisConfig`의 실제 시간 범위를 확정한다.
- `InputManifest`: 발견된 노출·보정 목록, 객체 식별자, 실제 읽은 range 해시, coverage와 실패 상태.
- `ObservationStamp`: 저장 배열 참조와 metadata. `LoadedStamp`: 검증된 native NumPy 배열+같은 metadata.
- `CalibrationBundle`, `CalibrationState`: 보정 자료와 노출별 제한된 nuisance parameter/공분산.
- `Proposal`: 초기 위치/시간/경로 가설, 분기·출처·점수 종류·기여 노출 ID. 아직 Candidate가 아니다.
- `FitResult`: 측정 목록, 가설별 적합, 상태/사유. `Candidate`: 연관·중복 정리 후 검색 대상.
- `SearchIndex`, `SearchResult`, `StaticIndex`: 로컬 저장/질의 결과/브라우저용 한도 있는 export. 스키마에 정의한 동일 candidate ID를 사용한다.
- `ModelBatch`: `images[B,N,8,64,64]`, 관측 metadata, padding/reference masks, native 관측 참조 및 학습 라벨. `ModelOutput`: proposal maps, any-event/분기 logits, SED·운동·시간 기저의 저차원 초기값, 256차원 embedding.

배열 dtype/shape, null 가능성, enum, 공분산 좌표계는 타입 docstring과 JSON Schema에 함께 기록한다. public 함수 이름과 인자 순서는 아래 정의를 기준으로 한다.

## T01 — 기존 상태 확인과 계약 생성

**Files:** `vision/pyproject.toml`, `vision/uv.lock`, `vision/src/spherex_vision/{__init__,contracts,cli}.py`, `contracts/vision-v1.schema.json`, `scripts/generate-vision-contracts.mjs`, `src/core/vision/{types.generated,validate,adapters}.ts`, `vision/tests/test_contracts.py`, `tests/vision/contracts.test.ts`, `.gitignore`, `AI_USE.md`, `package.json`.

**Interface:** `export_schema(out: Path) -> None`; TS `parseCandidate(value: unknown): Candidate`, `parseRunManifest(value: unknown): RunManifest`, `toPhotPoint(value: Measurement, exposure: Exposure): PhotPoint`.

- [ ] 다시 파일 목록·관련 AGENTS·앱 entrypoint·타입·현재 테스트 상태를 확인하고 시작 상태를 기록한다. 기존 동시 작업은 덮어쓰지 않는다.
- [ ] Python 패키지와 `spherex-vision` CLI entrypoint, `dev`/`ml` extras를 만든다. baseline 설치가 torch/API 키를 요구하지 않게 한다.
- [ ] 설계서의 계약·enum·단위·상태를 Pydantic strict 모델에 정의한다. JSON alias는 문서의 camelCase를 사용한다.
- [ ] 현상별 `branchProbabilities`, 가설의 `scope`, `requires_refit`, signed change와 `motionKind`를 계약에 포함한다. any-event 확률과 광원 존재를 구분한다.
- [ ] Schema 2020-12를 생성하고 TS 타입과 Ajv 검증기를 연결한다. 자동 타입 변환/coercion과 알 수 없는 필드 허용을 기본으로 하지 않는다. 생성물 재생성 차이를 검사하는 `vision:contracts:check` 명령을 만든다.
- [ ] 동일 golden JSON으로 Python/TS의 수락·거부가 같음을 검사한다. `1000 µJy → 1 mJy`, 음의 flux, null, 알 수 없는 schema, NaN, 잘못된 공분산을 포함한다.
- [ ] `cd vision` 후 `uv run pytest tests/test_contracts.py`, 앱 루트에서 `npm run vision:contracts:check`와 `npm test -- tests/vision/contracts.test.ts`를 실행한다.

**Done:** G0 중 직렬화·단위 계약이 통과하고 기본 CLI 도움말이 CPU 환경에서 열린다.

## T02 — 아카이브 발견·cache·재개 가능한 입력 manifest

**Files:** `vision/src/spherex_vision/ingest/{archive,fits}.py`, `vision/src/spherex_vision/{provenance,pipeline}.py`, `vision/configs/pilot.json`, `vision/tests/test_ingest.py`, `vision/tests/test_resume.py`.

**Interface:** `discover_inputs(request: AnalysisRequest, cache: Path) -> tuple[AnalysisConfig, InputManifest]`; `load_native_stamp(exposure: ExposureRecord, region: SkyRegion, cache: Path) -> ObservationStamp`; `run_pipeline(config: AnalysisConfig, inputs: InputManifest, out: Path) -> RunManifest`.

- [ ] SIA 컬렉션·응답 열을 조사하고 `(obsId,detector)` 중복 처리 버전을 명시적 정책으로 선택한다. 불분명한 버전 우선순위는 기록하고 자동 비교에서 제외한다.
- [ ] HDU는 EXTNAME으로 찾는다. HTTP single Range/206 검증 및 필요한 압축 FLAGS 처리에 Astropy를 사용한다. 읽은 byte 범위와 hash만큼만 provenance를 주장한다.
- [ ] cache key에 원 객체 version/ETag, 보정 버전, 창 좌표를 넣는다. 다운로드 4개·CPU 4개·2,000 노출·20 GiB 상한을 config로 둔다.
- [ ] 단계별 atomic write, 3회 retry/backoff, 중단·재개·부분 실패를 구현한다. 부분 run이 기본 검색 export로 들어가지 않게 한다.
- [ ] 고정 메타데이터/로컬 HTTP fixture로 중복, 200 응답의 잘못된 full download, byte 손상, 취소, disk cap, 재개를 검사한다. 라이브 요청은 별도 `--live` 모드로만 실행한다.

**Done:** 같은 입력의 재개가 중복 계산 없이 같은 manifest를 만들고 미완료 범위를 정확히 남긴다. 동적 run ID와 시각 등 비본질 필드는 비교 규칙을 명시한다.

## T03 — 정밀 파장·ePSF·분산·좌표 연결

**Files:** `vision/src/spherex_vision/ingest/calibration.py`, `vision/src/spherex_vision/science/{types,units,geometry}.py`, `vision/tests/test_calibration.py`, `vision/tests/fixtures/calibration/`, `vision/reports/data-readiness.md`.

**Interface:** `resolve_calibration(exposure: ExposureRecord, cache: Path) -> CalibrationBundle`; `prepare_stamp(stamp: ObservationStamp, calibration: CalibrationBundle) -> LoadedStamp`.

- [ ] 공식 보정 자료 위치와 헤더 버전을 실제 노출에 연결한다. full CWAVE/CBAND, 분광 응답, 위치별 ePSF 지원 여부를 보고서로 남긴다.
- [ ] 배열 shape, 원 detector x0/y0, 픽셀 면적, MJD UTC와 좌표 기준계를 검증한다. ZODI 처리 상태를 enum으로 강제한다.
- [ ] science/background/display 별 FLAGS 정책을 읽고 version hash를 기록한다. SOURCE/OUTLIER의 일괄 삭제가 없음을 실제 fixture로 확인한다.
- [ ] 평가 문서의 6개 검출기·2개 layout fixture와 독립 Astropy 수치 비교를 만든다. 부정확한 표시용 파장만 있는 경우 science-ready 상태를 주지 않는다.
- [ ] WCS <0.001 pixel, 단위/정밀 보정 구현 상대오차 <10⁻⁵, ePSF 원점/정규화 검사를 수행한다. 실패한 regime을 보고서에 적는다.

**Done:** G0 자료 계약 통과. 미지원 보정 상태가 후속 파이프라인까지 명확히 전파된다.

## T04 — 제한된 보정과 native 관측 모델

**Files:** `vision/src/spherex_vision/science/{background,epsf,photometry,forward}.py`, `vision/tests/test_forward.py`, `vision/tests/test_photometry.py`.

**Interface:** `calibrate_field(stamps: list[LoadedStamp], controls: ControlCatalog, config: AnalysisConfig) -> CalibrationState`; `predict_native(stamp: LoadedStamp, hypothesis: SourceHypothesis, calibration: CalibrationState) -> NDArray[np.float64]`; `fit_photometry(stamp: LoadedStamp, sources: list[SourceHypothesis], calibration: CalibrationState) -> list[Measurement]`.

- [ ] `SourceHypothesis`에 위치/운동/시간별 flux·SED와 단위를 정의한다. `ControlCatalog`는 출처·시각 전파·타깃 제외 반경을 가진다.
- [ ] 공식 ePSF와 응답함수로 native pixel의 예상 표면밝기를 계산한다. 픽셀 적분·면적·정규화의 이중 적용을 막는다.
- [ ] 설계 6절의 시간 적분과 midpoint 허용 조건을 주입/검출/적합에서 공유한다. 적분 cap·짧은 flare·노출 중 이동을 검사한다.
- [ ] 비교 별/빈 하늘 기반 배경·작은 좌표/PSF/광도 보정을 제한된 파라미터로 적합한다. 타깃 제외와 과적합 진단을 기록한다.
- [ ] 이웃 광원과 배경을 함께 적합하고 측광 공분산/품질/음의 flux를 반환한다. singular fit은 null+사유로 끝낸다.
- [ ] 격리/혼잡 주입에서 단위·subpixel·타깃 신호 보존, 결측/잘림/나쁜 분산, 보정 파라미터 과적합을 검사한다.

**Done:** noise-free 주입의 진실값을 수치 허용오차 안에서 회수하고, noisy 예제에서 편향·오차를 계산할 수 있다.

## T05 — 파장 정합 기준 영상과 물리 후보 제안

**Files:** `vision/src/spherex_vision/science/{reference,detect,associate}.py`, `vision/tests/test_reference.py`, `vision/tests/test_detection.py`.

**Interface:** `build_reference(target: LoadedStamp, pool: list[LoadedStamp], calibration: CalibrationState, config: AnalysisConfig) -> ReferenceProduct`; `propose_baseline(stamps: list[LoadedStamp], calibration: CalibrationState, config: AnalysisConfig) -> list[Proposal]`; `associate_proposals(proposals: list[Proposal], config: AnalysisConfig) -> list[ProposalGroup]`.

- [ ] 현재 평가 노출 및 같은 epoch의 중복 기여를 제외하는 reference를 만든다. 모든 contributor ID를 저장한다.
- [ ] 파장 응답 비교 가능 여부를 판단하고 비교 불가이면 잔차 분석을 끈다. 다른 SED/검출기/파장 상수 천체를 변광으로 확증하지 않게 한다.
- [ ] 응답 overlap ≥0.95·중심 차이 ≤0.1 bandwidth 및 색 보정 오차 조건을 적용한다. 실제 응답함수나 SED 제약이 없으면 정밀 변광 확증을 보류한다.
- [ ] PSF/matched filter, 양·음 residual 제안, 단기 경로 shift-and-stack을 구현한다. 단일 노출 초기 |SNR| 4는 제안 문턱으로만 저장한다.
- [ ] 장기 이동·변광·스펙트럼 분기의 입력을 유지한다. 정적 catalog match 또는 느린 속도를 일괄 제거하지 않는다.
- [ ] 겹친 tile/epoch의 같은 가설을 연관하고 애매한 근접 이웃은 복수 가설로 보존한다. 경로 grid와 시행 횟수를 manifest에 넣는다.
- [ ] 자가 차감, 양/음 변광, 저 SNR 다중 노출 회수, tile 경계, 교차 트랙, static filter에 의한 slow-mover 손실을 검사한다.

**Done:** 후보의 출처와 지원 범위를 재현할 수 있고 reference leakage/색 변화 실패 예제를 방지한다.

## T06 — 이동·변광·스펙트럼 가설 재검증

**Files:** `vision/src/spherex_vision/science/{motion,variability,spectral,fit}.py`, `vision/tests/test_motion.py`, `vision/tests/test_hypotheses.py`.

**Interface:** `fit_candidate(group: ProposalGroup, stamps: list[LoadedStamp], calibration: CalibrationState, config: AnalysisConfig) -> FitResult`; `finalize_candidates(results: list[FitResult], run_id: str) -> list[Candidate]`.

- [ ] native 관측에서 정적/단기 이동/장기 이동/변광 가설을 비교한다. final measurement와 proposal score를 분리한다.
- [ ] 공유 국소 선형 SED, 추세/step/scatter 가설, rank/조건수/시간-파장 상관 검사를 설계 6.1대로 구현한다. 자유 노출별 flux로 정적/변광 가설을 동일하게 만들지 않는다.
- [ ] 관측자 위치·시각·위치 공분산을 전파하고 필요 시 trail을 노출시간 동안 적분한다. 시간/기준계가 불명확하면 정밀 운동 상태를 제한한다.
- [ ] 장기 운동·시차·변광의 최소 시점/기하 조건을 적용한다. 2시점 차이를 삭제하지 않되 tentative로 표시한다.
- [ ] 스펙트럼 특이성은 관측 범위·시각별 변광과 품질이 적합한 경우에만 계산한다. 없는 채널을 채워 anomaly score를 높이지 않는다.
- [ ] empirical null calibration 전 결과는 raw score로 기록한다. 시험 횟수를 무시한 단일 Gaussian 유의도로 승격하지 않는다.
- [ ] 0 운동, 느린 운동, 관측자 시차, degenerate cadence, 혼잡, 음의 flux, 불확실성 누락 사례를 검사한다.

**Done:** `supported/tentative/insufficient_data/out_of_domain`이 근거를 가지며 수치가 해석 가능한 단위와 범위를 가진다.

## T07 — 근거 패키지와 재현 가능한 내보내기

**Files:** `vision/src/spherex_vision/evidence.py`, `vision/src/spherex_vision/search/export.py`, `vision/tests/test_evidence.py`.

**Interface:** `build_evidence(candidate: Candidate, inputs: InputManifest, out: Path) -> EvidenceBundle`; `export_bundle(run: RunManifest, candidates: list[Candidate], out: Path) -> ExportManifest`.

- [ ] 원/native·표시·reference·difference 자산에 ID/hash와 기여 노출을 붙인다. 차분이 없으면 이유를 기록한다.
- [ ] 같은 sequence의 공통 stretch, 시간·파장·마스크·방향을 저장한다. 정량 측정은 native fit에서만 가져온다.
- [ ] 측광 CSV, candidate/evidence JSON, run manifest를 export한다. raw score, calibrated probability, review status를 다른 컬럼으로 둔다.
- [ ] 배열→JSON에서 NaN을 null+상태로 변환한다. 끊어진 evidence ID, hash 불일치, 범위 밖 경로, incomplete run export를 거부한다.
- [ ] 같은 입력/config/code/model로 scientific payload hash가 같음을 검사한다. createdAt 같은 실행 기록은 해시 대상에서 분리한다.

**Done:** 후보 하나에서 원자료와 분석 조건으로 역추적할 수 있다.

## T08 — 조건·문자 검색과 결정적 기본 파서

**Files:** `vision/src/spherex_vision/search/{query,index,ranking}.py`, `src/core/vision/{search,query}.ts`, `vision/tests/test_search.py`, `tests/vision/search.test.ts`, `contracts/fixtures/search-cases.json`.

**Interface:** `parse_query(text: str, context: QueryContext) -> ParseResult`; `build_index(candidates: list[Candidate], run: RunManifest, out: Path) -> SearchIndex`; `search(index: SearchIndex, query: SearchQuery) -> SearchResult`; TS `searchStatic(index: StaticIndex, query: SearchQuery): SearchResult`.

- [ ] query v1의 허용 필드/op/단위/범위와 `executable=false`를 구현한다. 미지원 문구를 조용히 삭제하지 않는다.
- [ ] 범위 내 측정에서 signed 변화/최대 SNR을 계산한다. 운동/확률 fit의 기여 측정이 범위를 벗어나면 `requires_refit`를 반환한다. 단기·장기 선택과 분기 확률 조건을 명시한다.
- [ ] SQLite 조건·FTS와 정확한 구면 영역 검사를 구현한다. Python/TS의 shared fixture로 동일 numeric predicate와 null 정책을 유지한다.
- [ ] 한국어/영어 기본 수치·시간·파장·분기 패턴을 파싱한다. 해석한 조건과 가정은 UI가 표시할 수 있는 형태로 반환한다.
- [ ] relevance 순위와 tie-break를 결정적으로 만든다. similarity가 아직 없으면 지원 불가 상태를 반환한다.
- [ ] RA 경계/극점, arcsec/hour/year, µJy/mJy, 미분석 영역, 없는 probability, 미해석 필수 조건을 검사한다.

**Done:** 구조화 검색과 기본 자연어 조건 검색이 API 없이 동작하고 위반 0건이다.

## T09 — TrueBlink 후보 탐색·근거 화면

**Files:** `src/core/vision/{load,index,adapters}.ts`, `src/app/vision/{VisionPanel,CandidateList,EvidencePanel,QueryChips}.tsx`, `src/app/vision/store.ts`, 현재 앱의 실제 entrypoint, `src/app/i18n.ts`, `tests/vision/load.test.ts`, `e2e/vision.spec.ts`.

**Interface:** `loadVisionIndex(url: string, signal?: AbortSignal): Promise<StaticIndex>`; `loadEvidence(url: string, signal?: AbortSignal): Promise<EvidenceBundle>`; `candidateToOverlays(candidate: Candidate): Overlay[]`.

- [ ] 실제 존재하는 React shell에 기능을 연결한다. entrypoint가 미완성이면 기존 목표의 최소 shell 통합을 별도 변경으로 기록하고 테스트할 수 있게 만든다.
- [ ] 선택 영역·coverage·완료 상태·검색 조건 칩·후보 분기·잠정 상태를 표시한다. 입력 변경 시 이전 요청을 취소한다.
- [ ] 기존 blink view에 검증된 frame/overlay adapter를 연결한다. µJy→mJy와 원좌표 방향을 확인한다.
- [ ] 원영상/비교/잔차, 광도곡선 오차, 이동 궤적, 기여 노출, 알려진 천체/미일치 상태, CSV/JSON export를 제공한다.
- [ ] 미분석 영역과 검출 0건, 깨진 자산, 이전 schema, 모델 미설치, 파장 비교 불가를 각각 표시한다.
- [ ] `npm run typecheck`, 관련 Vitest, `npm run build`, 고정 export를 사용하는 실제 브라우저 확인을 실행한다. 빌드가 기존 미완성으로 실패하면 원인과 본 변경 영향 범위를 구분한다.

**Done:** P1의 실제 또는 명확히 표시된 고정 관측 묶음을 선택→검색→근거 확인까지 볼 수 있다. 합성 데모를 관측 결과로 표시하지 않는다.

## T10 — blind injection과 기준선 평가

**Files:** `vision/src/spherex_vision/data/{inject,split}.py`, `vision/src/spherex_vision/evaluate.py`, `vision/tests/test_injection.py`, `vision/tests/test_split.py`, `vision/tests/test_metrics.py`, `vision/configs/benchmark-v1.json`, `vision/reports/baseline.md`.

**Interface:** `assign_splits(inputs: InputManifest, sources: SourceCatalog, seed: int) -> SplitManifest`; `inject_native(stamps: list[LoadedStamp], truth: InjectionCatalog, config: InjectionConfig) -> InjectionDataset`; `evaluate_run(run: RunManifest, truth: EvaluationTruth, benchmark: BenchmarkConfig) -> EvaluationReport`.

- [ ] 원 노출/중첩 영역/천체 identity 연결 성분으로 분할한다. 연결 성분이 너무 크면 조용히 쪼개지 않고 영역 선택을 수정한다.
- [ ] native IMAGE에서 전처리 이전 주입하고 truth는 탐지 입력에서 분리한다. source noise 단위 변환이 불확실하면 background-dominated 범위로 제한한다.
- [ ] 실제 하늘 층화·pilot·고정 test manifest와 분기별 usable area/캠페인을 정의한다. 후보 episode 중복을 제거한다.
- [ ] 회수율·bias·coverage·false episodes/deg², 영역 bootstrap CI를 계산한다. 부족한 분모는 inconclusive로 표시한다.
- [ ] G0/G1과 정적 색 변화 반례를 평가하고 보고한다. 단일 노출 threshold와 경로 시행 횟수의 관계를 null 실험으로 보정한다.
- [ ] 실제 후보 검토가 없으면 자동 unmatched negative를 만들지 않는다. G2용 표본 확보 전에는 학습 승격 평가 완료를 선언하지 않는다.
- [ ] 최종 후보 합집합 전수 검토와 분기 라벨을 지원한다. 미검토가 있으면 inconclusive, uncertain은 오탐 예산에서만 보수적으로 false로 계산한다.

**Done:** P1의 지원 범위와 실패 조건이 문서화되고 P2에 사용할 고정 평가 체계가 생긴다.

## T11 — 모델 입력과 학습 자료 집합

**Files:** `vision/src/spherex_vision/data/{dataset,tensors,augment}.py`, `vision/tests/test_tensors.py`, `vision/tests/test_augmentation.py`, `vision/configs/train-v1.json`.

**Interface:** `build_model_batch(samples: list[TrainingSample], normalization: NormalizationState) -> ModelBatch`; `prepare_dataset(inputs: InputManifest, split: SplitManifest, out: Path) -> DatasetManifest`.

- [ ] 8 plane와 metadata/mask의 정확한 순서를 고정한다. 원자료와 모델 배열을 분리하고 reference 없는 경우를 표현한다.
- [ ] intensity scale은 train에서만 정하고 물리 단위 feature와 변환 계수를 저장한다. 분산·mask 재투영을 검증한다.
- [ ] 128관측 chunk+16중첩, 전체 chunk 요약과 중복 가중 제거를 구현한다. 129/256/1,000관측도 조용히 버리지 않는다.
- [ ] 회전/반사 증강 시 WCS·운동 벡터·PSF·mask도 함께 변환한다. 시간 뒤집기·임의 파장 교환처럼 물리 관계를 깨는 증강은 기본 금지한다.
- [ ] 모든 파생본의 split 불변성, 정보 누출, 결측 0과 관측 0의 구분, 노출별 최대값 정규화 금지를 검사한다.

**Done:** 텐서가 손실 없이 원 관측 ID와 연결되고 분할·단위·결측 의미가 보존된다.

## T12 — 공간·시간·파장 인코더와 독립 후보 head

**Files:** `vision/src/spherex_vision/models/{encoder,temporal,heads,model,forward_torch}.py`, `vision/tests/test_model.py`, `vision/tests/test_forward_torch.py`.

**Interface:** `SpherexVisionModel.forward(batch: ModelBatch) -> ModelOutput`; `propose_learned(model: SpherexVisionModel, batch: ModelBatch, config: ProposalConfig) -> list[Proposal]`.

- [ ] 설계의 CNN `[32,64,128,256]`, 4층 8-head width-256 attention, 연속 시간·파장 Fourier encoding, 2층 chunk-summary attention을 구현한다.
- [ ] 공간 proposal heatmap·offset, 다중 라벨 logits, 관측별 물리 초기값과 normalized 256D embedding을 분리한다.
- [ ] any-event head와 분기 head의 라벨 마스크를 분리한다. 물리 초기값은 공유 SED·운동·시간 기저 계수로 제한한다.
- [ ] 모델 스캔 영역은 baseline proposal 주변으로만 제한하지 않는다. 타일 경계 overlap과 sky 좌표 복원을 검사한다.
- [ ] 관측 함수의 미분 가능한 PyTorch adapter를 만들고 T04 NumPy forward와 값/gradient finite difference를 비교한다. SciPy fit을 그대로 autograd에 연결하지 않는다.
- [ ] 배열 순서 permutation, padding, 모두 결측, 매우 긴 시계열, 단일 관측, 동일 모양/다른 시간·파장 조건을 검사한다.
- [ ] 작은 주입 집합에서 학습 손실 감소와 물리 초기값의 방향/단위를 확인한다. 이를 실제 관측 성능으로 보고하지 않는다.

**Done:** 학습 가능한 완전한 전방 경로와 baseline 밖 후보 제안이 있으며 메모리 사용량을 측정했다.

## T13 — 학습·보정·ablation과 승격 판단

**Files:** `vision/src/spherex_vision/{train,calibrate_model}.py`, `vision/src/spherex_vision/models/losses.py`, `vision/tests/test_losses.py`, `vision/tests/test_calibration_gate.py`, `vision/reports/model-card.md`, `vision/reports/ablation.md`.

**Interface:** `train_model(config: TrainConfig, dataset: DatasetManifest, out: Path) -> ModelArtifact`; `calibrate_model(model: ModelArtifact, validation: DatasetManifest) -> CalibrationArtifact`; `decide_promotion(report: EvaluationReport, gates: GateConfig) -> PromotionDecision`.

- [ ] masked pretrain, 주입/실제 미세조정, supervised contrastive의 분리 실행과 재개를 구현한다. 손실의 결측 라벨·정규화·가중치는 설계서와 일치시킨다.
- [ ] seed 3개와 학습 예산을 기록한다. 최대 72 GPU-hour/50 epoch/patience 8, validation-only tuning을 적용한다.
- [ ] B0–B4 ablation을 같은 고정 test와 후단 물리 적합으로 비교한다. 후보 합집합을 쓰되 순위·계산 예산의 차이도 함께 보고한다.
- [ ] 대표성 있는 실제 validation 라벨로 probability calibration과 OOD 문턱을 정한다. 없으면 `probabilityReal=null`로 남긴다.
- [ ] 분기별 ≥200개 라벨·class별 ≥50개 및 표집 가중치를 검사한다. 모든 미지 분기를 false로 취급하거나 분기 확률 max를 any-event 확률로 쓰지 않는다.
- [ ] G2 개선/오탐/편향/coverage 및 표본 충분성을 자동 평가한다. test를 본 뒤 문턱을 바꾼 run은 새 benchmark로 구분한다.
- [ ] model card에 학습 범위, checkpoint/hash, 지원 파장/운동/혼잡, 실패 예제, 비용, 승격 여부를 기록한다.

**Done:** 성공/실패/inconclusive 어느 결과든 근거와 함께 남고, 미통과 모델이 기본 검색 점수로 켜지지 않는다.

## T14 — 후보 합집합·유사 검색 통합

**Files:** `vision/src/spherex_vision/pipeline.py`, `vision/src/spherex_vision/search/embeddings.py`, `src/core/vision/similarity.ts`, `src/app/vision/VisionPanel.tsx`, `vision/tests/test_union.py`, `tests/vision/similarity.test.ts`.

**Interface:** `merge_proposals(baseline: list[Proposal], learned: list[Proposal], config: AnalysisConfig) -> list[ProposalGroup]`; `embed_candidates(model: ModelArtifact, batches: Iterable[ModelBatch]) -> EmbeddingArtifact`; `rank_similar(embeddings: EmbeddingArtifact, query_id: str, eligible_ids: list[str], limit: int) -> list[RankedCandidate]`.

- [ ] baseline/learned/both 출처를 유지해 후보를 합치고 T06으로 재검증한다. baseline 후보가 모델 negative 때문에 사라지지 않게 한다.
- [ ] 구조화 필터 뒤 정확한 cosine 검색과 RRF를 구현한다. 10,000개 한도를 넘으면 샤드 분할 상태를 표시하고 일부만 검색한 결과를 전역 결과처럼 보이지 않게 한다.
- [ ] 임베딩마다 모델/정규화 버전을 기록한다. 서로 다른 공간의 벡터를 섞지 않는다.
- [ ] B5와 G3, 동일 후보 제외, tie, 0/NaN vector, 필터 밖 높은 유사도 후보를 검사한다.
- [ ] P2 기능 상태와 순위 이유를 UI에 연결하고 baseline-only fallback을 유지한다.

**Done:** 추가 후보 회수와 유사 검색이 실제 근거 화면까지 연결되고 모델 버전 혼용이 없다.

## T15 — 선택적 자연어 모델과 근거 설명

**Files:** `vision/src/spherex_vision/search/{language,explain}.py`, `vision/prompts/{parse-query,explain-evidence}.md`, `vision/tests/test_language.py`, `src/app/vision/EvidencePanel.tsx`.

**Interface:** `parse_query_with_model(text: str, context: QueryContext, provider: LanguageProvider) -> ParseResult`; `explain_candidate(evidence: EvidenceBundle, provider: LanguageProvider | None) -> Explanation`.

- [ ] provider-independent interface와 명시적 opt-in 설정을 만든다. 기본은 결정적 파서/설명이며 API 키는 로컬 환경에서만 읽는다.
- [ ] LLM 출력은 SearchQuery 검증을 통과해야 실행한다. 고정 60쌍 질의로 수치·기간·단위·미지원 조건 보존을 확인한다.
- [ ] 선택 후보의 원/비교/차분과 측정만 제공하고 각 claim에 evidence/measurement ID를 요구한다. 수치는 renderer가 측정값에서 삽입한다.
- [ ] 잘못된 ID·없는 수치·무근거 확정 표현·모델 오류 시 결정적 설명으로 fallback한다. prompt/model hash와 실행 비용을 기록한다.
- [ ] B6/G4를 평가한다. LLM 자체 점수만으로 gate를 통과시키지 않고 사람이 확인한 표본의 수/불확실성을 보고한다.

**Done:** 언어 모델이 없어도 검색이 작동하고, 켜져 있을 때도 측정 근거가 최종 숫자와 조건을 결정한다.

## T16 — 선택 단계의 통합 검증과 운영 문서

**Files:** `vision/README.md`, `vision/reports/release-readiness.md`, `public/vision/manifest.json` 및 소형 검증 묶음, `e2e/vision.spec.ts`, 필요 시 프로젝트 CI 설정.

- [ ] 출시 범위를 P1/P2/P3로 명시하고 해당 Gate 결과를 연결한다. 선택하지 않은 단계의 체크박스를 완료로 바꾸지 않는다.
- [ ] `cd vision` 후 `uv run pytest`, 앱 루트에서 `npm run vision:contracts:check`, `npm test`, `npm run typecheck`, `npm run build`를 수행한다. ML 테스트는 `uv sync --extra ml --extra dev` 환경에서 추가 실행한다.
- [ ] 고정 관측 묶음으로 영역 선택→검색→근거→내보내기를 브라우저에서 확인한다. cancellation, partial coverage, schema/asset 손상도 확인한다.
- [ ] 분석 job 취소/재개, cache invalidation, 모델 미설치, 정밀 보정 누락을 실제 실행으로 확인한다. 같은 manifest로 재현하는 명령을 남긴다.
- [ ] 데이터 다운로드/peak memory/query p95를 기록하고 한도를 넘으면 지원 규모를 줄여 명시한다. 수치를 측정 없이 채우지 않는다.
- [ ] 실행 방법·지원 범위·알려진 실패·재학습 조건·보정 버전 업데이트 절차를 기록한다. 외부 배포는 이 구현 계획의 자동 실행에 포함하지 않는다.

**Done:** 선택한 단계가 재현 가능하고 검증 결과·제한·산출물이 사용자에게 제시된다.

## 명령 인터페이스와 완료 산출물

미래 구현의 명령은 다음으로 고정한다. `prepare`는 AnalysisRequest를 받아 실제 config/inputs를 내보낸다. `analyze`는 그 manifest를 사용하므로 아카이브가 변해도 입력이 암묵적으로 바뀌지 않는다.

```bash
cd vision
uv sync --extra dev
uv run spherex-vision prepare --request configs/pilot.json --out runs/pilot-input
uv run spherex-vision analyze --inputs runs/pilot-input/inputs.json --out runs/pilot
uv run spherex-vision evaluate --run runs/pilot/manifest.json --benchmark configs/benchmark-v1.json
uv run spherex-vision export --run runs/pilot/manifest.json --out ../public/vision/pilot
```

`analyze --resume`는 같은 config/input 해시에만 적용한다. `train --config configs/train-v1.json`은 ML 의존성과 데이터 준비를 검사하며 baseline 명령에서 자동 실행하지 않는다. 모델을 사용하는 분석은 `--model <model-artifact.json>`를 명시하고, artifact의 promotion 상태를 기록한다.

필수 산출물: 자료 준비 보고서, baseline 보고서, 선택한 경우 model card/ablation, candidate/evidence/manifest export, 검색 화면, 실행 README. 모델 파일이 없는데 `AI 학습 완료`로 표시하지 않는다.

## 요구사항과 작업의 대응

| 요구사항 | 구현 작업 | 검증 |
|---|---|---|
| R1 영역과 coverage | T02/T08/T09 | 경계·부분 실행·미분석/0결과 구분 |
| R2 이동·변광·분광 | T05/T06/T12/T14 | 분기별 주입, 느린 이동, 음의 변광 |
| R3 관측 물리와 오차 | T03/T04/T05/T06 | G0/G1, 색 변화 반례, covariance |
| R4 근거 추적 | T07/T09/T15 | 원노출/수치/claim ID 참조 검사 |
| R5 검색 | T08/T09/T14/T15 | G3/G4, 양 언어 질의, 수치 조건 0위반 |
| R6 학습 효과 | T10/T11/T12/T13 | 고정 split, B0–B6, G2 |
| R7 재현과 실패 | T01/T02/T07/T16 | hash, 재개, 불완전 상태, schema |
| R8 기존 앱 통합 | T01/T09/T16 | 단위 adapter, 기존 테스트/빌드, 화면 |

## 공수와 진행 기준

한 명의 구현 담당자 기준 초기 작업량 추정: P0 4–7일, P1 10–18일, P2 10–20일+학습/검토 대기, P3 3–6일. 기존 앱 완성도, 정밀 보정 접근성, 라벨 확보에 따라 바뀐다. 일정 약속이 아니며 T03/T10 결과 후 다시 산정한다. GPU 예산과 사람이 검토할 표본은 별도 자원이다.

구현이 시작되면 각 작업의 실제 결과와 근거를 체크박스 옆 또는 run 보고서에 남긴다. 기본 실행은 `executing-plans`로 이 순서를 따르며, 새로운 구현 위임이 없는 한 임의로 여러 구현 에이전트를 생성하지 않는다.

도구 계약의 1차 문서: [Pydantic JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/), [Ajv JSON Schema 버전](https://ajv.js.org/json-schema.html), [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript). 실제 호환성과 생성 결과는 T01에서 검증한다.
