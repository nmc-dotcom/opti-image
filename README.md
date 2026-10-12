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
    ai/                 AI 플러그인 인터페이스 + 배경 제거 / OCR / 인페인팅 구현체
  hooks/                useFileDrop, useAutoProcess, useCropOverlay, useRetouch, useTextEditing ...
  lib/                  순수 함수 (이미지 파이프라인, 마스크, 좌표 변환, 텍스트 렌더링, inpaint/ 알고리즘, 파일명 규칙, 다운로드/zip ...)
  store/                Zustand 스토어 (useImageStore, useUiStore, useThemeStore)
  types/                도메인 타입 (image.ts, worker.ts, editing.ts)
  workers/              image.worker.ts (크롭/회전/인코딩) + retouch.worker.ts (마스크/배경 복원) + 각 Promise 래퍼
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

## 라이선스

이 프로젝트는 [GNU AGPL-3.0](LICENSE)으로 배포됩니다 (`package.json`의 `license`: `AGPL-3.0-only`). 배경 제거에 쓰는 `@imgly/background-removal`이 AGPL-3.0이라, 이를 포함한 이 앱 전체를 AGPL-3.0 조건으로 제공합니다 (6장 참고). 상업적 이용(광고 포함)은 허용되지만 AGPL 조건을 따라야 합니다.

