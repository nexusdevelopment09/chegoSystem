import { connect } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import { databaseUrl, isLocalEnv } from "@/lib/env";

const DB_OFFLINE_PATH = "/banco-desligado";

// Local only: the app never pretends to work without the database. If nothing
// answers on the database port, every page shows how to turn it on.
function isDatabaseUp(): Promise<boolean> {
  const { hostname, port } = new URL(databaseUrl());

  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) || 5432 });
    const finish = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function proxy(request: NextRequest) {
  if (
    isLocalEnv &&
    request.method === "GET" &&
    request.nextUrl.pathname !== DB_OFFLINE_PATH &&
    !(await isDatabaseUp())
  ) {
    return NextResponse.rewrite(new URL(DB_OFFLINE_PATH, request.url), {
      status: 503,
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icons/|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
