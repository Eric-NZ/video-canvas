package drama_test

import (
	"testing"

	"video-canvas/internal/drama"
)

func TestBoardHashes(t *testing.T) {
	payload := []byte(`{"nodes":[
		{"id":"b1","data":{"kind":"image","src":"/files/1.png","drama":{"episodes":[1],"board":{"segmentId":"5d2a","sourceHash":"h1"}}}},
		{"id":"b2","data":{"kind":"image","src":"","drama":{"episodes":[1],"board":{"segmentId":"5d2b","sourceHash":"h2"}}}},
		{"id":"b3","data":{"kind":"image","src":"blob:local","drama":{"episodes":[1],"board":{"segmentId":"5d2c","sourceHash":"h3"}}}},
		{"id":"a1","data":{"kind":"image","src":"/files/2.png","drama":{"type":"scene","name":"村口","episodes":[]}}},
		{"id":"g1","type":"group","data":{}}
	]}`)
	got, err := drama.BoardHashes(payload)
	if err != nil {
		t.Fatal(err)
	}
	// 只认有图的故事板节点：还没出图、本地上传中（blob）的、普通资产都不算
	if len(got) != 1 || got["5d2a"] != "h1" {
		t.Fatalf("故事板哈希：%v", got)
	}
	if _, err := drama.BoardHashes([]byte(`{`)); err == nil {
		t.Fatal("坏的画布 JSON 要报错")
	}
	if got, err := drama.BoardHashes(nil); err != nil || len(got) != 0 {
		t.Fatalf("空画布：%v %v", got, err)
	}
}
