# 브라우저 검증 기록 — 2026-11-14 (KST)

현재 사용자가 선택한 범위는 실시간 PN/EOB 근사다. 아래는 연결된 Chrome에서 `tests/browser.html`의 실제 GravityHero/WebGL 렌더러를 조작해 관측한 결과다. 정밀 NR 검증이나 모든 장치의 성능 보장이 아니다.

## 전체 화면, 비스듬한 접근

- CSS host: 2035 × 1148. 렌더 버퍼: 3261 × 1840 (약 600만 픽셀 상한).
- 최초 단위 보정 c=562.5 px/s. resize 후에도 같은 값.
- 관측 단계: inspiral → plunge → merger → ringdown.
- 병합 1회, 모든 표시 상태 유한.
- 시작 1초를 제외한 첫 1200프레임: 평균 16.67ms, p95 17.6ms, 최대 18.4ms.
- 단계별 p95: inspiral 16.8ms, EOB plunge 17.5ms, merger 17.5ms, ringdown 17.6ms.
- 관측된 최대 물리 CPU 시간 1.5ms, draw 제출 CPU 시간 0.8ms. GPU 시간 자체를 timer query로 측정한 값은 아니다.

고정 픽셀 상한 전의 4070 × 2296 버퍼에서는 평균 16.9ms, 최대 83.9ms와 일부 긴 링다운 프레임이 관측됐다. 그래서 프레임별 해상도 변경 없이 사이징 단계의 상한을 적용했다.

## 정면 접근 중 resize

- 같은 세션에서 host 폭 2035→720px 변경.
- 상대 거리·속도·질량은 보존하며 모든 바디/GW 소스를 같은 카메라 변위로 이동한다. 창이 좁아졌다고 쌍을 삭제하지 않는다.
- CSS host 720 × 1148, 버퍼 1440 × 2296, c=562.5 동일.
- inspiral → plunge → merger → ringdown, 병합 1회, finite=true, unitsUnchanged=true.
- 1200프레임 평균 16.67ms, p95 17.4ms, 최대 17.8ms.

## 정확히 겹친 입력

- 테스트 초기 위치가 정확히 같은 두 바디.
- 병합 1회, finite=true, 예외 없음, WebGL 오류 없음.
- 물리적으로 가능한 두 독립 블랙홀 초기자료가 아니라 드래그 인터랙션의 0/0 회귀 검사다. 차가운 시작에서는 앞선 궤도 파형이 없으므로 단계 슬롯이 비어 있을 수 있다.

## 최종 성분 전환 — 실제 WebGL 픽셀

`병합 끝 렌즈 연결 검사` 버튼은 같은 sim/셰이더를 사용해 병합 연결 말기(morph t=6τ)와 단일 잔해 전환 후를 같은 시간·GW 버퍼·배경에서 draw/readPixels하여 비교한다.

- 최종 코드 / 좁은 viewport / 78,400픽셀: pass=true.
- 평균 RGB 채널 차이 0.5665 / 255.
- 최대 채널 차이가 24를 넘는 픽셀 비율 0.00134 (0.134%).
- glError=0.
- 검사 기준: 평균 채널 차이 <2, 큰 차이 픽셀 비율 <3%.
- 원본 DPR2·이전 전체 viewport 검사도 통과: 평균 0.5952/255, 큰 차이 비율 0.0012.
- 증거: `optical-continuity.jpg`.

이 검사는 마지막 렌즈 연결의 화면 연속성 검사다. 카오스적인 전체 운동, 모든 드래그 조합, 실제 지평선 또는 복사 파형의 정확도를 보증하지 않는다.

## 나머지 확인

- 브라우저 console error/warn 없음(검증 페이지 확인 시점).
- Node 물리·연결 회귀 검사는 `node-tests.txt`.
- GPU 공간 연산자/구속식 차분 수렴은 `gpu-operators.json`.
- GPU BSSN의 장기 물리 자격 검증은 실패 상태이며 메인에서 실행하지 않는다. `nr-single-unqualified.json`과 HANDOFF_CODEX.md 참고.

## 메인 화면 직접 입력·접근성 최종 확인

- 실제 메인 탭에서 pointer press → move → release: drag=true로 잡힌 바디가 포인터 위치를 따라감. release 후 drag=false, 모든 바디 kin=false와 유한 좌표/속도 확인.
- Blink 링크 진입: running=false, active=false. 메인 복귀와 일반 실행 복원 확인.
- Chrome 개발용 prefers-reduced-motion 임시 에뮬레이션: reduce=true, ready=true, running=false, 물리 시간 t=0 확인. 에뮬레이션을 해제하고 reload했다.
- 최종 상태: reduce=false, running=true, ready=true, finite=true. 최종 console error/warn 없음.
- `main-verified.jpg`: 최종 메인 화면. `model-disclosure.jpg`: 수정된 물리 범위 설명.
- 실험 NR 단일체 자격 검사 최신 결과: N=64, T=30M, 323스텝, 평균 81.166ms/스텝. 반지름 5.01→4.13M로 ±5% 실패, runner 종료 코드 1. 메인 경로와 분리된 상태가 맞다.
