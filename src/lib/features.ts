/**
 * Build-time feature flags (Vite env, see `.env.example`). They are read inline as
 * `import.meta.env.VITE_*` literals. For AI inpainting the two code paths that load it
 * (hooks/useRetouch.ts and InpaintMethodPicker.tsx) repeat the check inline, because bundlers only
 * fold env literals within the reading module — that is what removes the inpainting module, its
 * worker and the model URL from a disabled build instead of merely hiding the button.
 *
 * - VITE_ENABLE_AI_INPAINTING  default OFF: MI-GAN model download + ONNX inference. Off until the
 *   licensing of the model and its training data (Places2) has been cleared for the deployment.
 * - VITE_ENABLE_PATCHMATCH     (read inline in workers/retouch.worker.ts) default OFF: PatchMatch exemplar fill for thick selections (its
 *   patent/licence status has not been cleared for commercial use). When off, thick selections use
 *   the frequency-separation texture fill and the PatchMatch code is not part of the bundle.
 */
export const AI_INPAINTING_ENABLED = import.meta.env.VITE_ENABLE_AI_INPAINTING === 'true'
