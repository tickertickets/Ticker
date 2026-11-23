import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-32 p-4 text-center">
      <h1 className="text-8xl font-serif font-bold text-primary mb-4">404</h1>
      <h2 className="text-3xl font-serif font-bold text-white mb-6">Lost in the lobby</h2>
      <p className="text-muted-foreground text-lg max-w-md mb-8">
        The ticket you're looking for doesn't exist or has been torn.
      </p>
      <Link href="/" className="outline-none">
        <Button size="lg" className="rounded-full px-8 text-lg">Return Home</Button>
      </Link>
    </div>
  );
}
