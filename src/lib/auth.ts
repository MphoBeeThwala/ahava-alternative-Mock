// Simple ID generation (oslo not available, using crypto API)
export function generateUserId(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  const array = new Uint8Array(15);
  crypto.getRandomValues(array);
  for (let i = 0; i < 15; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

export function generateSessionId(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  const array = new Uint8Array(20);
  crypto.getRandomValues(array);
  for (let i = 0; i < 20; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

