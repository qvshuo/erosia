<p align="center">
  <img src="erosia/web/assets/favicon.svg" alt="erosia" width="96" height="96" />
</p>

<h1 align="center">erosia <small>/ɪˈrəʊziə/</small></h1>

获取 JAV 视频的信息与图片，供 Emby 展示。

## 部署

```sh
# 克隆此仓库
git clone --depth=1 https://github.com/qvshuo/Eros.git erosia && cd erosia

# 复制配置并创建数据目录
cp docker-compose.example.yml docker-compose.yml
mkdir -p data

# 修改 docker-compose.yml 中的作品目录挂载路径后启动
docker compose up -d --build
```

打开 `http://服务器IP:9307`。

## 使用

1. 选择作品和信息文件夹，按视频或 STRM 的父文件夹名获取信息。点击作品可编辑信息、裁剪封面和查看进度。

2. 下载 [erosia.dll](emby-plugin/erosia.dll?raw=true)，放入 Emby 插件目录，升级时先移除旧版插件 DLL。Docker 部署时，若配置挂载为 `/path/to/emby/config:/config`，则放入 `/path/to/emby/config/plugins/erosia.dll`。

3. 在 Emby 的 Compose 中增加以下挂载，将 `/path/to/erosia` 替换为 erosia 的宿主机绝对路径：

   ```yaml
   volumes:
     - /path/to/erosia/data/metadata:/erosia-metadata:ro
   ```

4. 重启 Emby，在插件中确认信息文件夹为 `/erosia-metadata`，然后刷新媒体库及演员图片。可在演员页补齐或更新 [gfriends](https://github.com/gfriends/gfriends) 头像。

## 操作约定

- **补齐缺失**：保留已有字段、图片和手动留空值，只补缺失内容。
- **重新刮削**：全量替换元数据（包括系列）和自定义图片；新来源没有系列时清空旧系列。抓取或图片处理失败时保留有效旧输出。
- **单源刮削**：只更新候选；在详情中预览、选择字段或整组图片后保存。程序不跨来源自动拼接字段或图片。
- **手动保存**：以完整当前表单为准；系列没有编辑入口，保留当前 NFO 的值。阶段重试只处理失败内容，不重新抓取成功元数据。

剧情只采用作品自身的简介或同一商品的卖家说明，不用标题、评论、演员简介或站点介绍替代。DMM、AIRAV、FC2 和官方无码来源可提供简介，但作品覆盖不保证完整；JavDB API 的 `summary` 可为空，网页回退、JavBus、AVSOX 和 AVbase 不补造剧情。默认来源缺剧情时不会借用其他来源，可在详情中单独选择剧情来源。
