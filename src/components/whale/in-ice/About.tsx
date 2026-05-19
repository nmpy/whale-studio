// src/components/whale/in-ice/About.tsx
//
// 1 column 詩的リード (再設計版)。
//   - 2 column → 1 column。max-w-[680px] (narrow) で縦読み中心
//   - lead に大きな serif の 1 行リード
//   - 段落の中に引用を擦り込むようにインラインで挿入
//   - 装飾なし、塗りつぶしなし

import { Section, SectionHeading } from "./shared";

export function About() {
  return (
    <Section id="about" narrow>
      <SectionHeading
        number="No.01"
        eyebrow="About"
        title={
          <>
            記憶に残る体験を、<br className="md:hidden" />
            設計する。
          </>
        }
        lead="氷のくじらは、物語のあとに残る体験を設計する制作レーベルです。"
      />

      <div className="flex flex-col gap-7 md:gap-9">
        <p className="text-[15px] md:text-[16px] leading-[2.1] text-[color:var(--ice-text-muted)]">
          扱う領域は、謎解き、マーダーミステリー、イマーシブ体験、舞台連動企画、LINE / LIFF を使った物語体験。
          形式は固定しません。場と物語に対して、もっとも効く形を選んで作ります。
        </p>

        {/* 本文の中にひそかに置く引用 — 罫線 1 本だけで控えめに */}
        <blockquote
          className="ice-serif italic text-[17px] md:text-[19px] leading-[2.0] text-[color:var(--ice-text)] pl-5 md:pl-6 my-2"
          style={{ borderLeft: "1px solid var(--ice-border-strong)" }}
        >
          物語のあとに残る、<br />
          名前のない感触を。
        </blockquote>

        <p className="text-[15px] md:text-[16px] leading-[2.1] text-[color:var(--ice-text-muted)]">
          物語、選択、現実の移動、スマートフォン上の演出。
          それらを組み合わせて、観客の中に物語の余韻として残り続ける体験を設計します。
        </p>

        <p className="text-[14px] md:text-[15px] leading-[2.0] text-[color:var(--ice-text-faint)]">
          派手な舞台装置よりも、参加者の心に残る一行の台詞、一瞬の選択、誰にも言えない秘密。
          そういう静かな手触りを大切にしています。
        </p>
      </div>
    </Section>
  );
}
