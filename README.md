# OptiImage

브라우저에서 모든 작업이 끝나는 이미지 편집 툴킷 (1차 MVP). 파일은 서버로 전송되지 않으며, 리사이즈·포맷 변환·크롭 등 모든 연산은 Canvas API와 Web Worker를 통해 클라이언트에서만 수행됩니다.

## 1. 폴더 구조

```
src/
  components/ui/       shadcn/ui 스타일의 프리미티브 (Button, Slider, Dialog, Toast ...)
  features/
    upload/             Drag & Drop 진입점 (Dropzone)
    editor/             메인 편집 UI (TopBar, FileList, PreviewCanvas, SettingsPanel, StatusBar)
      panels/            Resize/Format/Rotate/Crop/배경제거(AI)/Rename 개별 설정 패널
    batch/              일괄 내보내기 다이얼로그 (ZIP)
    ai/                 AI 플러그인 인터페이스 + 배경 제거 구현체 (OCR은 스텁)
  hooks/                useFileDrop, useAutoProcess, useCropOverlay, useKeyboardShortcuts ...
  lib/                  순수 함수 (이미지 파이프라인, 파일명 규칙, 포맷팅, 다운로드/zip)
  store/                Zustand 스토어 (useImageStore, useUiStore, useThemeStore)
  types/                도메인 타입 (image.ts, worker.ts)
  workers/              image.worker.ts (실제 연산) + imageWorkerClient.ts (Promise 래퍼)
```

## 2. 아키텍처 — Worker 통신 구조

무거운 연산(크롭·회전·리사이즈·인코딩)은 전부 `src/workers/image.worker.ts`에서 실행되어 메인 스레드(UI)를 절대 막지 않습니다.

```
UI 컴포넌트 → useImageStore.processImage(id)
            → createImageBitmap(file)              (메인 스레드, 디코딩만)
            → imageWorkerPool.process(bitmap, ...)  (Transferable로 워커에 전달, 복사 없음)
                 └─ Worker Pool (hardwareConcurrency 기준 최대 4개)
                      └─ image.worker.ts
                           1) OffscreenCanvas로 crop
                           2) rotate
                           3) flip
                           4) resize
                           5) convertToBlob(format, quality)
                      └─ postMessage({type:'success', blob, width, height})
            ← Promise resolve → store 상태 갱신 (result, status, log)
```

- `ImageBitmap`은 `postMessage`의 두 번째 인자(transfer list)로 전달되어 **복사 없이 소유권만 이전**됩니다.
- 워커 풀은 idle 워커에 라운드로빈으로 작업을 분배하고, 모든 워커가 바쁘면 내부 큐에 대기시킵니다.
- 요청/응답은 `requestId`로 매칭되는 Promise 기반 API(`imageWorkerClient.ts`)로 감싸져 있어 컴포넌트는 워커의 존재를 몰라도 됩니다.
- 진행률(`progress` 메시지)은 크롭→인코딩 단계별로 전송되어 하단 상태바 진행바에 반영됩니다.

## 3. 컴포넌트 설계

```
App
 ├─ TopBar            파일 추가 / 일괄 처리 / 다운로드 / 테마 토글
 ├─ FileList (좌측)    업로드된 이미지 목록, 체크박스 다중 선택, 상태 아이콘
 ├─ PreviewCanvas (중앙) Before/After 슬라이더 비교, 크롭 오버레이
 ├─ SettingsPanel (우측) 압축률 카드 + Undo/Redo + Resize/Format/Rotate/Crop/Rename 탭
 ├─ StatusBar (하단)   배치 진행률 + 접이식 작업 로그
 ├─ Dropzone          이미지가 없을 때의 빈 상태 (클릭 또는 드래그)
 └─ BatchExportDialog  선택/전체 내보내기 + 압축 통계 + ZIP/단일 다운로드
```

