/**
 * Whether inbound vendor webhooks (Terra, ROOK) must carry a valid signature.
 *
 * Fail closed. Signatures are required everywhere EXCEPT an environment that
 * is explicitly `development` or `test`, and only there may a
 * `*_SIGNATURE_REQUIRED=false` flag switch them off. Previously the default
 * was "required only if NODE_ENV === 'production'", so a staging host, or a
 * production host with NODE_ENV unset/misspelt, accepted unsigned requests
 * that write biometric readings and device links for any user id.
 */
const parse = (v: string | undefined): boolean | undefined => {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return undefined;
};

export function webhookSignaturesRequired(routeFlag: string | undefined): boolean {
  const env = process.env.NODE_ENV;
  const mayRelax = env === 'development' || env === 'test';
  if (!mayRelax) return true;
  return parse(routeFlag) ?? parse(process.env.WEBHOOK_SIGNATURE_REQUIRED) ?? env !== 'development';
}
