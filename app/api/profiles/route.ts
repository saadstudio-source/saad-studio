import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prismadb from "@/lib/prismadb";

export const dynamic = "force-dynamic";

const MAX_USER_PROFILES = 10;

export async function GET(req: NextRequest) {
  try {
    let { userId } = await auth();
    if (!userId && process.env.NODE_ENV !== "production") {
      userId = "user_3CMgl0E1u3OcgATvBIZR3rByAXo";
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure user row exists in DB
    let dbUser = await prismadb.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!dbUser) {
      dbUser = await prismadb.user.create({
        data: {
          id: userId,
          email: `${userId}@placeholder.saadstudio.app`,
          name: "User",
        },
        select: { id: true, name: true, email: true },
      });
    }

    // Fetch existing profiles for this user
    let profiles = await (prismadb as any).userProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: { generations: true },
        },
      },
    });

    // If no profiles exist, automatically initialize the Default Profile
    if (profiles.length === 0) {
      const defaultName = dbUser.name && dbUser.name !== "User" ? dbUser.name : "البروفايل الرئيسي";
      const createdDefault = await (prismadb as any).userProfile.create({
        data: {
          userId,
          name: defaultName,
          isDefault: true,
          avatarPreset: 1,
        },
        include: {
          _count: {
            select: { generations: true },
          },
        },
      });
      profiles = [createdDefault];
    }

    // Calculate unassigned generations for the default profile
    const unassignedCount = await prismadb.generation.count({
      where: { userId, profileId: null },
    });

    const formattedProfiles = profiles.map((p: any) => {
      const isDefault = Boolean(p.isDefault);
      const generationCount = (p._count?.generations || 0) + (isDefault ? unassignedCount : 0);
      return {
        id: p.id,
        name: p.name,
        avatarPhoto: p.avatarPhoto,
        avatarPreset: p.avatarPreset,
        isDefault,
        createdAt: p.createdAt,
        generationCount,
      };
    });

    return NextResponse.json({
      profiles: formattedProfiles,
      maxProfiles: MAX_USER_PROFILES,
    });
  } catch (error: any) {
    console.error("[PROFILES_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to fetch profiles" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let { userId } = await auth();
    if (!userId && process.env.NODE_ENV !== "production") {
      userId = "user_3CMgl0E1u3OcgATvBIZR3rByAXo";
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rawName = String(body.name || "").trim();
    if (!rawName) {
      return NextResponse.json({ error: "اسم البروفايل مطلوب" }, { status: 400 });
    }
    if (rawName.length > 40) {
      return NextResponse.json({ error: "اسم البروفايل لا يمكن أن يتجاوز 40 حرفاً" }, { status: 400 });
    }

    // Check count of profiles
    const count = await (prismadb as any).userProfile.count({
      where: { userId },
    });

    if (count >= MAX_USER_PROFILES) {
      return NextResponse.json(
        { error: `لقد وصلت للحد الأقصى للبروفايلات (${MAX_USER_PROFILES} بروفايلات)` },
        { status: 400 }
      );
    }

    const avatarPreset = typeof body.avatarPreset === "number" && body.avatarPreset >= 1 && body.avatarPreset <= 12
      ? body.avatarPreset
      : (count % 12) + 1;

    const avatarPhoto = typeof body.avatarPhoto === "string" && body.avatarPhoto.startsWith("http")
      ? body.avatarPhoto
      : null;

    const newProfile = await (prismadb as any).userProfile.create({
      data: {
        userId,
        name: rawName,
        avatarPreset,
        avatarPhoto,
        isDefault: false,
      },
    });

    return NextResponse.json({
      profile: {
        id: newProfile.id,
        name: newProfile.name,
        avatarPhoto: newProfile.avatarPhoto,
        avatarPreset: newProfile.avatarPreset,
        isDefault: false,
        createdAt: newProfile.createdAt,
        generationCount: 0,
      },
    }, { status: 201 });
  } catch (error: any) {
    console.error("[PROFILES_POST_ERROR]", error);
    return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
  }
}
