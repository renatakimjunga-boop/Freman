import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  // Only block on the user lookup once auth has succeeded. A logged-out user
  // should not sit in a permanent loading state while we wait for the current
  // user query to resolve to null.
  const isLoading = isAuthLoading || (isAuthenticated && user === undefined);

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
