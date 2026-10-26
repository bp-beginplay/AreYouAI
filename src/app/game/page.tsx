import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import GameRoom from "@/components/game/GameRoom";

async function GameGuard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <GameRoom />;
}

export default function GamePage() {
  return (
    <Suspense fallback={null}>
      <GameGuard />
    </Suspense>
  );
}
