package drama

import (
	"encoding/json"
	"strings"
)

// BoardHashes 从短剧画布里取出已经出图的故事板节点：片段 ID → 出图时原稿的 SHA-256。
// 故事板是画布上的图片节点，data.drama.board 记着它属于哪个片段（前端写入，字段是 camelCase）；
// 没有图、或还是本地 blob（上传中）的不算。空画布返回空表。
func BoardHashes(payload []byte) (map[string]string, error) {
	out := map[string]string{}
	if len(payload) == 0 {
		return out, nil
	}
	var canvas struct {
		Nodes []struct {
			Data struct {
				Src   string `json:"src"`
				Drama *struct {
					Board *struct {
						SegmentID  string `json:"segmentId"`
						SourceHash string `json:"sourceHash"`
					} `json:"board"`
				} `json:"drama"`
			} `json:"data"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(payload, &canvas); err != nil {
		return nil, err
	}
	for _, node := range canvas.Nodes {
		d := node.Data
		if d.Drama == nil || d.Drama.Board == nil || d.Drama.Board.SegmentID == "" {
			continue
		}
		if d.Src == "" || strings.HasPrefix(d.Src, "blob:") {
			continue
		}
		out[d.Drama.Board.SegmentID] = d.Drama.Board.SourceHash
	}
	return out, nil
}
