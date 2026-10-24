import type { JSX } from "preact";
import { base, pagePath } from "../lib/base.ts";
import { navigate } from "../lib/router.ts";

type AnchorProps = Omit<JSX.HTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** Link innerhalb der App: echte Adresse für neue Tabs, ohne Neuladen beim normalen Klick. */
export function Link({ to, onClick, children, ...rest }: AnchorProps) {
  return (
    <a
      {...rest}
      href={pagePath(base(), to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