- 네트워크로 이 앱을 제공할 때는 사용자에게 소스 코드를 제공해야 합니다 → 화면 하단 푸터에 소스 링크를 두었습니다 (`src/features/layout/Footer.tsx`).
- 수정한 버전을 서비스하면 그 수정본의 소스도 같은 조건으로 공개해야 합니다.
- 소스를 비공개로 두려면 AGPL 의존성을 제거하거나 IMG.LY 상업 라이선스가 필요합니다.
- 의존 라이브러리·모델의 라이선스는 6장·11장을 참고하세요.

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
- **OCR** (`features/ai/ocr/`), **인페인팅** (`features/ai/inpainting/`): Tesseract.js / MI-GAN(ONNX Runtime Web) 구현체 → [9장](#9-edit-탭--물체-제거--텍스트-수정). 마스크를 받는 플러그인은 기존 `AiPlugin`을 건드리지 않는 `MaskedAiPlugin`(`features/ai/types.ts`)으로 확장했습니다.

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

## 9. Edit 탭 — 물체 제거 / 텍스트 수정

우측 패널의 **Edit** 탭에 두 기능이 추가되었습니다. 모든 처리는 브라우저에서 끝나며 이미지는 어디로도 전송되지 않습니다.

### 9.1 물체 제거 (선택 영역 지우기)

1. **선택** — 브러시(크기·하드/소프트), 사각형, 자유 선택(올가미). `선택 칠하기/복원` 모드, **Alt**를 누른 채 칠하면 임시로 반대 모드. `선택 취소`(= `Ctrl+Z`)·다시 실행·전체 해제 지원. 선택은 반투명 오버레이로 실시간 표시됩니다.
2. **복원 방식**
   - **기본(Level 1) — 추가 다운로드 없는 브라우저 알고리즘 (`src/lib/inpaint/`).**
     - 얇은 영역(글자·긁힌 자국): Telea 확산.
     - 두꺼운 영역(사람·물체·로고): **주파수 분리 복원** (`texturefill.ts`). 저주파(색·그라데이션·경계선)는 같은 행/열의 반대편 경계 사이를 선형 보간하고(구멍이 좁은 방향에 더 큰 가중치, 지평선 같은 수평 경계가 같은 높이로 이어짐), 고주파(잔디·노이즈 같은 질감)는 주변 잔차를 색이 비슷한 위치에서 가져와 입힙니다. 큰 에지에서는 복제하지 않아 구조가 번지지 않습니다.
     - 특허가 확인되지 않은 PatchMatch는 코드째 빌드에서 제외되어 있습니다 ([9.5](#95-빌드-플래그)).
   - **AI 인페인팅(Level 2) — 기본값은 꺼짐.** MI-GAN을 ONNX Runtime Web으로 실행합니다 (WebGPU → WASM 자동 폴백). 모델·학습 데이터의 라이선스가 정리되기 전까지 빌드에서 제외되며, 켜는 방법은 [9.5](#95-빌드-플래그)를 참고하세요.
3. **적용** — 선택 영역 주변에 context padding을 붙여 잘라낸 영역만 처리한 뒤 원본 좌표에 합성합니다 (`lib/inpaintingCrop.ts`).

### 9.2 텍스트 수정

**영역을 지정해서 수정합니다.** `영역 지정해서 글자 수정` → 미리보기에서 수정할 글자 위를 드래그(Esc로 취소) → 그 영역만 OCR → 인식된 줄이 선택된 상태로 편집창이 열림 → 새 텍스트·글꼴·크기·색상·정렬 입력 → `적용`.
적용 순서: OCR bbox를 글자 잉크 영역으로 보정 → 마스크 생성 → 기존 글자 제거·배경 복원 → **편집 가능한 텍스트 레이어** 추가 (한 번의 Undo로 함께 되돌림). 글꼴 크기와 색상은 원본 글자에서 자동 추정합니다. 레이어는 미리보기에서 드래그로 이동하고, 패널에서 내용·스타일·좌표를 다시 수정/삭제할 수 있습니다. 내보내기 때 `renderEditedCanvas`가 **크롭 이전 단계**에서 그리므로 회전/뒤집기/리사이즈를 그대로 따라갑니다.

- **인식하지 못해도 수정할 수 있습니다.** 지정한 영역에서 글자를 못 읽으면 그 영역 자체가 "글자 인식 안 됨" 항목으로 선택되고, 새 텍스트를 직접 입력해 `적용`하면 영역이 지워지고 새 텍스트로 바뀝니다. OCR 오인식은 "새 텍스트" 칸에서 바로 고치면 됩니다.
- `이미지 전체에서 찾기`(접이식)로 이미지 전체를 한 번에 인식해 줄/단어 박스를 모두 띄울 수도 있습니다 (보조 기능).
- OCR은 Tesseract.js의 전용 Web Worker에서 실행됩니다. 큰 이미지는 긴 변 3200px로 줄여 인식한 뒤 박스를 원본 좌표로 되돌립니다.
- **여러 전처리로 읽어 합칩니다** (`features/ai/ocr/preprocess.ts`). Tesseract는 전역 임계값 하나로 이진화해서 색·질감 배경 위의 배너, 버튼, 공지 이미지를 자주 못 읽습니다 (실제로 컬러 배너 원본은 쓰레기값, 흑백으로 바꾸면 신뢰도 93~96%). 그래서 ① 흑백 ② 밝은 글자용 지역 적응형 이진화를 각각 읽고, 겹치는 결과는 `신뢰도 × √글자수`로 하나만 남깁니다. 작은 이미지(긴 변 1000px 미만)는 자동으로 확대하고, 지역 적응형 패스는 질감을 글자 후보로 만들어 느려지므로 1280px 이하로 제한합니다.
- 잡음 제거: 기호만 있는 결과, 높이 10px 미만, 짧고 신뢰도 낮은 결과(마스코트·테두리), 줄 가장자리의 낮은 신뢰도 글자를 걸러냅니다.
- 한·영 혼합 줄에서 한 스크립트로 쏠려 깨지는 구간(`안녕하세요` → `OHASIM|`, `OptiImage` → `00 비 00396`)은 신뢰도가 낮은 구간만 한국어 전용·영어 전용 모델로 다시 읽어 더 확실한 쪽을 택합니다. 한국어 결과는 실제로 한글이어야 인정합니다.
- 알려진 한계: 한글은 글자 사이를 띄워 읽는 경우가 있고(`바로가기` → `바 로 가기`), 글자 하나를 비슷한 글자로 읽을 수 있습니다(`출` → `줄`). 편집창에서 "새 텍스트"를 직접 고치세요.

### 9.3 데이터 구조 — 마스크와 Undo/Redo

- 모든 좌표는 **원본 이미지 픽셀 기준**입니다 (`lib/imageCoordinates.ts`; 기존 크롭의 `getContentRect`를 공용화).
- 선택은 전체 해상도 비트맵이 아니라 **벡터 stroke 목록**(`types/editing.ts`)으로 보관하고, 처리할 영역만 `EditMask`(0=유지, 255=제거, 중간값=feather)로 래스터화합니다. 8000×6000에서도 48MB 마스크 버퍼를 만들지 않습니다.
- 적용된 제거는 **마스크 bbox 크기의 PNG 패치**로 저장되고, `EditSettings.retouch`(id·bbox 메타데이터)와 `textLayers`만 기존 settings history에 들어갑니다. 기존 `commitHistory/undo/redo`를 그대로 쓰면서 히스토리에 이미지 복사본이 쌓이지 않습니다. 새 편집으로 redo 분기가 버려지면 참조되지 않는 패치는 해제됩니다.
- 합성 순서: 원본 → 제거 패치 → (배경 제거) → 텍스트 레이어 → 크롭 → 회전 → 뒤집기 → 리사이즈 → 인코딩.
- 키보드: Edit 탭에서 `Ctrl+Z`는 적용 전 선택 stroke를 먼저 되돌리고, 텍스트 입력 중에는 입력창 고유의 undo를 존중합니다.

### 9.4 대용량 이미지

AI/복원 모델에는 전체 이미지를 넣지 않습니다. 선택 영역 + context padding만 잘라 처리하고 (작업 해상도 상한: 얇은 영역 2048px / 두꺼운 영역 4096px / 영역 1600만 화소, AI는 옵트인 시 2048px), 결과는 **마스크 안쪽 픽셀만** 원본 위치에 합성하므로 마스크 밖 픽셀과 최종 출력 해상도는 원본 그대로입니다. 편집 UI·AI 모델·OCR은 모두 동적 import라 Edit 탭을 열지 않는 사용자는 아무것도 내려받지 않습니다 (초기 번들 `index-*.js` 484kB, 변경 전 480kB).

### 9.5 빌드 플래그

`.env.example`을 `.env.local`로 복사해 조정합니다 (`src/lib/features.ts`).

| 변수 | 기본값 | 의미 |
|---|---|---|
| `VITE_ENABLE_AI_INPAINTING` | `false` | `true`일 때만 AI 인페인팅 UI, 워커, 모델 URL이 번들에 포함됩니다. `false`이면 모델을 내려받는 코드 자체가 빌드 결과물에 없습니다(확인함: `dist`에 `huggingface`/MI-GAN 문자열 없음). |
| `VITE_ENABLE_PATCHMATCH` | `false` | `true`일 때만 PatchMatch(텍스처 복제)를 두꺼운 영역에 쓰고 코드가 번들에 포함됩니다(별도 청크). 기본(`false`)에서는 주파수 분리 복원을 쓰고 PatchMatch 코드는 빌드에 없습니다. 특허 검토가 끝난 환경에서만 켜세요. |

## 10. 개인정보 / 네트워크

**이미지, 이미지 픽셀, 마스크는 어떤 요청에도 실리지 않습니다.** 새로 추가된 네트워크 요청은 모두 본문 없는 `GET`(정적 에셋 다운로드)입니다.

| 기능 | 요청 (GET) | 용도 | 시점 |
|---|---|---|---|
| AI 인페인팅 (`VITE_ENABLE_AI_INPAINTING=true` 빌드에서만) | `huggingface.co/andraniksargsyan/migan/resolve/<commit>/migan_pipeline_v2.onnx` (→ HF CDN 리다이렉트) | 모델 28MB, SHA-256 검증 후 Cache Storage 저장 | AI 방식 첫 실행 |
| AI 인페인팅 런타임 (위와 동일 조건) | 같은 출처 (Vite 빌드 산출 `ort-wasm-*.wasm`) | ONNX Runtime WASM | AI 방식 첫 실행 |
| OCR | `cdn.jsdelivr.net` (tesseract.js worker·core, `kor`/`eng` traineddata 합계 약 4.5MB) | OCR 엔진/언어 데이터 | OCR 첫 실행 (언어 데이터는 IndexedDB 캐시) |
| 배경 제거 (기존) | `staticimgly.com` | 모델 | 기존과 동일 |

검증 방법: (1) `src` 전체에서 `fetch/XMLHttpRequest/sendBeacon/WebSocket/POST`를 검색하면 모델 다운로드용 `fetch` 한 곳만 나옵니다. (2) 실제 Chrome에서 제거(기본+AI)·OCR·텍스트 교체·내보내기까지 전 과정의 요청을 기록해, 본문이 있거나 GET이 아닌 요청이 0건임을 확인했습니다 (외부 요청 8건: Hugging Face 2, jsDelivr 6).
오프라인/차단 환경에서 모델·OCR 에셋을 못 받으면 실패 토스트로 안내하고, 기본 복원 방식은 계속 동작합니다.

## 11. 라이선스 (새로 추가된 항목)

기존 `@imgly/background-removal`(AGPLv3) 관련 내용은 6장 그대로 유지됩니다.

| 항목 | 버전 | 라이선스 | 용도/런타임 | 출처 | 상업적 사용 | 재배포 시 요구사항 |
|---|---|---|---|---|---|---|
| onnxruntime-web | 1.21.0 (imgly peer dependency와 동일 버전 고정) | MIT | ONNX 추론, WebGPU/WASM | npm / microsoft/onnxruntime | 가능 | 저작권·라이선스 고지 |
| tesseract.js | ^7.0.0 | Apache-2.0 | OCR (WASM, 전용 Worker) | npm / naptha/tesseract.js | 가능 | 라이선스 고지, 변경 시 표기 |
| tesseract.js-core, @tesseract.js-data (`kor`, `eng`, `4.0.0_best_int`) | 7.0.0, 4.0.0 | Apache-2.0 | OCR 코어·언어 데이터 | jsDelivr (npm) | 가능 | 라이선스 고지 |
| **MI-GAN** `migan_pipeline_v2.onnx` | HF commit `406830d` | MIT (© 2024 Picsart AI Research) | 인페인팅 모델 (ORT WebGPU → WASM) | [HF andraniksargsyan/migan](https://huggingface.co/andraniksargsyan/migan) | MIT상 가능 | 저작권·라이선스 고지 |

> **유의 (AI 인페인팅은 기본 비활성)**: MI-GAN 가중치는 Places2 / FFHQ 데이터셋으로 학습되었습니다. Places2 공식 페이지는 DB와 학습된 모델을 "academic research and education" 용도로 제공한다고 밝히고 이미지 저작권은 원 소유자에게 있다고 하지만, 명시적인 비상업 조항은 확인하지 못했습니다. 즉 **상업 이용 가능 여부가 불명확**합니다. 또한 사용 중인 ONNX는 Picsart 공식 배포본이 아니라 제3자 변환본이며, 저장소의 `LICENSE-WEIGHTS` 전문은 직접 검토하지 못했습니다. 저작자 확인이나 법무 검토 전에는 켜지 마세요.
>
> **PatchMatch (옵트인, 기본 제외)**: 구현은 논문을 보고 직접 작성했으며 Princeton/Adobe의 참조 코드(비상업 연구용 라이선스)는 사용하지 않습니다. 다만 Adobe는 PatchMatch를 확장하는 특허를 보유하고 있고(예: US 8,861,868), 2009년 원본 알고리즘이 특허 청구항에 해당하는지는 확인하지 못했습니다. 그래서 상업 배포 기준 기본 빌드에서는 PatchMatch 코드를 제외했습니다.
>
> **기본 복원 알고리즘의 근거**: Telea 확산(2004 논문), pull-push 보간(Gortler et al. 1996), 행/열 선형 보간, 박스 블러, 클론 스탬프식 샘플링만 조합합니다. 모두 일반적인 영상 처리 기법이지만, **특허가 전혀 없다는 것을 확인한 것은 아닙니다.** 광고 등 상업 서비스로 운영한다면 배포 전에 특허 검색 또는 변리사 검토를 받으세요.
>
> 다른 AI 모델로 교체하려면 `features/ai/inpainting/model.ts`의 `MIGAN_MODEL`(url / sha256)을 바꾸면 됩니다 (입출력 규약이 다르면 `runtime.ts`의 `createRunner`도 수정).

## 12. 브라우저 호환성

| 기능 | Chrome / Edge (최신) | Firefox (최신) |
|---|---|---|
| 기존 기능 (Resize/Format/Crop/Rotate/배경 제거) | ✅ | ✅ |
| 물체 제거 — 기본 방식, 마스크 편집, 텍스트 수정 | ✅ 테스트함 | OffscreenCanvas + module Worker 지원 (실기기 미검증) |
| OCR (Tesseract.js) | ✅ 테스트함 | 실기기 미검증 |
| AI 인페인팅 — WebGPU (옵트인 빌드) | ✅ GPU 어댑터가 있을 때 | 기본 비활성 → 자동으로 WASM |
| AI 인페인팅 — WASM(CPU) (옵트인 빌드) | ✅ 테스트함 | 실기기 미검증 |

- WebGPU는 `navigator.gpu` 존재 + `requestAdapter()` 성공 + 64×64 시험 추론 성공까지 확인한 뒤에만 사용하고, 하나라도 실패하면 WASM으로 폴백합니다. WASM조차 불가능하면 AI 방식 버튼이 비활성화됩니다. (GPU를 끈 Chrome에서 폴백 동작 확인)
- OffscreenCanvas와 `type: 'module'` Worker가 필요합니다 (기존 요구사항과 동일). 이번 작업의 테스트는 Chrome에서만 수행했으며 Firefox는 위 표의 "미검증" 항목을 직접 확인해야 합니다.
- 교차 출처 격리(COOP/COEP)를 켜지 않으므로 WASM은 단일 스레드로 동작합니다. 호스팅에서 해당 헤더를 설정하면 코드가 자동으로 스레드 수를 늘립니다.

## 13. 성능 측정

기본 빌드(AI 꺼짐, PatchMatch 제외) 기준입니다. 측정 환경: Windows 11, Chrome(Playwright, headless), 합성 JPEG (텍스처 잔디 + 하늘 + 사람 + 로고 + 한/영/숫자 글자). 시간은 ms, 단일 실행값(분산 있음).

- **복원(첫 실행)**: 두꺼운 영역(사람 모양, 높이 약 380px 브러시) 제거. 워커 첫 기동 포함. **복원(이후)**: 같은 워커에서 사각형 로고 제거.
- **마스크 프레임 p95**: 브러시 드래그 중 프레임 간격 (16.7ms = 60fps).

| 해상도 | 마스크 프레임 p95 | 복원 (첫 실행) | 복원 (이후) | OCR | 브라우저 전체 메모리 피크 |
|---|---|---|---|---|---|
| 1920×1080 | 17 | 321 | 122 | 1,706 | 1.2GB |
| 4000×3000 | 17 | 1,665 | 389 | 6,306 | 2.4GB |
| 6000×4000 | 17 | 3,086 | 847 | 6,711 | 3.1GB |
| 8000×6000 | 17 | 4,477 | 1,523 | 8,900 | 4.2GB |

- 처리 시간은 선택 영역 크기에 비례하며 이미지 해상도에는 거의 비례하지 않습니다. 8000×6000 JPEG에서도 결과는 8000×6000 그대로입니다 (고해상도에서 느린 쪽은 큰 영역을 4096px 이하로 처리하기 때문).
- 메모리 피크는 브라우저 전 프로세스의 working set 합이며, 대부분은 기존 파이프라인의 대형 이미지 디코딩입니다 (이번 작업 이전에도 8000×6000 업로드만으로 약 1.5GB 수준). 페이지 JS 힙 피크는 모든 크기에서 약 30MB 이하였습니다.
- **OCR 열은 `이미지 전체에서 찾기`(이미지 전체, 다중 전처리) 기준**입니다. 영역을 지정하면 그 영역만 읽으므로 보통 1~2초입니다 (300×253 배너 전체 1.7초). 위 수치는 이번 변경 전(단일 패스) 대비 큰 이미지에서 2~3배 느리지만, 그만큼 배너/버튼류를 읽습니다.
- AI 인페인팅을 켠 빌드의 수치(WebGPU 사용 시 GPU 프로세스 메모리 약 +1.8GB, 이 환경에서는 WebGPU가 WASM보다 빠르지 않음)는 별도 측정에서 확인했습니다.
- 합성 이미지 1종, 단일 기기 기준이므로 절대값이 아닌 상대 비교용입니다.

## 14. 테스트 결과 요약

실제 Chrome(Playwright)에서 확인한 항목입니다.

- **회귀(기존 기능)**: 업로드, 드래그 앤 드롭, Resize(긴 변), Format, Rotate, Flip, Crop(프리셋 · 드래그 좌표 매핑), Undo/Redo 단축키, 이미지 간 상태 독립, 웹 최적화, Rename 패널, 압축률 표시, 다크 모드, ZIP 일괄 내보내기, 배경 제거 (제거 패치·텍스트 레이어와의 조합 포함) — 모두 통과.
- **물체 제거(기본 빌드)**: 단색 배경 위 글자, 하늘 위 로고, 지평선에 걸친 큰 사람 모형 — 주파수 분리 복원으로 지평선이 이어지고 잔디 질감이 복원됨. 8000×6000에서도 동작. **한계**: 경계가 비스듬하거나 복잡한 구조(건물, 사람 얼굴 등)를 가로지르는 큰 영역은 구조를 새로 만들어내지 못해 흐릿하게 채워집니다. 단순한 배경·질감에 적합합니다.
- **OCR/텍스트 수정**: 영어·숫자·한글 혼합 줄, 작은 글자, 큰 글자 인식. 텍스트 변경(`2026. 10. 3.` → `2026. 10. 4.`)·이동·크기·색·글꼴·정렬 변경, Undo/Redo (교체 한 번 = 한 단계) 확인.
- **개인정보**: 10장 참고.
- **한계**: OCR은 합성 이미지 위주로 검증했습니다. 실제 사진 속 장식 글꼴·기울어진 글자·저대비 글자는 인식률이 낮을 수 있으므로 인식 결과를 확인한 뒤 적용하세요. 복잡한 자연 사진에서의 인페인팅 품질은 합성 장면보다 낮을 수 있습니다.

## 15. 상업 배포 체크리스트

- [x] AI 인페인팅: 기본 비활성, 빌드에 코드·모델 URL 없음 (Places2 학습 데이터 조건 불명확).
- [x] PatchMatch: 기본 비활성, 빌드에 코드 없음 (Adobe 특허 미확인).
- [x] 이미지/마스크는 어떤 네트워크 요청에도 포함되지 않음 (10장).
- [ ] 기본 복원 알고리즘(Telea, pull-push, 주파수 분리)의 특허 검색 또는 변리사 검토.
- [ ] `@imgly/background-removal`(AGPLv3): 소스 공개 의무 이행 또는 상업 라이선스 (6장).
- [ ] 위 AI/PatchMatch를 켜려면 라이선스·특허를 확인한 뒤 9.5의 플래그를 사용.
