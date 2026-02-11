import { redirect } from "react-router";
import { getSessionUser } from "./session.server";

export async function requireAuth(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    throw redirect("/login");
  }
  return user;
}

export async function requireAdmin(request: Request) {
  const user = await requireAuth(request);
  if (user.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}

export async function requireEditor(request: Request) {
  const user = await requireAuth(request);
  if (user.role === "viewer") {
    throw new Response("Forbidden", { status: 403 });
  }
  return user;
}
