import { NextResponse, type NextRequest } from "next/server";
import { localeFromPathname } from "./i18n";
import { adminRouteRequiresSession, sessionCookieName } from "./lib/session-cookie";

export function middleware(request: NextRequest) {
  if (adminRouteRequiresSession(request.nextUrl.pathname) && !request.cookies.get(sessionCookieName)?.value) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-cashback-locale", localeFromPathname(request.nextUrl.pathname));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
