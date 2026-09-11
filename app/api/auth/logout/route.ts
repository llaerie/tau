import { NextResponse } from "next/server";
import { logoutCookie } from "@/lib/security/auth";

/** Clears the session cookie. Works in both auth modes (lab mode simply falls back to the default actor). */
export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.headers.set("set-cookie", logoutCookie());
  return res;
}
