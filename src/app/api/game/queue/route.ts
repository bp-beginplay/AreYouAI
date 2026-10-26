import { auth } from "@/auth";
import { cancelQueue, enqueue, queueStatus, startSoloGame } from "@/lib/game/server";

async function currentUserId() {
  const session = await auth();
  return session?.user?.email ?? null;
}

const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return unauthorized();
  return Response.json(await queueStatus(userId));
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const fast = body?.fast === true;
  if (body?.solo === true) return Response.json(await startSoloGame(userId, fast));
  return Response.json(await enqueue(userId, fast));
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return unauthorized();
  await cancelQueue(userId);
  return Response.json({ ok: true });
}
