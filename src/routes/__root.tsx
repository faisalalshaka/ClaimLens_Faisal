import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ScanSearch, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clearAllSettlements } from "@/lib/settlement";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { RoleProvider, useRole } from "@/lib/role";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">
            Go to queue
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ClaimLens" },
      { name: "description", content: "Internal AI-assisted vehicle damage assessment console." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ResetDemoButton() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        if (!confirm("Reset all claims to their original demo state? All review progress will be lost.")) return;
        setBusy(true);
        const { error } = await supabase.rpc("reset_demo" as never);
        setBusy(false);
        if (error) {
          toast.error("Reset failed: " + error.message);
          return;
        }
        clearAllSettlements(); // repair & settlement tracking lives in this browser, so wipe it too
        await qc.invalidateQueries();
        navigate({ to: "/" });
        toast.success("Demo claims reset");
      }}
      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
    >
      <RotateCcw className="h-3.5 w-3.5" /> {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}

function Header() {
  const { role, setRole } = useRole();
  const navigate = useNavigate();
  // Switching roles always lands on that role's dashboard, never on the claim that was open.
  const switchRole = (r: typeof role) => {
    if (r === role) return;
    setRole(r);
    navigate({ to: "/" });
  };
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-5">
        <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
            <ScanSearch className="h-4 w-4" />
          </span>
          ClaimLens
        </Link>
        <nav className="flex items-center gap-1 text-[13px]">
          <Link to="/" className="rounded-full px-3 py-1 text-muted-foreground transition-colors hover:text-foreground" activeOptions={{ exact: true }} activeProps={{ className: "!text-foreground font-medium" }}>
            Queue
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <ResetDemoButton />
          <div className="flex rounded-full bg-secondary p-0.5" role="group" aria-label="Role">
            {(["junior", "senior"] as const).map((r) => (
              <button
                key={r}
                onClick={() => switchRole(r)}
                aria-pressed={role === r}
                className={cn(
                  "rounded-full px-3.5 py-1 text-[13px] font-medium text-muted-foreground transition-all duration-200",
                  role === r ? "bg-card text-foreground shadow-card" : "hover:text-foreground",
                )}
              >
                {r === "junior" ? "Junior Agent" : "Senior Adjuster"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <RoleProvider>
        <div className="min-h-screen bg-background">
          <Header />
          <Outlet />
        </div>
        <Toaster position="bottom-right" />
      </RoleProvider>
    </QueryClientProvider>
  );
}
