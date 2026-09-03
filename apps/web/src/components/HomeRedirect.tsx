import { Navigate } from "react-router-dom";

import { useAuth } from "../lib/auth-context";
import { Spinner } from "./ui";

/** Sends `/` to the right place for the signed-in role. */
export function HomeRedirect() {
  const { status, user } = useAuth();
  if (status === "loading") return <Spinner label="Loading…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "INSTRUCTOR" ? "/dashboard" : "/student"} replace />;
}
