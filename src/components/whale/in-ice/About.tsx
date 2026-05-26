// src/components/whale/in-ice/About.tsx

import { Section, SectionHeading } from "./shared";

export function About() {
  return (
    <Section id="about">
      <SectionHeading
        eyebrow="About"
        title={
          <>
            記憶に残る体験を、<br className="md:hidden" />
            設計する。
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
        <div className="md:col-span-7">
          <p className="text-[15px] md:text-[16px] leading-[2.1] text-[color:var(--ice-text)]">
            氷のくじらは、マーダーミステリー・ARG・イマーシブ・LINE 連動体験など、物語体験を扱う制作レーベルです。
          </p>
          <p className="text-[15px] md:text-[16px] leading-[2.1] text-[color:var(--ice-text)] mt-5">
            物語、選択、現実の移動、スマートフォン上の演出。
            それらを組み合わせて、観客の中に物語の余韻として残り続ける体験を設計します。
          </p>
          <p className="text-[14px] md:text-[15px] leading-[2.0] text-[color:var(--ice-text-muted)] mt-7">
            派手な舞台装置よりも、参加者の心に残る一行の台詞、
            一瞬の選択、誰にも言えない秘密。
            そういう静かな手触りを大切にしています。
          </p>
        </div>

        {/* 右カラム: 引用風の装飾ブロック */}
        <aside className="md:col-span-5 flex md:items-center">
          <blockquote
            className="ice-serif relative border-l border-[color:var(--ice-border-strong)] pl-6 md:pl-7 text-[16px] md:text-[18px] leading-[2.0] text-[color:var(--ice-accent-strong)] italic"
          >
            <span className="block">
              「物語のあとに残る、<br />
              名前のない感触を。」
            </span>
          </blockquote>
        </aside>
      </div>
    </Section>
  );
}
