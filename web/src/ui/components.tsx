/**
 * Bausteine der Oberfläche. Diese Datei bündelt alles unter einem Importpfad (ui/components.tsx);
 * die Bausteine selbst liegen in eigenen Dateien: Button, form, feedback, badge, layout, tabs, table, dialog, toast, menu, overlay.
 * Die Entwurfsseite /_design zeigt alle mit allen Zuständen.
 */

import { useEffect } from "preact/hooks";
import { createStore, useStore } from "../lib/store.ts";
import { Button } from "./Button.tsx";

export { Link } from "./Link.tsx";
export { Button, ButtonLink, IconButton, buttonClass, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button.tsx";
export { Checkbox, Field, Input, Radio, RadioGroup, Select, Switch, Textarea, type InputProps, type SelectOption } from "./form.tsx";
export { Banner, Empty, EmptyState, ErrorNotice, ErrorState, Loading, Notice, Progress, ProgressRing, Skeleton, SkeletonCard, SkeletonRows, Spinner, type Status } from "./feedback.tsx";
export { Avatar, Badge, Chip, Count, StatusBadge, StatusDot, TeamDot, initials, teamColor, teamTone, teamVar, type BadgeVariant, type TeamTone } from "./badge.tsx";
export { Breadcrumb, Card, Cluster, Container, Divider, Kbd, PageHeader, Panel, PrintHeader, SectionHeader, Stack, Stat, StatGrid, VisuallyHidden, type CardVariant, type Crumb } from "./layout.tsx";
export { Segmented, Tabs, type TabDef } from "./tabs.tsx";
export { DataTable, nextSort, type Column, type SortState } from "./table.tsx";
export { ConfirmHost, Dialog, Sheet, confirm, type ConfirmOptions, type DialogProps } from "./dialog.tsx";
export { Toasts } from "./toast.tsx";
export { Menu, Popover, type MenuEntry } from "./menu.tsx";
export { Floating, Portal, Tooltip } from "./overlay.tsx";
export { useDown, useLoad, useMedia, useNow, useOutside, useTitle, useUp } from "./hooks.ts";

/** Ein Vorhör-Player für die ganze Seite: Es spielt immer nur ein Klang. */
const preview = createStore<{ src: string | null }>({ src: null });
let audio: HTMLAudioElement | null = null;

export function togglePreview(src: string): void {
  audio ??= new Audio();
  if (preview.get().src === src) {
    audio.pause();
    preview.set({ src: null });
    return;
  }
  audio.pause();
  audio.src = src;
  audio.onended = () => preview.set({ src: null });
  audio.onerror = () => preview.set({ src: null });
  void audio.play().catch(() => preview.set({ src: null }));
  preview.set({ src });
}

function stopPreview(): void {
  audio?.pause();
  preview.set({ src: null });
}

export function PreviewButton({ src, label }: { src: string; label: string }) {
  const { src: playing } = useStore(preview);
  const on = playing === src;
  useEffect(() => () => {
    if (preview.get().src === src) stopPreview();
  }, [src]);
  return (
    <Button size="sm" variant={on ? "primary" : "secondary"} icon={on ? "stop" : "play"} aria-pressed={on} aria-label={`${label} ${on ? "stoppen" : "vorhören"}`} onClick={() => togglePreview(src)} class="btn--icon" />
  );
}
