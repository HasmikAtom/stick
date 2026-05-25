import { Sun, Moon, Monitor, LogOut, ChevronsUpDown } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/ThemeProvider";

type User = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

function UserAvatar({ user }: { user: User }) {
  if (user.image) {
    return <img src={user.image} alt="" className="size-6 rounded-full" />;
  }

  return (
    <div className="flex size-6 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
      {(user.name ?? user.email).charAt(0).toUpperCase()}
    </div>
  );
}

function ThemeSubmenu() {
  const { theme, setTheme } = useTheme();
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ThemeIcon className="mr-2 h-4 w-4" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) =>
            setTheme(value as "dark" | "light" | "system")
          }
        >
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 h-4 w-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 h-4 w-4" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function NavUser({ user }: { user: User }) {
  const displayName = user.name ?? user.email;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={displayName}>
              <div className="flex aspect-square size-8 items-center justify-center">
                <UserAvatar user={user} />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-medium truncate">{displayName}</span>
                {user.name && (
                  <span className="text-xs text-sidebar-foreground/70 truncate">
                    {user.email}
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <ThemeSubmenu />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
