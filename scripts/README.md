# 演员表维护

`scripts/update_actor_aliases.py` 用于人工更新 `erosia/data/actor_aliases.json`，提供抓取和离线构建两个命令。脚本不参与服务启动或生产镜像构建。

## 抓取

在仓库根目录运行，需安装 uv。脚本复用项目的 API 配置及原子写入，因此使用 `requirements.txt` 中的项目依赖。Python 3.15、环境及缓存由 uv 管理，放在仓库外。

```sh
uv run --no-project --python 3.15 --with-requirements requirements.txt scripts/update_actor_aliases.py fetch \
  --snapshots /path/outside/repository/actors-2026-10-31
```

每次更新使用一个新的快照目录；同一轮中断后使用原目录续抓。已有快照通过校验后跳过；损坏或格式异常时停止，可移走对应文件后继续。目录必须在仓库外，不要把不同语言或不同批次的快照混在一起。

请求使用项目 `erosia/settings.py` 中的 `ApiSettings`，固定访问 `/api/v1/actors`，语言为 `en-US`，类型仅为 `type=0`（有码）与 `type=1`（无码）。每类抓取第 1–204 页，每页最多 50 条，共 408 次请求；不抓演员详情、欧美或素人列表。

首次请求立即开始，后续请求及重试至少间隔 10 秒，正常抓取约 68 分钟。连接错误、HTTP 429 和 5xx 最多尝试 5 次，并遵守 `Retry-After`；其他 HTTP 错误和数据结构异常直接停止。原始响应通过校验后原子保存。

## 构建与更新

先在仓库外生成候选文件，检查输出数量、类型计数及摘要：

```sh
uv run --no-project --python 3.15 --with-requirements requirements.txt scripts/update_actor_aliases.py build \
  --snapshots /path/outside/repository/actors-2026-10-31 \
  --output /path/outside/repository/actor_aliases.candidate.json
```

构建要求两类的全部 204 页快照齐全。第 200–204 页与前面页面按 ID 取并集补尾部；同一 ID 数据变化时采用后页记录，并输出变化次数。不同类型复用同一 ID、结构异常或某类没有有效记录时拒绝写入，保留已有输出。

确认候选后，省略 `--output` 即可更新仓库内的演员表，再检查 Git 差异：

```sh
uv run --no-project --python 3.15 --with-requirements requirements.txt scripts/update_actor_aliases.py build \
  --snapshots /path/outside/repository/actors-2026-10-31
git diff --stat -- erosia/data/actor_aliases.json
```

规则如下：

- 顶层只有 `actors`，以 JavDB ID 为键；每条只保留 `type`、日文主名 `name`、可选中文名 `name_zht` 和别名 `other_name`。
- 空主名、非整数 0/1 类型的记录丢弃；空可选字段省略。
- 别名按半角、全角逗号拆分，去空串及日文主名、中文自名；按 NFKC、空白归一化及大小写折叠后的结果去重并排序。
- 按 `(type, ID)` 排序，每人一行，UTF-8、LF 换行。相同快照重复构建字节一致；文件通过完整校验后原子替换。

保存本轮快照及构建输出的 SHA-256，便于复现。演员表更新会影响后续刮削的演员映射、头像匹配和翻译姓名保护；不会重写现有 NFO，补齐缺失仍保留已有演员字段。发布前应检查这些功能，并随程序版本更新生产镜像。
