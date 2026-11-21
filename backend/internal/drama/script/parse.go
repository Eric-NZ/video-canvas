package script

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	reEpisode   = regexp.MustCompile(`^第\s*[\d一二三四五六七八九十百]+\s*集`)
	reHeading   = regexp.MustCompile(`^\d+\s*[-–]\s*\d+\s*(?:(.+?)\s*)?[·•]\s*(.+)$`)
	reHeadBare  = regexp.MustCompile(`^\d+\s*[-–]\s*\d+$`)
	reHeadEN    = regexp.MustCompile(`(?i)^(INT|EXT)\.\s*(.+?)\s*[-–]\s*(DAY|NIGHT)$`)
	reCast      = regexp.MustCompile(`^人物[:：]\s*(.+)$`)
	reProps     = regexp.MustCompile(`^道具[:：]\s*(.+)$`)
	reSubtitle  = regexp.MustCompile(`^【字幕[:：](.+)】$`)
	reShot      = regexp.MustCompile(`^【空镜】(.*)$`)
	reNote      = regexp.MustCompile(`^【备注[:：](.+)】$`)
	reAction    = regexp.MustCompile(`^△\s*(.+)$`)
	reTransit   = regexp.MustCompile(`^(?:切至|切回|淡入|淡出|叠化|黑场)`)
	reDialogue  = regexp.MustCompile(`^([\p{Han}A-Za-z·]{1,8})\s*(?:[（(]([^）)]*)[）)])?\s*[:：]\s*(.+)$`)
	reHeadWrap  = regexp.MustCompile(`^#{1,6}\s+`)
	reBoldWrap  = regexp.MustCompile(`^\*\*(.+)\*\*$`)
	reListSplit = regexp.MustCompile(`[、，,\s]+`)
	reTimeSplit = regexp.MustCompile(`[/／\s]+`)
	reTagSplit  = regexp.MustCompile(`[，,]`)
	rePropSplit = regexp.MustCompile(`[、，,]+`)
)

// reservedLabels 是剧本里常见的「字段名：内容」的字段名，它们不是说话人。
var reservedLabels = map[string]bool{
	"剧名": true, "片名": true, "标题": true, "题材": true, "类型": true, "风格": true, "画风": true,
	"时代背景": true, "背景": true, "核心视觉基调": true, "视觉基调": true, "主题": true, "简介": true, "梗概": true,
	"大纲": true, "概述": true, "总述": true, "主要人物": true, "人物": true, "人物设定": true, "人物小传": true,
	"角色": true, "场景": true, "地点": true, "时间": true, "道具": true, "画面": true,
	"备注": true, "说明": true, "注": true, "提示": true, "要求": true,
}

// parser 逐行读文本，把每行归到当前场次。
type parser struct {
	r     Resolver
	res   ParseResult
	cur   *Scene
	extra []string // 当前场「人物：」行里的名字，场次结束时再去掉说话人
	// preamble 为 true 表示还在文头：文本里有场次标题，而现在还没读到第一个。
	// 文头通常是剧名、时代背景、人物介绍这类「字段名：内容」，不是台词，不能当说话人。
	preamble bool
}

// Parse 把内置格式（也容忍常见变体）的文本解析成场次和元素。
// 认不出的行当作动作保存并给出警告，原文不丢；第一个场次标题之前的内容放进一个无地点的场次。
func Parse(text string, r Resolver) ParseResult {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	p := &parser{r: r, preamble: hasHeading(lines)}
	for i, raw := range lines {
		p.line(i+1, normalize(raw))
	}
	p.closeScene()
	return p.res
}

// hasHeading 判断文本里有没有场次标题。没有标题的文本是粘贴来的片段（几行对白），不存在文头。
func hasHeading(lines []string) bool {
	for _, raw := range lines {
		if _, _, _, ok := parseHeading(normalize(raw)); ok {
			return true
		}
	}
	return false
}

// normalize 去掉空白、Markdown 标题井号和整行加粗。
func normalize(raw string) string {
	s := strings.TrimSpace(raw)
	s = reHeadWrap.ReplaceAllString(s, "")
	if m := reBoldWrap.FindStringSubmatch(s); m != nil {
		s = m[1]
	}
	return strings.TrimSpace(s)
}

func (p *parser) line(no int, s string) {
	if s == "" || reEpisode.MatchString(s) {
		return
	}
	if intExt, tm, loc, ok := parseHeading(s); ok {
		p.preamble = false
		p.openScene(intExt, tm, loc)
		return
	}
	p.ensureScene(no)
	// 文头里只认方括号标注和 △ 动作，其余原样作为动作保存，不识别台词；
	// 文头已经在 ensureScene 里提示过一次，这里不再逐行警告
	if p.meta(s) || p.marker(s) || (!p.preamble && p.speech(no, s)) {
		return
	}
	p.add(Element{Type: Action, Text: s})
	if !p.preamble {
		p.warn(no, "未识别的行已作为动作保存")
	}
}

