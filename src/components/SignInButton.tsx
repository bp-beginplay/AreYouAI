import { signIn } from "@/auth";

export default function SignInButton({ redirectTo = "/" }: { redirectTo?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo });
      }}
    >
      <button
        type="submit"
        className="flex h-12 w-full items-center justify-center gap-3 rounded-full bg-foreground px-6 font-medium text-background transition-colors hover:opacity-90"
      >
        Google로 로그인
      </button>
    </form>
  );
}
