type HeaderMap = Record<string, string>;

const ML_SERVICE_KEY_HEADER = 'x-ahava-service-key';

export function mlServiceHeaders(): HeaderMap {
  const secret = (process.env.ML_SERVICE_SHARED_SECRET || '').trim();
  if (!secret) return {};
  return { [ML_SERVICE_KEY_HEADER]: secret };
}

