import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SignInButton from "@/components/SignInButton";

async function LoginForm() {
  const session = await auth();
  if (session) redirect("/");

  return <SignInButton />;
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Are You AI?</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          5명의 대화 속에 숨어 있는 AI를 찾아보세요.
        </p>
      </div>
      <div className="w-full max-w-xs">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
