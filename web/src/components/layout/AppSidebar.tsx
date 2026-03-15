import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  Bot,
  CalendarClock,
  Brain,
  PanelLeftClose,
  PanelLeft,
  SquarePen,
  LogIn,
  LogOut,
  Settings2,
  Github,
  BookOpen,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useSidebar } from "@/hooks/useSidebar";
import { isTauri } from "@/api/transport";
import { useAppStore } from "@/stores/app";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** 行内左右 padding，保证收起时图标在 52px 内居中 (8+36+8=52) */
const ROW_PX = "px-2";

interface AppSidebarProps {
  onOpenSettings: () => void;
}

export function AppSidebar({ onOpenSettings }: AppSidebarProps) {
  const { isCollapsed, toggle } = useSidebar();
  const { t } = useI18n();
  const { user, isLoggedIn, authLoading, login, logout, cloudEnabled } = useAppStore();
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("get_platform").then(setPlatform);
    });
  }, []);

  const isMac = platform === "macos";

  const navItems = [
    { to: "/", icon: SquarePen, label: t.nav.chat },
    { to: "/agents", icon: Bot, label: t.nav.agents },
    { to: "/cron", icon: CalendarClock, label: t.nav.tasks },
    { to: "/memory", icon: Brain, label: t.nav.memory },
  ];

  // 头像组件
  const AvatarView = ({ size = "md" }: { size?: "sm" | "md" }) => {
    const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";

    if (isLoggedIn && user?.avatar) {
      return <img src={user.avatar} alt={user.name} className={cn("rounded-full object-cover", sizeClass)} />;
    }
    if (isLoggedIn && user) {
      return (
        <div className={cn("rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold", sizeClass)}>
          {user.name?.[0]?.toUpperCase() ?? '?'}
        </div>
      );
    }
    // 离线 / 未登录：默认头像
    return (
      <div className={cn("rounded-full bg-muted flex items-center justify-center text-muted-foreground", sizeClass)}>
        <User className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
      </div>
    );
  };

  // 用户名显示
  const displayName = isLoggedIn && user ? user.name : (cloudEnabled ? t.account.notLoggedIn : t.account.offlineMode);
  const displaySub = isLoggedIn && user ? "Pro Plan" : (cloudEnabled ? t.account.loginHint : t.account.offlineModeHint);

  return (
      <aside
        className={cn(
          "shrink-0 flex flex-col overflow-hidden",
          "bg-muted/30 border-r",
          "border-[var(--subtle-border)]",
          "transition-[width] duration-200 ease-[var(--ease-soft)]",
          isCollapsed ? "w-[52px]" : "w-[220px]",
        )}
        aria-expanded={!isCollapsed}
      >
        {/* macOS 交通灯空间 */}
        {isMac && (
          <div
            className="h-7 shrink-0"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          />
        )}

        {/* 顶部操作栏 */}
        <div
          className={cn("flex items-center h-[52px] shrink-0", ROW_PX)}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {isCollapsed ? (
            <button
              type="button"
              onClick={toggle}
              className="w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]"
              aria-label={t.sidebar.expand}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 ml-1.5 mr-1">
              <img src="/icon.svg" alt="YouClaw" className="h-5 w-5" />
              <span className="text-md font-semibold tracking-tight whitespace-nowrap text-primary">
                YouClaw
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0" />
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center hover:bg-[var(--surface-hover)] transition-all duration-200 ease-[var(--ease-soft)]",
              isCollapsed ? "opacity-0 pointer-events-none" : "opacity-100",
            )}
            aria-label={t.sidebar.collapse}
            tabIndex={isCollapsed ? -1 : 0}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* 页面导航 */}
        <nav className="space-y-0.5 px-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={`nav-${item.to === "/" ? "chat" : item.to.slice(1)}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center h-9 rounded-[10px] whitespace-nowrap overflow-hidden",
                  "transition-all duration-200 ease-[var(--ease-soft)]",
                  isCollapsed ? "px-0.5" : "px-1",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]",
                )
              }
              aria-label={item.label}
            >
              <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                <item.icon className="h-4 w-4" />
              </div>
              <span
                className={cn(
                  "text-sm transition-opacity duration-200",
                  isCollapsed ? "opacity-0" : "opacity-100",
                )}
              >
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* 填充空间 */}
        <div className="flex-1" />

        {/* 底部：用户头像弹出菜单 */}
        <div
          className="border-t border-[var(--subtle-border)] py-2 px-1.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center w-full rounded-xl transition-all duration-200 ease-[var(--ease-soft)] outline-none",
                  isCollapsed ? "px-0.5 py-1 justify-center" : "gap-2.5 px-2.5 py-2.5 hover:bg-[var(--surface-hover)]",
                )}
              >
                <AvatarView size={isCollapsed ? "sm" : "md"} />
                {!isCollapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-semibold truncate">{isLoggedIn && user ? user.name : (cloudEnabled ? t.account.login : t.account.offlineMode)}</p>
                    {isLoggedIn && user && (
                      <p className="text-[10px] text-muted-foreground truncate">Pro Plan</p>
                    )}
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-[240px] rounded-xl p-2"
            >
              {/* 顶部用户信息区 */}
              <div className="flex flex-col items-center py-3 px-2">
                <div className="mb-2">
                  <AvatarView size="md" />
                </div>
                <p className="text-sm font-semibold truncate max-w-full">{displayName}</p>
                <p className="text-[11px] text-muted-foreground truncate max-w-full">{displaySub}</p>
              </div>

              <DropdownMenuSeparator />

              {/* 云模式 & 未登录：登录按钮 */}
              {cloudEnabled && !isLoggedIn && (
                <>
                  <DropdownMenuItem onClick={() => login()} disabled={authLoading} className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer">
                    <LogIn className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{authLoading ? t.account.loggingIn : t.account.login}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* 设置 */}
              <DropdownMenuItem onClick={onOpenSettings} className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{t.settings.title}</span>
              </DropdownMenuItem>

              {/* GitHub */}
              <DropdownMenuItem asChild className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer">
                <a href="https://github.com/CodePhiliaX/youClaw" target="_blank" rel="noopener noreferrer">
                  <Github className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">GitHub</span>
                </a>
              </DropdownMenuItem>

              {/* 文档 */}
              <DropdownMenuItem asChild className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer">
                <a href="https://youclaw.dev" target="_blank" rel="noopener noreferrer">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{t.settings.about}</span>
                </a>
              </DropdownMenuItem>

              {/* 登出 — 仅登录状态显示 */}
              {isLoggedIn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => logout()} className="gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" />
                    <span className="text-sm">{t.account.logout}</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
  );
}
