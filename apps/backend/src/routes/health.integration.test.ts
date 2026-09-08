/**
 * AH-07: the first integration test — hits the real app object (no
 * listener started; see index.ts's NODE_ENV==="test" guard) with supertest,
 * against a real, disposable PostgreSQL instance (see testSetup/).
 */
import request from "supertest";
import { app } from "../index";

describe("health endpoints", () => {
  it("GET /health reports ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("GET /ready reports ready once the app is up", async () => {
    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
  });
});
