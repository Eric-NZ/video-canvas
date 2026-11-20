import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { listAllOfficialVoices } from "@/api/official-voice";
import { OfficialPane } from "@/components/assets/asset-picker-panes";
import service from "@/utils/requests/service";

const voice = (id: number, name: string) => ({
  id,
  kind: "audio",
  url: `https://cdn.test/${id}.mp3`,
  file_name: name,
  thumbnail_url: `https://cdn.test/${id}.png`,
  scope: "ark-cn",
  voice_age: "young",
  voice_gender: "male",
  voice_lang: "zh",
});

describe("素材选择器「音色库」面板", () => {
  let get: Mock<typeof service.get>;
  let html = "";

  beforeEach(async () => {
    get = spyOn(service, "get") as unknown as Mock<typeof service.get>;
    get.mockResolvedValue({ items: [voice(1, "云舟"), voice(2, "佩奇猪")], total: 2 } as never);
    // 先取一次全量填上缓存，面板首屏就带着音色（服务端渲染不跑 effect）
    await listAllOfficialVoices();
    html = renderToStaticMarkup(
      <OfficialPane q="" selected={[]} rules={{ limit: 3 } as never} onToggle={() => {}} />,
    );
  });
  afterEach(() => get.mockRestore());

  test("面板有缓存时首屏就出音色卡，不停在加载中", () => {
    expect(html).toContain('aria-label="云舟"');
    expect(html).toContain('aria-label="佩奇猪"');
  });

  test("不再放资源域与 asset 引用的说明文字", () => {
    expect(html).not.toContain("两套资源各自独立");
    expect(html).not.toContain("BytePlus");
    expect(html).not.toContain("asset 地址");
  });

  test("语言、人群和资产页一样是下拉，不再是两排平铺的胶囊按钮", () => {
    expect(html).toContain('aria-label="语言"');
    expect(html).toContain('aria-label="人群"');
    // 平铺的胶囊带 role=group 与选项按钮；下拉里的选项要点开才渲染
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain("男孩");
  });
});
