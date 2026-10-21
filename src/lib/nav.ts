import {
  CalendarDays,
  Home,
  ListChecks,
  NotebookPen,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

/**
 * Primary destinations — shared by the desktop sidebar and mobile bottom
 * navigation. Daily / Deadlines / Bucket list live on Home, while hobbies and
 * notes have their own first-class space.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: Home,
    match: (p) => p === "/",
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: CalendarDays,
    match: (p) => p.startsWith("/calendar"),
  },
  {
    href: "/hobbies",
    label: "Hobby & Notes",
    icon: NotebookPen,
    match: (p) => p.startsWith("/hobbies"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: UserRound,
    match: (p) => p.startsWith("/profile"),
  },
];

/** Secondary lists — reachable from Home and the desktop sidebar. */
export const LIST_LINKS: NavItem[] = [
  {
    href: "/remainder",
    label: "Deadlines",
    icon: ListChecks,
    match: (p) => p.startsWith("/remainder"),
  },
  {
    href: "/occasional",
    label: "Bucket list",
    icon: Sparkles,
    match: (p) => p.startsWith("/occasional"),
  },
];
