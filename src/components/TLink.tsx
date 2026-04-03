"use client";

/**
 * テスターモード時に /oas/.../works/... 系の href を自動変換する Link ラッパー。
 *
 * 使い方（ページ内での import エイリアス）:
 *   import { TLink as Link } from "@/components/TLink";
 *
 * これにより、既存の <Link href={`/oas/...`}> がそのまま tester URL に変換される。
 */

import Link from "next/link";
import { useTesterMode } from "@/hooks/useTesterMode";
import { toTesterHref } from "@/lib/tester-href";
import type { ComponentProps } from "react";

type LinkProps = ComponentProps<typeof Link>;

export function TLink({ href, ...props }: LinkProps) {
  const { testerOaId } = useTesterMode();
  const hrefStr     = typeof href === "string" ? href : String(href);
  const resolvedHref = toTesterHref(hrefStr, testerOaId);
  return <Link href={resolvedHref} {...props} />;
}