// parseHeading 识别场次标题，返回内外景、时间和地点名。
func parseHeading(s string) (intExt, tm, loc string, ok bool) {
	if m := reHeadEN.FindStringSubmatch(s); m != nil {
		intExt = Interior
		if strings.EqualFold(m[1], "EXT") {
			intExt = Exterior
		}
		tm = "日"
		if strings.EqualFold(m[3], "NIGHT") {
			tm = "夜"
		}
		return intExt, tm, strings.TrimSpace(m[2]), true
	}
	if m := reHeading.FindStringSubmatch(s); m != nil {
		for _, tok := range reTimeSplit.Split(strings.TrimSpace(m[1]), -1) {
			switch tok {
			case "":
			case "内":
				intExt = Interior
			case "外":
				intExt = Exterior
			case "内外":
				intExt = InteriorExterior
			default:
				tm = tok
			}
		}
		return intExt, tm, strings.TrimSpace(m[2]), true
	}
	return "", "", "", reHeadBare.MatchString(s)
}

func (p *parser) openScene(intExt, tm, loc string) {
	p.closeScene()
	sc := Scene{IntExt: intExt, TimeLabel: tm, Emotions: []string{}, Props: []string{}}
	if loc != "" {
		sc.LocationID = p.r.Location(loc)
	}
	p.cur = &sc
}

// ensureScene 在没有场次标题时补一个无地点的场次并提示。
func (p *parser) ensureScene(no int) {
	if p.cur != nil {
		return
	}
	p.openScene("", "", "")
	p.warn(no, "场次标题之前的内容已放进一个没有地点的场次")
}

func (p *parser) closeScene() {
	if p.cur == nil {
		return
	}
	speakers := map[uint64]bool{}
	for _, e := range p.cur.Elements {
		if e.Type == Character {
			speakers[e.CharacterID] = true
		}
	}
	seen := map[uint64]bool{}
	for _, name := range p.extra {
		id := p.r.Character(name)
		if id == 0 || speakers[id] || seen[id] {
			continue
		}
		seen[id] = true
		p.cur.ExtraCharacterIDs = append(p.cur.ExtraCharacterIDs, id)
	}
	p.res.Scenes = append(p.res.Scenes, *p.cur)
	p.cur, p.extra = nil, nil
}

// meta 处理「人物：」「道具：」行。
func (p *parser) meta(s string) bool {
	if m := reCast.FindStringSubmatch(s); m != nil {
		p.extra = append(p.extra, splitList(m[1])...)
		return true
	}
	if m := reProps.FindStringSubmatch(s); m != nil {
		for _, name := range rePropSplit.Split(m[1], -1) {
			if name = strings.TrimSpace(name); name != "" {
				p.cur.Props = append(p.cur.Props, name)
			}
		}
		return true
	}
	return false
}

func splitList(s string) []string {
	var out []string
	for _, v := range reListSplit.Split(s, -1) {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

// marker 处理方括号标注、△ 动作和转场。
func (p *parser) marker(s string) bool {
	switch {
	case s == "【闪回】":
		p.add(Element{Type: FlashbackStart})
	case s == "【闪回结束】":
		p.add(Element{Type: FlashbackEnd})
	case reSubtitle.MatchString(s):
		p.add(Element{Type: Subtitle, Text: strings.TrimSpace(reSubtitle.FindStringSubmatch(s)[1])})
	case reShot.MatchString(s):
		p.add(Element{Type: Shot, Text: strings.TrimSpace(reShot.FindStringSubmatch(s)[1])})
	case reNote.MatchString(s):
		p.add(Element{Type: Note, Text: strings.TrimSpace(reNote.FindStringSubmatch(s)[1])})
	case reAction.MatchString(s):
		p.add(Element{Type: Action, Text: strings.TrimSpace(reAction.FindStringSubmatch(s)[1])})
	case reTransit.MatchString(s):
		p.add(Element{Type: Transition, Text: s})
	default:
		return false
	}
	return true
}

// speech 处理「人物（语气）：台词」，拆成角色行、括号行和对白行；人物解析不出来时放弃，交给动作兜底。
func (p *parser) speech(no int, s string) bool {
	m := reDialogue.FindStringSubmatch(s)
	if m == nil || reservedLabels[m[1]] {
		return false
	}
	id := p.r.Character(m[1])
	if id == 0 {
		return false
	}
	ext, paren := splitTags(m[2])
	p.add(Element{Type: Character, CharacterID: id, Extension: ext})
	if paren != "" {
		p.add(Element{Type: Parenthetical, Text: paren})
	}
	p.add(Element{Type: Dialogue, Text: strings.TrimSpace(m[3])})
	return true
}

// splitTags 把括号里的内容拆成画外音标记（OS/VO）和语气文字。
func splitTags(s string) (ext, paren string) {
	var rest []string
	for _, t := range reTagSplit.Split(s, -1) {
		t = strings.TrimSpace(t)
		switch strings.ToUpper(t) {
		case "":
		case ExtOS, ExtVO:
			ext = strings.ToUpper(t)
		default:
			rest = append(rest, t)
		}
	}
	return ext, strings.Join(rest, "，")
}

func (p *parser) add(e Element) { p.cur.Elements = append(p.cur.Elements, e) }

func (p *parser) warn(line int, msg string) {
	p.res.Warnings = append(p.res.Warnings, Warning{Line: line, Message: fmt.Sprintf("第 %d 行：%s", line, msg)})
}
