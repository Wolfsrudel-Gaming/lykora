import { useEffect, useState } from "preact/hooks";

/** QR-Code als Bild; die Bibliothek kommt erst bei Bedarf. */
export function QrCode({ value, label, size = 512 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    import("qrcode")
      // CommonJS-Paket: je nach Bündelung liegen die Funktionen direkt oder unter default.
      .then((mod) => (mod.default ?? mod).toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: size, color: { dark: "#000000", light: "#ffffff" } }))
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (failed) return <p class="muted small">QR-Code konnte nicht erzeugt werden.</p>;
  return <div class="qr">{src ? <img src={src} alt={label} width={size} height={size} /> : <div style={{ aspectRatio: "1" }} />}</div>;
}
