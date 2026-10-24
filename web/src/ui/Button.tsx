/** Knöpfe: Button (Varianten, Größen, Laden), IconButton (nur Symbol, Name Pflicht) und ButtonLink (Link im Knopfstil). */

import type { ComponentChildren, JSX, Ref } from "preact";
import { Icon, type IconName } from "./icons.tsx";
import { Link } from "./Link.tsx";
import { Tooltip } from "./overlay.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "link" | "danger" | "danger-quiet" | "safety";
export type ButtonSize = "sm" | "md" | "lg";

/** Klassen eines Knopfs; auch für eigene Elemente (Label, Summary), die wie ein Knopf aussehen sollen. */
export function buttonClass(opts: { variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; block?: boolean; class?: string } = {}): string {
  const { variant = "secondary", size = "md", icon, block, class: extra } = opts;
  return ["btn", `btn--${variant}`, size !== "md" && `btn--${size}`, icon && "btn--icon", block && "btn--block", extra].filter(Boolean).join(" ");
}

export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "loading"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Symbol vor dem Text */
  icon?: IconName;
  /** Symbol nach dem Text */
  iconEnd?: IconName;
  /** Lädt: Spinner statt Symbol, Klicks gesperrt, aria-busy */
  loading?: boolean;
  block?: boolean;
  /** Zähler rechts im Knopf */
  count?: number;
  /** Warum der Knopf gerade nicht geht; er bleibt fokussierbar und erklärt es per Tooltip */
  disabledReason?: string;
  innerRef?: Ref<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
  form?: string;
}

const iconSize = (size: ButtonSize) => (size === "sm" ? 16 : 20);

export function Button({ variant = "secondary", size = "md", icon, iconEnd, loading, block, count, disabledReason, innerRef, type = "button", class: cls, children, onClick, ...rest }: ButtonProps) {
  const blocked = !!disabledReason;
  const btn = (
    <button
      {...rest}
      ref={innerRef}
      type={type}
      class={buttonClass({ variant, size, block, class: typeof cls === "string" ? cls : undefined })}
      aria-busy={loading ? true : undefined}
      aria-disabled={blocked ? true : rest["aria-disabled"]}
      onClick={(e) => {
        if (blocked || loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {loading ? <span class="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={iconSize(size)} />}
      {children}
      {!loading && iconEnd && <Icon name={iconEnd} size={iconSize(size)} />}
      {count !== undefined && <span class="count">{count}</span>}
    </button>
  );
  return blocked ? <Tooltip text={disabledReason!}>{btn}</Tooltip> : btn;
}

/** Nur Symbol: quadratisch; der Name ist Pflicht (aria-label) und erscheint zusätzlich als Tooltip. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  tooltip = true,
  loading,
  innerRef,
  type = "button",
  class: cls,
  ...rest
}: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "size" | "loading" | "children"> & {
  label: string;
  icon: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  tooltip?: boolean;
  loading?: boolean;
  innerRef?: Ref<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
}) {
  const btn = (
    <button {...rest} ref={innerRef} type={type} aria-label={label} aria-busy={loading ? true : undefined} class={buttonClass({ variant, size, icon: true, class: typeof cls === "string" ? cls : undefined })}>
      {loading ? <span class="spinner" aria-hidden="true" /> : <Icon name={icon} size={iconSize(size)} />}
    </button>
  );
  return tooltip ? <Tooltip text={label}>{btn}</Tooltip> : btn;
}

/** Link in der App, der wie ein Knopf aussieht. */
export function ButtonLink({
  to,
  variant = "secondary",
  size = "md",
  icon,
  block,
  class: cls,
  children,
  ...rest
}: Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "size"> & { to: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; block?: boolean; children?: ComponentChildren }) {
  return (
    <Link {...rest} to={to} class={buttonClass({ variant, size, block, class: typeof cls === "string" ? cls : undefined })}>
      {icon && <Icon name={icon} size={iconSize(size)} />}
      {children}
    </Link>
  );
}
