import { auth } from "@/auth";
import { postMessage } from "@/lib/game/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = (await auth())?.user?.email;
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const ok = typeof body?.text === "string" && (await postMessage(id, userId, body.text));
  return Response.json({ ok }, { status: ok ? 200 : 400 });
}
