package drama_test

import (
	"errors"
	"strings"
	"testing"

	"video-canvas/internal/drama"
)

// 第二期：剧本、资产拆解、资产图提示词和分镜一样分成创作段与格式段。
// 创作段的内置正文只有创作方法，不含 JSON 字段、栏名或编号格式。
func TestPhase2CreativeBodiesHoldNoFormat(t *testing.T) {
	for _, tc := range []struct {
		step string
		bad  []string
	}{
		{"scripts", []string{"### 剧本格式", "△", "【本集完】", "（OS）", "JSON", "输出 JSON Schema"}},
		{"breakdown", []string{"enum", "maxLength", "voice_prompt", "\"type\"", "输出 JSON Schema"}},
		{"asset_prompts", []string{"node_id", "16:9", "3:4", "prompts", "输出 JSON Schema"}},
	} {
		t.Run(tc.step, func(t *testing.T) {
			body := drama.PromptBody(tc.step)
			if body == "" {
				t.Fatal("内置创作正文为空")
			}
			for _, word := range tc.bad {
				if strings.Contains(body, word) {
					t.Fatalf("内置创作正文不该出现 %s", word)
				}
			}
			prompt, err := drama.Prompt(tc.step, map[string]any{})
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(prompt, "## 输出约定") || strings.Contains(prompt, "## 输出 JSON Schema") {
				t.Fatalf("创作段应是纯文本输出约定:\n%s", prompt)
			}
		})
	}
}

// 格式段保留原来的结构约束：JSON Schema 与校验规则都在，且只接收创作稿。
func TestPhase2FormatPromptsKeepSchema(t *testing.T) {
	for _, step := range []string{"scripts_format", "breakdown_format", "asset_prompts_format"} {
		t.Run(step, func(t *testing.T) {
			prompt, err := drama.Prompt(step, map[string]any{"draft_md": "草稿"})
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{"## 输出 JSON Schema", `"required"`, "## 校验规则", "草稿"} {
				if !strings.Contains(prompt, want) {
					t.Fatalf("格式段缺少 %s", want)
				}
			}
		})
	}
}

// 剧本格式规则归格式段：创作段不再要求场次标题与标记。
func TestPhase2ScriptFormatRulesMoved(t *testing.T) {
	format, err := drama.Prompt("scripts_format", map[string]any{"draft_md": "草稿"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"### 剧本格式", "△", "【本集完】"} {
		if !strings.Contains(format, want) {
			t.Fatalf("剧本格式段缺少 %s", want)
		}
	}
}

// 创作段输出纯文本：剧本、资产设定和画面描述都不解析 JSON，只拒绝空白与超长。
func TestPhase2DraftOutputIsText(t *testing.T) {
	for _, step := range []string{"scripts", "breakdown", "asset_prompts"} {
		t.Run(step, func(t *testing.T) {
			got, err := drama.DecodeOutput(step, []byte("角色甲：走。"))
			if err != nil {
				t.Fatal(err)
			}
			if text, ok := got.(string); !ok || text != "角色甲：走。" {
				t.Fatalf("草稿应原样返回字符串，got %#v", got)
			}
			if _, err := drama.DecodeOutput(step, []byte(" \n ")); !errors.Is(err, drama.ErrOutputInvalid) {
				t.Fatalf("空白草稿应判无效，got %v", err)
			}
		})
	}
}

// 用户正文只替换创作段的正文，格式段的输出约定与 Schema 不变。
func TestPhase2CustomBodyKeepsProtocol(t *testing.T) {
	for _, step := range []string{"scripts", "breakdown", "asset_prompts"} {
		t.Run(step, func(t *testing.T) {
			prompt, err := drama.PromptWithBody(step, map[string]any{}, "用户自己的写法：冷峻简短。")
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(prompt, "用户自己的写法：冷峻简短。") || !strings.Contains(prompt, "## 输出约定") {
				t.Fatalf("用户正文应替换创作段且保留输出约定:\n%s", prompt)
			}
		})
	}
}
