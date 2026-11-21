import { useState } from "react";
import { GripVertical, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ScriptEditorApi } from "./use-script-editor";

/** 情绪标签的输入框：回车添加，输入法组字时不触发 */
function EmotionInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <input
      value={text}
      maxLength={16}
      placeholder="+ 情绪"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.key !== "Enter" || !text.trim()) return;
        onAdd(text.trim());
        setText("");
      }}
      className="ring-chrome-border placeholder:text-muted-foreground/70 h-[22px] w-[76px] rounded-full bg-transparent px-2.5 text-xs ring-1 outline-none"
    />
  );
}

/**
 * 场次栏：本集每一场的场号、短标题和出场人物；点开可以写短标题、梗概、情绪标签，
 * 拖动调整场次顺序（场号随之重排）。短标题、梗概、情绪本期手填，以后由跨集状态提取自动填。
 * @param editor 剧本编辑器状态
 * @param no 集号，用来显示场号
 * @param onJump 点场次时，让稿纸滚到这一场
 */
export function SceneList({
  editor,
  no,
  onJump,
}: {
  editor: ScriptEditorApi;
  no: number;
  onJump: (sceneKey: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const readOnly = editor.readOnly;
  const person = (id: string | null) => editor.characters.find((c) => c.id === id);
  return (
    <ol className="mb-5 grid gap-0.5">
      {editor.scenes.map((scene, index) => {
        const place = editor.locations.find((l) => l.id === scene.locationId)?.name;
        const cast = [
          ...new Set(
            scene.elements.filter((e) => e.type === "character").map((e) => e.characterId),
          ),
        ];
        const expanded = open === scene.key;
        return (
          <li
            key={scene.key}
            draggable={!readOnly}
            onDragStart={() => setDragging(scene.key)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(scene.key);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) editor.moveScene(dragging, scene.key);
              setDragging(null);
              setOver(null);
            }}
            className={cn(
              "rounded-xl",
              expanded && "bg-muted/60",
              dragging === scene.key && "opacity-40",
              over === scene.key &&
                dragging !== scene.key &&
                "shadow-[0_-2px_0_var(--status-warning)]",
            )}
          >
            <div className="flex items-center gap-1 px-1">
              {!readOnly && (
                <GripVertical className="text-muted-foreground size-3.5 shrink-0 cursor-grab" />
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(expanded ? null : scene.key);
                  onJump(scene.key);
                }}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-left text-[13px] outline-none focus-visible:ring-2"
              >
                <span className="shrink-0 font-mono text-[11px]">
                  {no}-{index + 1}
                </span>
                <span className="truncate">{scene.title || place || "未选地点"}</span>
              </button>
              <span className="flex shrink-0 -space-x-1">
                {cast.slice(0, 3).map((id) => {
                  const p = person(id);
                  return (
                    <span
                      key={id}
                      title={p?.name}
                      className={cn(
                        "ring-background grid size-5 place-items-center rounded-full text-[10px] font-semibold ring-2",
                        p?.canvasNodeId
                          ? "bg-status-warning/15 text-status-warning"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {p?.name.slice(0, 1) ?? "?"}
                    </span>
                  );
                })}
              </span>
            </div>
            {!expanded && scene.emotions.length > 0 && (
              <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                {scene.emotions.map((e) => (
                  <span
                    key={e}
                    className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px]"
                  >
                    {e}
                  </span>
                ))}
              </div>
            )}
            {expanded && (
              <div className="grid gap-2 px-2 pb-2.5">
                <input
                  value={scene.title}
                  maxLength={255}
                  disabled={readOnly}
                  placeholder="短标题"
                  onChange={(e) => editor.patchScene(scene.key, { title: e.target.value })}
                  className="bg-chrome-hover ring-chrome-border h-8 rounded-full px-3 text-[13px] ring-1 outline-none disabled:opacity-60"
                />
                <textarea
                  value={scene.summary}
                  maxLength={4000}
                  rows={2}
                  disabled={readOnly}
                  placeholder="梗概"
                  onChange={(e) => editor.patchScene(scene.key, { summary: e.target.value })}
                  className="bg-chrome-hover ring-chrome-border max-h-32 resize-y rounded-2xl px-3 py-1.5 text-[13px] ring-1 outline-none disabled:opacity-60"
                />
                <div className="flex flex-wrap gap-1">
                  {scene.emotions.map((emotion, k) => (
                    <span
                      key={emotion}
                      className="bg-muted text-muted-foreground inline-flex h-[22px] items-center gap-0.5 rounded-full pr-1 pl-2.5 text-xs"
                    >
                      {emotion}
                      {!readOnly && (
                        <button
                          type="button"
                          title="移除"
                          onClick={() =>
                            editor.patchScene(scene.key, {
                              emotions: scene.emotions.filter((_, i) => i !== k),
                            })
                          }
                          className="hover:bg-chrome-hover grid size-4 place-items-center rounded-full"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {!readOnly && scene.emotions.length < 12 && (
                    <EmotionInput
                      onAdd={(text) =>
                        scene.emotions.includes(text)
                          ? undefined
                          : editor.patchScene(scene.key, { emotions: [...scene.emotions, text] })
                      }
                    />
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
