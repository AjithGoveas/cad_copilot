import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Please enter email and password");
        }

        try {
          const user = await prisma.user.findUnique({
            where: { email: credentials.email }
          });

          if (!user || !user.passwordHash) {
            throw new Error("Invalid email or password");
          }

          const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
          if (!isValid) {
            throw new Error("Invalid email or password");
          }

          if (!user.isApproved) {
            throw new Error("ACCOUNT_AWAITING_APPROVAL");
          }

          return {
            id: user.id,
            email: user.email,
            role: user.role,
            isApproved: user.isApproved,
          };
        } catch (err: any) {
          if (err.message === "ACCOUNT_AWAITING_APPROVAL" || err.message === "Invalid email or password") {
            throw err;
          }
          console.error("Auth Authorize Error:", err);
          throw new Error("An unexpected error occurred. Please try again.");
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/app/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as any).role;
        token.isApproved = (user as any).isApproved;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.role = token.role as string;
        session.user.isApproved = token.isApproved as boolean;
      }
      return session;
    }
  },
  secret: process.env.NEXTAUTH_SECRET,
};
