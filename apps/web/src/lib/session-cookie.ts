export const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "cashback_session";

/** True for admin pages that must not render without a session cookie. Login stays open. */
export function adminRouteRequiresSession(pathname: string): boolean {
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return false;
  return pathname === "/admin" || pathname.startsWith("/admin/");
}
