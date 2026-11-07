import { type NextRequest, NextResponse } from 'next/server';

/** Redirect to /login before rendering anything when there is no API key cookie. */
export function proxy(req: NextRequest) {
  if (!req.cookies.get('welyvra_api_key')?.value) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!login|_next/static|_next/image|favicon.ico).*)'] };
