import { FremanWordmark } from "@/components/FremanWordmark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-foreground">
      <FremanWordmark className="text-2xl" />
      <p className="mt-8 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        404 — Not found
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">
        This page isn't in the build.
      </h1>
      <p className="mt-3 max-w-sm text-center text-sm leading-6 text-muted-foreground">
        The page you're looking for doesn't exist in this version of Freman.
      </p>
      <Button asChild variant="outline" className="mt-8 rounded-full px-6">
        <a href="/">Back to Freman</a>
      </Button>
    </div>
  );
}
