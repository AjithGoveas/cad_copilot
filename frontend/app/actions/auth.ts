"use server";

import { prisma } from '@/lib/prisma';
import bcrypt from "bcryptjs";

export async function signUpUser(email: string, password: string) {
  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { error: "Please enter a valid email address" };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters long" };
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return { error: "Email is already registered" };
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
      }
    });

    return { success: true };
  } catch (error: any) {
    console.error("Signup Action Error:", error);
    return { error: "An unexpected error occurred. Please try again." };
  }
}
