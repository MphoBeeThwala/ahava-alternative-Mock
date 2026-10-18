/**
 * Rook, Terra and Google Maps with their credentials configured but the vendor
 * itself replaced by a stub. These integrations cannot be paid for yet; this
 * suite proves our side is complete - request shape, success handling, error
 * mapping, caps and fallbacks - so connecting real credentials later is a
 * configuration change, not a code change.
 *
 * Rook and Terra read their credentials when their module loads, so the
 * environment is set before the app is imported (dynamically, below).
 */
import request from "supertest";
import axios from "axios";

process.env.ROOK_CLIENT_UUID = "rook-test-client";
process.env.ROOK_SECRET_KEY = "rook-test-secret";
process.env.ROOK_BASE_URL = "https://api.rook-connect.review/api/v1";
process.env.TERRA_DEV_ID = "terra-test-dev";
process.env.TERRA_API_KEY = "terra-test-key";
process.env.TERRA_USER_LIMIT = "2";
process.env.FRONTEND_URL = "https://app.example.test";
process.env.HTTP_RETRY_MAX_RETRIES = "0";

const STRONG_PASSWORD = "Str0ng!Passw0rd";
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

let app: typeof import("../index").app;
let prisma: typeof import("../lib/prisma").default;

beforeAll(async () => {
  ({ app } = await import("../index"));
  prisma = (await import("../lib/prisma")).default;
});

async function patient(label: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/register").send({ email: uniqueEmail(label), password: STRONG_PASSWORD, firstName: label, lastName: "Patient", role: "PATIENT" });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.user.id as string };
}

afterEach(() => jest.restoreAllMocks());

function axiosError(status: number, data: unknown = {}) {
  const err: any = new Error(`status ${status}`);
  err.isAxiosError = true;
  err.response = { status, data };
  return err;
}

describe("Rook connect (credentials configured, Rook stubbed)", () => {
  it("returns the authorization URL and calls Rook's authorizer with basic auth", async () => {
    const get = jest.spyOn(axios, "get").mockResolvedValue({ data: { authorization_url: "https://rook.test/auth/abc", authorized: false } });
    const p = await patient("rook-ok");
    const res = await p.agent.post("/api/v1/rook/connect").send({ dataSource: "Garmin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, url: "https://rook.test/auth/abc", dataSource: "Garmin", authorized: false });
    const [url, config] = get.mock.calls[0] as [string, any];
    expect(url).toBe(`https://api.rook-connect.review/api/v1/user_id/${p.userId}/data_source/Garmin/authorizer`);
    expect(config.headers.Authorization).toBe(`Basic ${Buffer.from("rook-test-client:rook-test-secret").toString("base64")}`);
    expect(config.params.redirect_url).toBe("https://app.example.test/patient/wearable-connected");
  });

  it("defaults the data source, and records an already-authorised user as connected", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: { authorized: true } });
    const p = await patient("rook-already");
    const res = await p.agent.post("/api/v1/rook/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authorized: true, alreadyConnected: true, url: null, dataSource: "Fitbit" });
    const status = await p.agent.get("/api/v1/rook/status");
    expect(status.body.connected).toBe(true);
  });

  it("maps a response with no URL to 502 ROOK_AUTHORIZE_URL_MISSING", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({ data: {} });
    const p = await patient("rook-nourl");
    const res = await p.agent.post("/api/v1/rook/connect").send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ROOK_AUTHORIZE_URL_MISSING");
  });

  it("maps rejected credentials to 502 ROOK_INVALID_CREDENTIALS with a hint", async () => {
    jest.spyOn(axios, "get").mockRejectedValue(axiosError(401, { error: "Unauthorized" }));
    jest.spyOn(axios, "isAxiosError").mockReturnValue(true);
    const p = await patient("rook-401");
    const res = await p.agent.post("/api/v1/rook/connect").send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ROOK_INVALID_CREDENTIALS");
    expect(res.body.hint).toMatch(/ROOK_CLIENT_UUID/);
  });

  it("maps any other upstream failure to 502 ROOK_AUTHORIZE_FAILED", async () => {
    jest.spyOn(axios, "get").mockRejectedValue(axiosError(500));
    jest.spyOn(axios, "isAxiosError").mockReturnValue(true);
    const p = await patient("rook-500");
    const res = await p.agent.post("/api/v1/rook/connect").send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("ROOK_AUTHORIZE_FAILED");
  });
});

