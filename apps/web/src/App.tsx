import { PLATFORM_NAME } from "@gradevision/shared";

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">{PLATFORM_NAME}</h1>
      <p className="text-neutral-600">
        Foundational workspace is up. Application features are added in later tasks.
      </p>
    </main>
  );
}
