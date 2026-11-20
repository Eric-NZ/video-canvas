# 公开参考音色数据

Seedance 视频节点可以引用「参考音色」。这些音色是上游素材库里的公开素材，不属于任何用户，
在库里表现为 `assets` 表的系统公共记录（`source=official` / `user_id=0`，缩略图是 `source=official_thumb`）。
本目录把**记录（SQL）与文件（压缩包）**一起随仓库分发，避免出现「代码合并了、音色库却是空的」：
新环境拉下代码、跑一条 SQL、把文件放进存储，就有完整的 181 条音色。

## 内容

| 文件 | 说明 |
|---|---|
| `assets.sql` | 362 条记录的导入语句：181 条音频 + 181 条缩略图，含名字、资源域、分类标签、文件大小与 SHA-256 |
| `pack.tar.gz` | 这些记录指向的文件本身（解包后是 `files/<文件名>`），约 41 MB |
| `SHA256SUMS.txt` | 上面每个文件的 SHA-256，用于解包后逐个核对 |

- 资源域 `ark-cn`（方舟国内站）80 条，中文音色；`byteplus`（BytePlus 国际站）101 条，英文音色。
- 分类标签取自上游素材库的卡片标签（年龄-性别-名字），不是按名字猜的：`voice_age`
  （child / teen / young / middle / older）、`voice_gender`、`voice_lang`。
- SQL 里只有对象 key（`o0/202611/...`）与文件名，**不含任何服务地址、域名或凭据**；
  记录写在哪个存储由目标环境的「存储配置」决定。

## 导入

**第一步：把文件放进存储。** SQL 写的是记录，记录里的 key 必须在存储里真实存在，否则有记录没声音。

本地磁盘存储（默认方式）：解包到数据目录下对应的 key 路径。

```bash
tar -xzf seed/official-voices/pack.tar.gz -C /tmp/voice-pack
mkdir -p "$APP_STORAGE_LOCAL_DIR/o0/202611"
mv /tmp/voice-pack/files/* "$APP_STORAGE_LOCAL_DIR/o0/202611/"
```

对象存储（S3 / OSS / COS 等）：把解包出来的 `files/` 同步到「对象 key 前缀」，即
`<path_prefix>/o0/202611/`，用云厂商客户端或 `aws s3 cp --recursive` 均可，路径要与 SQL 里的 key 一致。

**第二步：导入记录。** 记录会落在**当前默认存储**上（`storage_id` 从 `storage_configs` 现查，不写死），
没有默认存储时会直接报错而不是猜到别处去。

```bash
psql "$APP_DATABASE_DSN" -f seed/official-voices/assets.sql
```

容器里：

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < seed/official-voices/assets.sql
```

导入结束会打印两个计数，都应是 181：

```text
 voices | thumbnails
--------+------------
    181 |        181
```

## 行为

- **幂等**：按对象 key 与官方素材 ID 双重判重，重复执行不会多出行；中途中断可以直接重跑。
- **只写素材表**：不动渠道、不动模型配置。`official_channel_key` 一律留空——它只作溯源，
  能不能用 `asset://` 由任务渠道的资源域与音色的 `official_scope` 决定，与导入时的渠道无关。
- **缩略图单独建行**（`source=official_thumb`）：`/files/<key>` 要靠它反查缩略图所在的存储。
- 如果换了存储需要重导：先删除该环境里 `source in ('official','official_thumb')` 的记录，
  再重新执行 SQL（文件也要同步到新存储）。

## 校验

```bash
# 解包后核对每个文件的哈希（应输出 362 个 OK）
cd /tmp/voice-pack/files && sha256sum -c /path/to/seed/official-voices/SHA256SUMS.txt | grep -c OK
```

`assets.sql` 里的 `sha256` 与 `SHA256SUMS.txt` 出自同一批文件，两者对不上说明包被换过或清单被改过。

## 边界

- 这些素材是上游公开素材库的转存件，只用于本功能的参考音频；不要拿去做别的分发或商用。
- 新增音色：先在上游素材库确认素材 ID，再把记录追加进 `assets.sql`、文件加进 `pack.tar.gz`、
  同步更新 `SHA256SUMS.txt`，不要手写库里的行。
- `asset://` 只在同资源域内有效。跨域（例如方舟渠道用 BytePlus 音色）会回退成音频文件地址，
  这是预期行为，不是导入失败。
