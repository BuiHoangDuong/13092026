"use client";
import { useState } from "react";
import Image from "next/image";
/** `decorative` hides the logo from assistive tech when the exchange name is already shown beside it. */
export function ExchangeLogo({ name, src, decorative = false }: { name: string; src: string | null; decorative?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="aurora-exchange-logo">{src && failed !== src
    ? <Image src={src} alt={decorative ? "" : name} width={148} height={40} className="object-contain" onError={() => setFailed(src)} />
    : <span aria-hidden={decorative || undefined}>{name}</span>}</span>;
}
