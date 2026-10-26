import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SignOutButton from "@/components/SignOutButton";

async function Welcome() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <>
      <p className="text-zinc-600 dark:text-zinc-400">
        {session.user.name}님, 환영합니다.
      </p>
      <SignOutButton />
    </>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Are You AI?</h1>
      <Suspense fallback={null}>
        <Welcome />
      </Suspense>
    </main>
  );
}
