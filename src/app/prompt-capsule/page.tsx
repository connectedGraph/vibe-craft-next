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
  // 工具本身不强制登录：数据先写本地，登录后再同步（与另外四个工具一致）。
  return <CapsuleApp username={identity?.username ?? ""} />;
}
