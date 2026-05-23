// import { getToken } from "next-auth/jwt";
// import { NextResponse } from "next/server";
// import type { NextRequest } from "next/server";

// export async function proxy(req: NextRequest) {
//   const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
//   const { pathname } = req.nextUrl;

//   // Protect paths starting with /app
//   if (pathname.startsWith("/app")) {
//     const isAuthPage = pathname === "/app/login" || pathname === "/app/signup";

//     if (isAuthPage) {
//       if (token) {
//         return NextResponse.redirect(new URL("/app", req.url));
//       }
//       return NextResponse.next();
//     }

//     if (!token) {
//       return NextResponse.redirect(new URL("/app/login", req.url));
//     }
//   }

//   return NextResponse.next();
// }

// export const config = {
//   matcher: ["/app/:path*"],
// };

import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ req, token }) => {
      const { pathname } = req.nextUrl;
      
      // Allow public access to login, signup, and shared views
      if (
        pathname === "/app/login" ||
        pathname === "/app/signup" ||
        pathname === "/app/demo" ||
        pathname.startsWith("/app/view/")
      ) {
        return true;
      }
      
      // Require authentication for all other /app routes
      return !!token;
    },
  },
  pages: {
    signIn: "/app/login",
  },
});

export const config = {
  matcher: ["/app/:path*"],
};
