import { trustedProxyClientIp } from "./trustedProxy";

const SECRET = "a-long-shared-secret-value";

function run(headers: Record<string, string>, secret: string | null = SECRET) {
  if (secret === null) delete process.env.PROXY_SHARED_SECRET;
  else process.env.PROXY_SHARED_SECRET = secret;
  const req: any = { headers, ip: "10.0.0.1" };
  const next = jest.fn();
  trustedProxyClientIp(req, {} as any, next);
  expect(next).toHaveBeenCalled();
  return req.ip as string;
}

describe("trustedProxyClientIp", () => {
  afterEach(() => { delete process.env.PROXY_SHARED_SECRET; });

  it("uses the forwarded client IP when the secret matches", () => {
    expect(run({ "x-ahava-proxy-secret": SECRET, "x-ahava-client-ip": "41.1.2.3" })).toBe("41.1.2.3");
  });
  it("ignores the header with a wrong secret", () => {
    expect(run({ "x-ahava-proxy-secret": "wrong", "x-ahava-client-ip": "41.1.2.3" })).toBe("10.0.0.1");
  });
  it("ignores the header with no secret", () => {
    expect(run({ "x-ahava-client-ip": "41.1.2.3" })).toBe("10.0.0.1");
  });
  it("does nothing when no secret is configured", () => {
    expect(run({ "x-ahava-proxy-secret": SECRET, "x-ahava-client-ip": "41.1.2.3" }, null)).toBe("10.0.0.1");
  });
  it("rejects a value that is not an IP address", () => {
    expect(run({ "x-ahava-proxy-secret": SECRET, "x-ahava-client-ip": "not-an-ip" })).toBe("10.0.0.1");
  });
});
