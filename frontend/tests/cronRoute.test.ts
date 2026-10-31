import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const run = vi.fn(async () => ({ businesses: 1, digests: 1, reminders: 2 }));
vi.mock("../lib/reminderJob", () => ({ runReminderDigests: (...a: unknown[]) => (run as never as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => ({}) }));

import { GET } from "../app/api/cron/reminders/route";

const req = (auth?: string) =>
  new NextRequest("https://bahi.test/api/cron/reminders", {
    headers: auth ? { authorization: auth } : {},
  });

const saved = process.env.CRON_SECRET;
beforeEach(() => run.mockClear());
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("GET /api/cron/reminders", () => {
  it("refuses everything when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer anything"))).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects missing or wrong credentials", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req("s3cret-value"))).status).toBe(401);
    expect((await GET(req("Bearer s3cret-valuX"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the job with the right credentials", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await GET(req("Bearer s3cret-value"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ businesses: 1, digests: 1, reminders: 2 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns a generic error (no details) if the job throws", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    run.mockRejectedValueOnce(new Error("db password is hunter2"));
    const res = await GET(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });
});
