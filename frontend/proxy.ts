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