각 설정 패널(`features/editor/panels/*`)은 `useImageStore`의 활성 이미지(`activeId`)에서 `settings`를 읽고 `updateSettings`로 즉시 미리보기를 갱신하며, 슬라이더의 `onValueCommit`이나 버튼 클릭 시 `commitHistory`로 undo 스택에 스냅샷을 남깁니다.

## 4. 상태관리 구조 (Zustand)

- **`useImageStore`** — 도메인 상태의 단일 소스
  - `images: ImageItem[]` — 각 항목은 `source`(원본), `settings`(편집값), `result`(처리된 Blob/URL), `history`/`historyIndex`(undo 스택)를 가짐
  - `activeId`, `selectedIds` — 미리보기 대상과 배치 작업 대상
  - `logs`, `batchProgress` — 하단 상태바용
  - `renameRule` — 내보내기 파일명 규칙
  - 액션: `addFiles`, `updateSettings`, `commitHistory`, `undo/redo`, `processImage`, `processMany`, `removeImage`, `clearAll` 등
- **`useUiStore`** — 순수 UI 상태 (선택된 도구 탭, 로그 패널 열림 여부, 내보내기 다이얼로그 열림 여부)
- **`useThemeStore`** — `zustand/persist`로 localStorage에 저장되는 라이트/다크/시스템 테마 선택

이미지 편집값(`EditSettings`)과 undo 히스토리를 `ImageItem` 단위로 두어, 여러 이미지를 동시에 열어도 각자 독립적인 undo/redo가 가능합니다.

## 5. 핵심 기능 구현 메모

- **Resize**: `원본 유지 / 사용자 지정 / 긴 변 기준 / 비율(%)` 4가지 모드. 사용자 지정은 비율 유지 스위치 지원.
- **Format**: PNG(무손실) / JPG / WEBP. PNG 선택 시 품질 슬라이더는 자동 비활성화(브라우저가 quality 파라미터를 무시하기 때문).
- **Crop**: 미리보기 위에서 포인터 드래그로 영역 지정 (`useCropOverlay`가 렌더링 좌표 → 원본 픽셀 좌표로 변환), 1:1/4:3/16:9 프리셋 제공.
- **EXIF 제거**: 별도 라이브러리 없이 Canvas 재인코딩(`convertToBlob`) 과정에서 자동으로 제거됨 — Canvas는 픽셀만 다시 그리므로 원본의 EXIF/메타데이터가 결과물에 포함되지 않음.
- **파일명 규칙**: `{name}`, `{number}`(3자리 패딩), `{date}` 토큰을 지원하는 `applyRenameRule` (`lib/fileNaming.ts`), 시작 번호 지정 가능.
- **Batch/ZIP**: `BatchExportDialog`에서 선택 항목(없으면 전체)을 대상으로 미처리 이미지를 자동 처리한 뒤 `JSZip`으로 묶어 다운로드.
- **압축률 표시**: 원본 용량 / 결과 용량 / 절감률(%)을 단일 이미지(`CompressionStats`)와 배치(`BatchExportDialog`) 양쪽에서 표시.
- **Undo/Redo & 단축키**: `Ctrl/Cmd+Z`(undo), `Ctrl/Cmd+Shift+Z` 또는 `Ctrl/Cmd+Y`(redo), `Ctrl/Cmd+S`(활성 이미지 처리 후 즉시 다운로드).
- **Toast/로딩**: Radix Toast 기반 알림, 처리 중에는 미리보기 위에 스피너 오버레이 + 하단 진행바.

## 6. AI 기능 — 배경 제거

`src/features/ai/`는 브라우저 내 AI 플러그인을 위한 공통 인터페이스입니다.

```ts
// src/features/ai/types.ts
export interface AiPlugin<TOptions = Record<string, unknown>, TResult = Blob> {
  id: string
  name: string
  description: string
  isReady: boolean
  run: (input: {
    bitmap: ImageBitmap
    options?: TOptions
    onProgress?: (progress: number) => void
  }) => Promise<TResult>
}
```

