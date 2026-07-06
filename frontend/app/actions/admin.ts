"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function toggleUserApproval(userId: string, isApproved: boolean) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { isApproved },
    });
    
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("Failed to toggle approval:", error);
    return { error: "Failed to update user approval status" };
  }
}
