import { rejectCiphertextInput } from "./rejectCiphertextInput";

function run(path: string, body: unknown) {
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  rejectCiphertextInput({ path, body } as any, res, next);
  return { res, next };
}

describe("rejectCiphertextInput", () => {
  it("rejects a v3 payload nested anywhere in the body", () => {
    const { res, next } = run("/api/v1/profile", { a: { b: ["x", "v3:k1:aXY=:dGFn:Y2lwaGVy"] } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
  it("lets ordinary text through, including times and colons", () => {
    const { next } = run("/api/v1/messages", { content: "Take at 10:30:45 or v3: see notes" });
    expect(next).toHaveBeenCalled();
  });
  it("skips webhook paths", () => {
    const { next } = run("/webhooks/rook", { x: "v3:k1:aXY=:dGFn:Y2lwaGVy" });
    expect(next).toHaveBeenCalled();
  });
});
