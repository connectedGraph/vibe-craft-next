import { redirect } from "next/navigation";
import { ensureSeedOnce, identityFromCookies } from "@/lib/auth";
import AdminApp from "@/components/AdminApp";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  ensureSeedOnce();
  const identity = await identityFromCookies();
  if (!identity) redirect("/login?next=/admin");
  if (identity.role !== "admin") redirect("/");
  return <AdminApp username={identity.username} />;
}
