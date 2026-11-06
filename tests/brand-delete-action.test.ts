import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createBrand, getBrand } from "@/lib/data";
import { freshDb, makeWorkspace } from "./helpers";

const auth = vi.hoisted(() => ({ current: null as null | { workspace: { id: number }; user: { id: number; name: string; email: string }; role: string } }));
vi.mock("@/lib/auth", () => ({
  requireAuth: async () => auth.current,
  requireEditor: async () => auth.current,
  getAuth: async () => auth.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { deleteBrandForeverAction } = await import("@/app/actions/brands");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("delete business: confirmation rules", () => {
  beforeEach(async () => {
    await freshDb();
  });

  async function setup(role = "owner") {
    const { ws, user } = await makeWorkspace("Owner");
    const db = await getDb();
    await db.update(schema.users).set({ passwordHash: await bcrypt.hash("Right-Pass-1", 4) }).where(eq(schema.users.id, user.id));
    const brand = await createBrand(ws.id, { name: "Sweet Shop", colors: [], platforms: [] });
    auth.current = { workspace: { id: ws.id }, user: { id: user.id, name: user.name, email: user.email }, role };
    return { ws, brand };
  }

  it("needs the owner, the exact name, the password and the tick", async () => {
    const { ws, brand } = await setup("editor");
    const good = { confirmName: "Sweet Shop", password: "Right-Pass-1", understand: "on" };
    expect(await deleteBrandForeverAction(brand.id, undefined, form(good))).toEqual({ error: "Only the workspace owner can delete a business account." });

    auth.current!.role = "owner";
    expect((await deleteBrandForeverAction(brand.id, undefined, form({ ...good, confirmName: "sweet shop" })))?.error).toMatch(/name does not match/);
    expect((await deleteBrandForeverAction(brand.id, undefined, form({ confirmName: "Sweet Shop", password: "Right-Pass-1" })))?.error).toMatch(/Tick the box/);
    expect((await deleteBrandForeverAction(brand.id, undefined, form({ ...good, password: "wrong" })))?.error).toBe("Wrong password.");
    expect(await getBrand(ws.id, brand.id)).not.toBeNull(); // still there after every wrong try

    await expect(deleteBrandForeverAction(brand.id, undefined, form(good))).rejects.toThrow("REDIRECT /brands?deleted=Sweet%20Shop");
    expect(await getBrand(ws.id, brand.id)).toBeNull();
  });

  it("stops after 5 wrong tries", async () => {
    const { ws, brand } = await setup();
    for (let i = 0; i < 5; i++) await deleteBrandForeverAction(brand.id, undefined, form({ confirmName: "Sweet Shop", password: "nope", understand: "on" }));
    const r = await deleteBrandForeverAction(brand.id, undefined, form({ confirmName: "Sweet Shop", password: "Right-Pass-1", understand: "on" }));
    expect(r?.error).toMatch(/Too many wrong tries/);
    expect(await getBrand(ws.id, brand.id)).not.toBeNull();
  });
});
