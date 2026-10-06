/**
 * Bridge between the API client and the step-up prompt.
 *
 * When the backend answers STEP_UP_REQUIRED (a sensitive action needs a fresh
 * authenticator code), the response interceptor calls requestStepUp(), which
 * asks the mounted <StepUpProvider> to show the prompt and resolves true once
 * the code was accepted (so the original request is retried) or false if the
 * person cancelled. Concurrent requests share one prompt.
 */
type Handler = () => Promise<boolean>;

let handler: Handler | null = null;
let pending: Promise<boolean> | null = null;

export function registerStepUpHandler(next: Handler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function requestStepUp(): Promise<boolean> {
  if (!handler) return Promise.resolve(false);
  if (!pending) {
    pending = handler().finally(() => {
      pending = null;
    });
  }
  return pending;
}