describe("Terra connect and disconnect (credentials configured, Terra stubbed)", () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("creates a widget session for the caller with redirect URLs", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(ok({ url: "https://widget.terra.test/s/1", session_id: "sess-1" }));
    const p = await patient("terra-ok");
    const res = await p.agent.post("/api/v1/terra/connect").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, url: "https://widget.terra.test/s/1", sessionId: "sess-1" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tryterra.co/v2/auth/generateWidgetSession");
    expect((init.headers as Record<string, string>)["dev-id"]).toBe("terra-test-dev");
    const sent = JSON.parse(init.body as string);
    expect(sent.reference_id).toBe(p.userId);
    expect(sent.auth_success_redirect_url).toBe("https://app.example.test/patient/wearable-connected");
  });

  it("maps a Terra failure to 502 without leaking the upstream body", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response("secret upstream detail", { status: 500 }));
    const p = await patient("terra-500");
    const res = await p.agent.post("/api/v1/terra/connect").send({});
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret upstream detail");
  });

  it("stops new connections at the beta limit but still lets a connected user reconnect", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(ok({ url: "https://widget.terra.test/s/2", session_id: "sess-2" }));
    await prisma.user.updateMany({ data: { terraUserId: null } });
    const a = await patient("terra-limit-a");
    const b = await patient("terra-limit-b");
    const c = await patient("terra-limit-c");
    await prisma.user.update({ where: { id: a.userId }, data: { terraUserId: "t-a" } as any });
    await prisma.user.update({ where: { id: b.userId }, data: { terraUserId: "t-b" } as any });

    const blocked = await c.agent.post("/api/v1/terra/connect").send({});
    expect(blocked.status).toBe(429);
    const reconnect = await a.agent.post("/api/v1/terra/connect").send({});
    expect(reconnect.status).toBe(200);
    await prisma.user.updateMany({ where: { id: { in: [a.userId, b.userId] } }, data: { terraUserId: null } as any });
  });

  it("disconnect deauthorises at Terra and clears the stored link", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(ok({ status: "success" }));
    const p = await patient("terra-disc");
    await prisma.user.update({ where: { id: p.userId }, data: { terraUserId: "terra-user-9", connectedDevices: ["FITBIT"] } as any });
    const status = await p.agent.get("/api/v1/terra/status");
    expect(status.body).toMatchObject({ connected: true, terraUserId: "terra-user-9", devices: ["FITBIT"] });

    const res = await p.agent.post("/api/v1/terra/disconnect");
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tryterra.co/v2/auth/deauthUser?user_id=terra-user-9");
    expect(init.method).toBe("DELETE");
    expect((await p.agent.get("/api/v1/terra/status")).body.connected).toBe(false);
  });
});

describe("Google Maps address search (key configured, Google stubbed)", () => {
  const TOKEN = "session-token-12345";
  const enable = () => {
    process.env.GOOGLE_MAPS_ENABLED = "true";
    process.env.GOOGLE_MAPS_LEGAL_SIGNED_OFF = "true";
    process.env.GOOGLE_MAPS_SERVER_KEY = "test-maps-key";
  };
  const disable = () => {
    delete process.env.GOOGLE_MAPS_ENABLED;
    delete process.env.GOOGLE_MAPS_LEGAL_SIGNED_OFF;
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    delete process.env.GOOGLE_MAPS_CAP_AUTOCOMPLETE;
  };
  afterEach(async () => {
    disable();
    (await import("../services/googleMaps"))._resetMapsCountersForTests();
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("config reports enabled, and autocomplete returns Google's suggestions", async () => {
    enable();
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
      json({ suggestions: [{ placePrediction: { placeId: "ChIJ1234567890", text: { text: "1 Long Street, Cape Town" } } }, { queryPrediction: {} }] }),
    );
    const p = await patient("maps-ok");
    expect((await p.agent.get("/api/v1/places/config")).body.enabled).toBe(true);
    const res = await p.agent.get(`/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, available: true, suggestions: [{ placeId: "ChIJ1234567890", text: "1 Long Street, Cape Town" }] });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-maps-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ input: "1 Long Street", sessionToken: TOKEN, includedRegionCodes: ["za"] });
  });

  it("place details returns the address and coordinates", async () => {
    enable();
    jest.spyOn(global, "fetch").mockResolvedValue(json({ formattedAddress: "1 Long Street, Cape Town", location: { latitude: -33.92, longitude: 18.42 } }));
    const p = await patient("maps-details");
    const res = await p.agent.get(`/api/v1/places/details?placeId=ChIJ1234567890&sessionToken=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ address: "1 Long Street, Cape Town", lat: -33.92, lng: 18.42 });
  });

  it("degrades to available:false when Google errors, so booking can use the manual address", async () => {
    enable();
    jest.spyOn(global, "fetch").mockResolvedValue(json({ error: "key=test-maps-key" }, 500));
    const p = await patient("maps-down");
    const res = await p.agent.get(`/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, suggestions: [] });
    expect(JSON.stringify(res.body)).not.toContain("test-maps-key");
  });

  it("stops calling Google once the monthly cap is reached", async () => {
    enable();
    process.env.GOOGLE_MAPS_CAP_AUTOCOMPLETE = "1";
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(json({ suggestions: [] }));
    const p = await patient("maps-cap");
    const url = `/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=${TOKEN}`;
    expect((await p.agent.get(url)).body.available).toBe(true);
    expect((await p.agent.get(url)).body.available).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stays off when the legal sign-off flag is missing, even with a key", async () => {
    enable();
    delete process.env.GOOGLE_MAPS_LEGAL_SIGNED_OFF;
    const fetchSpy = jest.spyOn(global, "fetch");
    const p = await patient("maps-legal");
    expect((await p.agent.get("/api/v1/places/config")).body.enabled).toBe(false);
    expect((await p.agent.get(`/api/v1/places/autocomplete?input=1+Long+Street&sessionToken=${TOKEN}`)).body.available).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
