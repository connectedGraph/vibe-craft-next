"use client";

import { useCallback, useEffect, useState } from "react";

export type AccountUser = { username: string; role: string };

export type AccountState = {
  mode: "off" | "self" | "public" | string;
  registrationOpen: boolean;
  user: AccountUser | null;
};

/**
 * 工具页共用的登录态。工具本身不强制登录，这里只负责在设置/侧栏显示
 * 当前账号与「退出登录」入口；退出后回到登录页，并带上当前工具地址。
 */
export function useAccount() {
  const [account, setAccount] = useState<AccountState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setAccount({
        mode: data.mode || "off",
        registrationOpen: !!data.registrationOpen,
        user: data.user || null,
      });
    } catch {
      /* 离线或后端未就绪时保持未知态，不阻塞工具本地使用 */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时读一次登录态（外部接口订阅）
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch {
      /* 即便网络失败也跳登录页，服务端会话会在过期后失效 */
    }
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 退出登录后整页跳转，清掉页面内缓存状态
    window.location.href = `/login?next=${next}`;
  }, []);

  return { account, refresh, logout };
}
