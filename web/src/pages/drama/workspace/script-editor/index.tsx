import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, GitCompareArrows } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { caretOffset, isCollapsed, setCaret } from "./caret";
import { ElementRow } from "./element-row";
import { EntityPicker, type PickerTarget } from "./entity-picker";
import { SceneHeading } from "./scene-heading";
import { TypeMenu, type TypeMenuTarget } from "./type-menu";
import type { ScriptEditorApi } from "./use-script-editor";

/**
 * 结构化剧本编辑器（稿纸）：场次标题 + 元素行。用户不用输入任何格式符号，
 * Enter 换行并按规则接下一种元素（角色后接对白），Tab 切类型，对白永远挂在角色下面，格式乱不了。
 * 没有常驻工具条：光标所在行的左侧页边亮出类型标签，点开改类型、插闪回、新建一场。
 * @param editor 编辑状态与动作（由外层的 useScriptEditor 创建，侧栏也要用同一份）
 * @param no 集号，用来显示场号
 */
export function ScriptEditor({ editor, no }: { editor: ScriptEditorApi; no: number }) {
  const { scenes, scenesRef, readOnly } = editor;
  // 根节点用 state 持有（回调 ref）：弹层定位的函数要在渲染外读它，闭包 state 比闭包 ref 更干净
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const appliedFocus = useRef(0);
  /** 点页边类型标签打开的类型菜单 */
  const [typeMenu, setTypeMenu] = useState<TypeMenuTarget | null>(null);
  /** 用户点按钮打开的选择框；新建角色行时的自动打开由 editor.focus 推出，不进这里 */
  const [picked, setPicked] = useState<PickerTarget | null>(null);

  const characterName = useMemo(
    () => new Map(editor.characters.map((c) => [c.id, c])),
    [editor.characters],
  );
  const locationName = useMemo(
    () => new Map(editor.locations.map((l) => [l.id, l])),
    [editor.locations],
  );

  // 编辑操作后把光标放到该去的行；每个 token 只应用一次
  useLayoutEffect(() => {
    const f = editor.focus;
    if (!f || f.token === appliedFocus.current) return;
    appliedFocus.current = f.token;
    const row = rootEl?.querySelector<HTMLElement>(`[data-el="${f.key}"]`);
    if (!row) return;
    const text = row.querySelector<HTMLElement>("[data-text]");
    if (text) setCaret(text, f.off ?? "end");
    else row.querySelector<HTMLElement>("[data-pick], [data-focusable]")?.focus();
  }, [editor.focus, rootEl]);

  // 把行切成「角色」后，立刻弹出人物选择：由 focus 推出，不用在 effect 里再 setState；
  // 弹层贴着谁等到真正定位时才去找 DOM，渲染期间不碰 ref
  const autoPick: PickerTarget | null = useMemo(() => {
    const f = editor.focus;
    if (!f?.pick) return null;
    const sc = scenes.find((s) => s.elements.some((e) => e.key === f.key));
    if (!sc) return null;
    return {
      kind: "character",
      sceneKey: sc.key,
      elKey: f.key,
      anchor: () => rootEl?.querySelector<HTMLElement>(`[data-el="${f.key}"] [data-pick]`) ?? null,
    };
  }, [editor.focus, scenes, rootEl]);
  const picker = picked ?? autoPick;

  const closePicker = () => {
    setPicked(null);
    editor.consumeFocus();
  };

  const locate = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>("[data-el]");
    if (!row) return null;
    const sc = scenesRef.current.find((s) => s.key === row.dataset.scene);
    const i = sc?.elements.findIndex((e) => e.key === row.dataset.el) ?? -1;
    return sc && i >= 0 ? { sc, i, el: sc.elements[i] } : null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || readOnly) return;
    const at = locate(e.target);
    if (!at) return;
    const { sc, i, el } = at;
    const text = (e.target as HTMLElement).closest<HTMLElement>("[data-text]");
    if (e.key === "Tab") {
      e.preventDefault();
      editor.cycle(sc.key, i, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      editor.addScene(sc.key);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editor.enter(sc.key, i, text ? caretOffset(text) : 0);
    } else if (e.key === "Backspace") {
      if (text && (!isCollapsed() || caretOffset(text) !== 0)) return;
      e.preventDefault();
      editor.backspace(sc.key, i, !text || el.text === "");
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const at = locate(e.target);
    if (!at || readOnly) return;
    const text = e.clipboardData.getData("text/plain");
    // 单行交给浏览器直接插进文字；多行才需要解析成场次和元素
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    void editor.paste(at.sc.key, at.i, text);
  };

  if (editor.phase === "loading") {
    return (
      <div className="grid gap-2.5 py-2">
        {[90, 70, 80, 55].map((width) => (
          <Skeleton
            key={width}
            className="h-4 motion-reduce:animate-none"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  }
  if (editor.phase === "failed") {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">这一集读取失败，请稍后重试</p>
    );
  }

  const problem = editor.problem;
  const typeScene = typeMenu ? scenes.find((s) => s.key === typeMenu.sceneKey) : undefined;
  const openTypeMenu = (sceneKey: string, elKey: string, anchor: HTMLElement) =>
    setTypeMenu({ sceneKey, elKey, anchor });

  return (
    <div ref={setRootEl} onKeyDown={onKeyDown} onPaste={onPaste}>
      {editor.status === "conflict" && (
        <div
          role="alert"
          className="bg-destructive/10 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 font-sans text-sm"
        >
          <GitCompareArrows className="text-destructive size-4 shrink-0" />
          <span className="flex-1">内容已在别处修改</span>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void editor.reload()}
          >
            重新加载
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void editor.overwrite()}
          >
            覆盖
          </Button>
        </div>
      )}
      {problem && (
        <div
          role="alert"
          className="bg-destructive/10 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 font-sans text-sm"
        >
          <CircleAlert className="text-destructive size-4 shrink-0" />
          <span className="flex-1">
            剧本结构不合法：第 {no}-{problem.scene + 1} 场第 {problem.element + 1} 行，
            {problem.message}
            ，改好后会自动保存
          </span>
        </div>
      )}
      {scenes.map((scene, si) => {
        const loc = scene.locationId ? locationName.get(scene.locationId) : undefined;
        return (
          <section key={scene.key} data-scene-key={scene.key} className="mb-11 scroll-mt-16">
            <SceneHeading
              scene={scene}
              label={`${no}-${si + 1}`}
              locationName={loc?.name ?? null}
              unconfirmed={!!loc && !loc.confirmed}
              editable={!readOnly}
              canDelete={scenes.length > 1}
              onChange={(patch) => editor.patchScene(scene.key, patch)}
              onPickLocation={(anchor) =>
                setPicked({ kind: "location", sceneKey: scene.key, anchor })
              }
              onDelete={() => editor.deleteScene(scene.key)}
            />
            {scene.elements.map((el, ei) => {
              const person = el.characterId ? characterName.get(el.characterId) : undefined;
              return (
                <ElementRow
                  key={el.key}
                  el={el}
                  sceneKey={scene.key}
                  editable={!readOnly}
                  characterName={person?.name ?? null}
                  unconfirmed={!!person && !person.confirmed}
                  highlighted={false}
                  invalid={!!problem && problem.scene === si && problem.element === ei}
                  onText={editor.setText}
                  onPick={(sceneKey, elKey, anchor) =>
                    setPicked({ kind: "character", sceneKey, elKey, anchor })
                  }
                  onExtension={editor.cycleExtension}
                  onTypeMenu={readOnly ? undefined : openTypeMenu}
                />
              );
            })}
          </section>
        );
      })}
      <TypeMenu
        target={typeScene ? typeMenu : null}
        els={typeScene?.elements ?? []}
        onType={(index, type) => typeScene && editor.setType(typeScene.key, index, type)}
        onMarker={(index, type) => typeScene && editor.insertMarker(typeScene.key, index, type)}
        onNewScene={() => typeScene && editor.addScene(typeScene.key)}
        onClose={() => setTypeMenu(null)}
      />
      <EntityPicker
        target={picker}
        entities={picker?.kind === "location" ? editor.locations : editor.characters}
        onPick={(target, id) => {
          if (target.kind === "character" && target.elKey) {
            editor.setCharacter(target.sceneKey, target.elKey, id);
          } else {
            editor.patchScene(target.sceneKey, { locationId: id });
          }
          closePicker();
        }}
        onCreate={(target, name) => {
          void editor.createEntity(target.kind, name).then((id) => {
            if (!id) return;
            if (target.kind === "character" && target.elKey) {
              editor.setCharacter(target.sceneKey, target.elKey, id);
            } else {
              editor.patchScene(target.sceneKey, { locationId: id });
            }
            closePicker();
          });
        }}
        onClose={closePicker}
      />
      <div className={cn("h-24")} aria-hidden />
    </div>
  );
}
