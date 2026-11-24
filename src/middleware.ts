import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

const LOCALES = ["ar", "en"];
const LOCALE_COOKIE = "dz_locale";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Admin protection ──
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session || (session.role !== "ADMIN" && session.role !== "EDITOR")) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── Locale routing ──
  const first = pathname.split("/")[1];
  if (LOCALES.includes(first)) {
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set("x-pathname", pathname);
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    if (req.cookies.get(LOCALE_COOKIE)?.value !== first) {
      res.cookies.set(LOCALE_COOKIE, first, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
    return res;
  }

  // No locale prefix → remembered choice, else Arabic (default).
  const saved = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = saved && LOCALES.includes(saved) ? saved : "ar";
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // everything except api, next internals, uploads and static files
    "/((?!api|_next|uploads|downloads|images|favicon.ico|icon.svg|robots.txt|sitemap.xml|manifest.webmanifest|opengraph-image|.*\\..*).*)",
  ],
};