- **배경 제거** (`features/ai/background-removal/`): [`@imgly/background-removal`](https://github.com/imgly/background-removal-js)(ONNX Runtime Web, ISNet 모델)로 구현되어 있습니다. SettingsPanel의 "AI" 탭에서 토글하면 `useImageStore.processImage`가 원본 비트맵에 대해 먼저 배경을 제거한 뒤, 그 결과(RGBA PNG)를 기존 crop→rotate→flip→resize→encode 파이프라인에 그대로 태워 처리합니다.
  - 모델/WASM 자산(약 40MB, `isnet_quint8`)은 IMG.LY CDN에서 첫 실행 시에만 내려받아 브라우저 캐시에 저장됩니다. **이미지 자체는 절대 서버로 전송되지 않으며**, 내려받는 것은 범용 모델 파일뿐입니다.
  - 실제 추론은 라이브러리가 내부적으로 띄우는 자체 Web Worker에서 실행되어 메인 스레드를 막지 않습니다. 초기 번들 크기를 지키기 위해 `background-removal/index.ts`에서 `@imgly/background-removal`을 동적 `import()`로 불러오므로, 기능을 켜지 않는 사용자는 이 코드를 전혀 내려받지 않습니다.
  - JPG는 알파 채널을 지원하지 않으므로, 배경 제거를 켜면 포맷이 JPG일 경우 자동으로 PNG로 전환됩니다.
  - **라이선스 주의**: `@imgly/background-removal`은 AGPLv3입니다. 이 앱을 네트워크 서비스로 배포할 경우 AGPL 조항에 따라 전체 소스코드를 공개해야 하는 의무가 발생합니다(이 저장소는 이미 공개 상태). 비공개로 배포하려면 [IMG.LY 상업 라이선스](mailto:support@img.ly)가 필요합니다.
- **OCR** (`features/ai/ocr/`): Tesseract.js를 자체 워커 API로 구동해 텍스트를 추출하는 자리로, 아직 미구현 상태입니다 (`isReady: false`).

## 7. 성능 최적화 전략

- **메인 스레드 비블로킹**: 크롭/회전/플립/리사이즈/인코딩을 모두 `OffscreenCanvas` + Web Worker에서 수행. 워커 풀(최대 4개, `navigator.hardwareConcurrency` 기준)로 여러 이미지를 병렬 처리.
- **제로카피 전송**: `ImageBitmap`을 `postMessage`의 transfer list로 넘겨 메인 스레드 ↔ 워커 간 픽셀 데이터 복사를 피함.
- **디바운스된 자동 처리**: 슬라이더 드래그 등 연속 입력은 `useAutoProcess`가 250ms 디바운스로 묶어 불필요한 재인코딩을 방지.
- **메모리 누수 방지**: 이미지 제거/재처리/앱 종료 시 `URL.revokeObjectURL`을 원본과 결과물 양쪽에 대해 호출(`useImageStore.removeImage/clearAll/processImage`).
- **히스토리 크기 제한**: undo 스택은 이미지당 최대 50단계로 제한(`MAX_HISTORY_LENGTH`)해 장시간 편집 시 메모리 증가를 억제.
- **선택적 리렌더링**: Zustand 셀렉터(`useImageStore((s) => ...)`)로 컴포넌트가 필요한 슬라이스만 구독하도록 해 이미지 개수가 늘어나도 불필요한 리렌더를 최소화.

## 8. 로컬 실행 방법

```bash
npm install
npm run dev       # http://localhost:5173

npm run build      # 타입체크 + 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
npm run lint        # ESLint
npm run format      # Prettier
```

Node.js 20 이상, 최신 Chromium 계열 브라우저(OffscreenCanvas, Web Worker `type: module` 지원 필요)에서 동작을 확인했습니다.
