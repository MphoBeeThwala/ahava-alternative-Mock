/**
 * Regression cover for the defect that made access, refresh and WebSocket
 * credentials interchangeable. Each of these assertions fails against the
 * pre-fix implementation.
 */
import jwt from "jsonwebtoken";
import {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TokenTypeError,
  signToken,
  verifyToken,
} from "./tokens";

const SECRET = "test-secret-at-least-thirty-two-characters-long";

describe("tokens", () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
    process.env.NODE_ENV = originalEnv;
  });

  const sign = (typ: "access" | "refresh" | "websocket") =>
    signToken({ userId: "user_1", role: "PATIENT", typ }, { expiresInSeconds: 60 });

  it("round-trips a token of the expected type", () => {
    const payload = verifyToken(sign("access"), "access");
    expect(payload).toEqual({ userId: "user_1", role: "PATIENT", typ: "access" });
  });

  it("rejects a refresh token presented as an access token", () => {
    expect(() => verifyToken(sign("refresh"), "access")).toThrow(TokenTypeError);
  });

  it("rejects an access token presented as a refresh token", () => {
    expect(() => verifyToken(sign("access"), "refresh")).toThrow(TokenTypeError);
  });

  it("rejects a websocket ticket presented as an access token", () => {
    expect(() => verifyToken(sign("websocket"), "access")).toThrow(TokenTypeError);
  });

  it("rejects a legacy untyped token signed with the same secret", () => {
    const legacy = jwt.sign({ userId: "user_1", role: "PATIENT" }, SECRET, {
      expiresIn: 60,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    expect(() => verifyToken(legacy, "access")).toThrow(TokenTypeError);
  });

  it("rejects a token signed with a different secret", () => {
    const foreign = jwt.sign({ userId: "user_1", role: "ADMIN", typ: "access" }, "another-secret", {
      expiresIn: 60,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    expect(() => verifyToken(foreign, "access")).toThrow(jwt.JsonWebTokenError);
  });

  it("rejects a token minted for a different audience", () => {
    const foreign = jwt.sign({ userId: "user_1", role: "ADMIN", typ: "access" }, SECRET, {
      expiresIn: 60,
      issuer: TOKEN_ISSUER,
      audience: "somewhere-else",
    });
    expect(() => verifyToken(foreign, "access")).toThrow(jwt.JsonWebTokenError);
  });

  it("rejects an unsigned (alg=none) token", () => {
    const unsigned = jwt.sign(
      { userId: "user_1", role: "ADMIN", typ: "access" },
      "",
      { algorithm: "none", issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
    );
    expect(() => verifyToken(unsigned, "access")).toThrow(jwt.JsonWebTokenError);
  });

  it("reports expiry distinctly, so callers can trigger a refresh", () => {
    const expired = signToken(
      { userId: "user_1", role: "PATIENT", typ: "access" },
      { expiresInSeconds: -10 },
    );
    expect(() => verifyToken(expired, "access")).toThrow(jwt.TokenExpiredError);
  });

  it("refuses to sign with a short secret in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "too-short";
    expect(() => sign("access")).toThrow(/at least 32 characters/);
    process.env.NODE_ENV = originalEnv;
  });
});
