"use client";

import type { CharacterListSettings } from "@/types";

export interface CharacterInfo {
  id: string;
  name: string;
  icon_type: "text" | "image";
  icon_text?: string | null;
  icon_image_url?: string | null;
  icon_color?: string | null;
}

export function CharacterListBlock({
  title,
  settings,
  characters,
}: {
  title?: string | null;
  settings: CharacterListSettings;
  characters: CharacterInfo[];
}) {
  return (
    <div>
      {title && <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>}
      {characters.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">キャラクターが登録されていません</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {characters.map((c) => (
            <div key={c.id} className="flex flex-col items-center gap-2">
              {settings.show_icon !== false && (
                c.icon_type === "image" && c.icon_image_url ? (
                  <img
                    src={c.icon_image_url}
                    alt={c.name}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ background: c.icon_color || "#8b5cf6" }}
                  >
                    {c.icon_text || c.name.charAt(0)}
                  </div>
                )
              )}
              <span className="text-xs text-gray-700 text-center">{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
