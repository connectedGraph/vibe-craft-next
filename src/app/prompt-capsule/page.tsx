import { redirect } from "next/navigation";
import { authConfig, ensureSeedOnce, findUser, getMode, identityFromCookies } from "@/lib/auth";
import CapsuleApp from "@/components/capsule/CapsuleApp";

export const dynamic = "force-dynamic";

export default async function PromptCapsulePage() {
  ensureSeedOnce();
  let identity = await identityFromCookies();
  if (!identity && getMode() === "off") {
    const admin = findUser(authConfig.adminUser || "admin");
    if (admin && !admin.disabled) identity = { username: admin.username, role: admin.role, user: admin };
  }
  if (!identity) redirect("/login?next=/prompt-capsule");

  return <CapsuleApp username={identity.username} />;
}
