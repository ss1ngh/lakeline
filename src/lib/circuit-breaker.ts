const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 30000;

let failureCount = 0;
let lastFailureTime = 0;
let isOpen = false;

export function recordLLMFailure(): void {
  failureCount++;
  lastFailureTime = Date.now();
  
  if (failureCount >= FAILURE_THRESHOLD) {
    isOpen = true;
  }
}

export function recordLLMSuccess(): void {
  failureCount = 0;
  isOpen = false;
}

export function shouldSkipLLM(): boolean {
  if (!isOpen) {
    return false;
  }
  
  if (Date.now() - lastFailureTime > RESET_TIMEOUT_MS) {
    isOpen = false;
    failureCount = 0;
    return false;
  }
  
  return true;
}

export function getCircuitBreakerState(): { isOpen: boolean; failureCount: number } {
  return { isOpen, failureCount };
}

export function resetCircuitBreaker(): void {
  failureCount = 0;
  isOpen = false;
  lastFailureTime = 0;
}