import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_ROUTES = ["/auth/login", "/auth/signup"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() revalidates the token against the Supabase Auth server.
  // getSession() only reads the cookie and must not be trusted in middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtectedRoute =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/auth/login", "/auth/signup"],
};
