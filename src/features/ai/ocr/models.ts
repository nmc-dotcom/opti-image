import type { ModelAsset } from '@/lib/modelCache'

/**
 * PP-OCRv5 mobile models (PaddlePaddle / Baidu), ONNX exports published by the PaddlePaddle
 * organisation on Hugging Face. Every file is pinned to a repository COMMIT (not a branch) and to
 * a SHA-256, so an upstream change or a tampered mirror is rejected instead of being executed.
 *
 * License: Apache-2.0 (code and weights). Training data is not published by the authors.
 *
 * - detection  PP-OCRv5_mobile_det             finds text lines           (4.8 MB)
 * - recognition korean_PP-OCRv5_mobile_rec     reads Korean + English +   (13.4 MB)
 *                                              digits + punctuation in one model
 * - dictionary the recognizer's character list, stored in its inference.yml
 *
 * The files' I/O contract (verified against the files, see README): detection takes
 * [1,3,H,W] float32 (H, W multiples of 32) and returns a [1,1,H,W] probability map; recognition
 * takes [1,3,48,W] float32 and returns [1,W/8,11947] softmax probabilities, where class 0 is the
 * CTC blank, classes 1..11945 are the dictionary and class 11946 is the space character.
 */

const DET_REPO = 'PaddlePaddle/PP-OCRv5_mobile_det_onnx'
const DET_COMMIT = 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d'
const REC_REPO = 'PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx'
const REC_COMMIT = '5c6f574b8e2230adf4287b33e736d71b9fabd28e'

const resolve = (repo: string, commit: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/${commit}/${file}`

export const OCR_MODELS = {
  det: {
    url: resolve(DET_REPO, DET_COMMIT, 'inference.onnx'),
    sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
    bytes: 4_826_518,
  },
  rec: {
    url: resolve(REC_REPO, REC_COMMIT, 'inference.onnx'),
    sha256: '92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08',
    bytes: 13_418_787,
  },
  dict: {
    url: resolve(REC_REPO, REC_COMMIT, 'inference.yml'),
    sha256: 'f757fa1c40e99edcf27e9cce879b93eb2a51fa46f5ef39095689b8c37dd75998',
    bytes: 96_039,
  },
} satisfies Record<string, ModelAsset>

export const OCR_MODEL_INFO = {
  name: 'PP-OCRv5 mobile (det + Korean rec)',
  license: 'Apache-2.0',
  source: `https://huggingface.co/${REC_REPO}`,
  totalBytes: OCR_MODELS.det.bytes + OCR_MODELS.rec.bytes + OCR_MODELS.dict.bytes,
} as const
