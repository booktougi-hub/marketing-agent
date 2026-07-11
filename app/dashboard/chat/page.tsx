import { MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ChatPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="max-w-sm">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <MessageCircle className="h-6 w-6" />
          </span>
          <h1 className="font-heading text-lg font-semibold tracking-tight">
            Chat is coming soon
          </h1>
          <p className="text-sm text-muted-foreground">
            A conversational assistant for your marketing agent is planned for a
            future release.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
