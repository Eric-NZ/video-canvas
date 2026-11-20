package migration_test

import (
	"strings"
	"testing"
)

// 公开音色随迁移一起入库：181 条（方舟国内 80 + BytePlus 101），文件在公网地址上，
// 记录里不依赖任何存储配置（storage_id 为 0），新环境跑完迁移就有完整音色库。
func TestOfficialVoicesMigration_SeedsVoicesWithPublicURL(t *testing.T) {
	db := isolatedDB(t)
	runReal(t, db)

	type row struct {
		Scope string
		N     int
	}
	var byScope []row
	if err := db.Raw(`SELECT official_scope AS scope, count(*) AS n FROM assets
		WHERE source = 'official' AND kind = 'audio' AND user_id = 0 GROUP BY official_scope`).Scan(&byScope).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, r := range byScope {
		got[r.Scope] = r.N
	}
	if got["ark-cn"] != 80 || got["byteplus"] != 101 || len(got) != 2 {
		t.Fatalf("公开音色数量不对：%v", got)
	}

	// 每条都有公网音频地址与缩略图地址，不挂存储，带官方溯源 ID 和分类标签。
	var bad int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official' AND (
			public_url NOT LIKE 'https://img.vbing.site/official-voices/%' OR thumbnail_url NOT LIKE 'https://img.vbing.site/official-voices/%'
			OR storage_id <> 0
			OR official_asset_id = '' OR voice_age = '' OR voice_gender = '' OR voice_lang = ''
			OR public_url NOT LIKE '%/' || storage_key OR byte_size <= 0 OR sha256 = '')`).Scan(&bad).Error; err != nil {
		t.Fatal(err)
	}
	if bad != 0 {
		t.Fatalf("有 %d 条公开音色缺公网地址、溯源 ID 或分类标签", bad)
	}

	// 语言按资源域推定：方舟国内=中文，BytePlus=英文。
	var wrongLang int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official' AND
		((official_scope = 'ark-cn' AND voice_lang <> 'zh') OR (official_scope = 'byteplus' AND voice_lang <> 'en'))`).Scan(&wrongLang).Error; err != nil {
		t.Fatal(err)
	}
	if wrongLang != 0 {
		t.Fatalf("有 %d 条音色语言与资源域对不上", wrongLang)
	}

	// 不再有缩略图单独成行，也没有废弃的渠道溯源列。
	var thumbs int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official_thumb'`).Scan(&thumbs).Error; err != nil || thumbs != 0 {
		t.Fatalf("不应再有 official_thumb 行：%d %v", thumbs, err)
	}
	var cols []string
	if err := db.Raw(`SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'assets'`).Scan(&cols).Error; err != nil {
		t.Fatal(err)
	}
	all := strings.Join(cols, ",")
	for _, want := range []string{"public_url", "thumbnail_url", "official_scope", "voice_age"} {
		if !strings.Contains(all, want) {
			t.Fatalf("assets 缺少列 %s：%s", want, all)
		}
	}
	for _, gone := range []string{"thumbnail_key", "official_channel_key"} {
		if strings.Contains(all, gone) {
			t.Fatalf("assets 不应再有列 %s", gone)
		}
	}
}

// 渠道的公开素材资源域列由同一个迁移加上，已有渠道按 base_url 回填。
func TestOfficialVoicesMigration_ChannelVoiceScope(t *testing.T) {
	db := isolatedDB(t)
	runReal(t, db)
	var n int64
	if err := db.Raw(`SELECT count(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'ai_channels' AND column_name = 'voice_scope'`).Scan(&n).Error; err != nil || n != 1 {
		t.Fatalf("ai_channels 应有 voice_scope 列：%d %v", n, err)
	}
}
