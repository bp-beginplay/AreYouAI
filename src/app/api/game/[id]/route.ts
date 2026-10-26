export const maxDuration = 30;

import { auth } from "@/auth";
import { getGameView } from "@/lib/game/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = (await auth())?.user?.email;
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const after = Math.max(0, Math.floor(Number(new URL(request.url).searchParams.get("after"))) || 0);
  const view = await getGameView(id, userId, after);
  if (!view) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(view);
}
