"use client";

/**
 * テスターモード時に router.push / router.replace の遷移先を
 * 自動で tester URL に変換するラッパーフック。
 *
 * 使い方:
 *   const router = useTesterRouter();   // useRouter() の代わり
 *   router.push(`/oas/${oaId}/works/${workId}/messages`);
 *   // → testerモード時は /tester/{testerOaId}/works/{workId}/messages に変換
 */

import { useRouter } from "next/navigation";
import { useTesterMode } from "@/hooks/useTesterMode";
import { toTesterHref } from "@/lib/tester-href";

export function useTesterRouter() {
  const router      = useRouter();
  const { testerOaId } = useTesterMode();
  const convert     = (href: string) => toTesterHref(href, testerOaId);

  return {
    push:    (href: string, options?: Parameters<typeof router.push>[1])    => router.push(convert(href), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(convert(href), options),
    back:    () => router.back(),
    forward: () => router.forward(),
    refresh: () => router.refresh(),
    prefetch:(href: string) => router.prefetch(convert(href)),
  };
}
