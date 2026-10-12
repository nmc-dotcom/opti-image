// onnxruntime-web 1.21 declares its types in an ambient types.d.ts, but its package.json
// "exports" map has no "types" condition, so TypeScript cannot find them. Mirror the upstream
// declarations for the entry points we import (the API types live in onnxruntime-common).
declare module 'onnxruntime-web' {
  export * from 'onnxruntime-common'
}

declare module 'onnxruntime-web/webgpu' {
  export * from 'onnxruntime-common'
}
