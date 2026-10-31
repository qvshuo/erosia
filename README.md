<p align="center">
  <img src="erosia/web/assets/favicon.svg" alt="erosia" width="96" height="96" />
</p>

<h1 align="center">erosia <small>/ɪˈrəʊziə/</small></h1>

刮削 JAV 视频元数据。

- 多源刮削：支持 DMM、JavDB、JavBus、FC2、AVSOX、AirAV、1Pondo、Caribbeancom、HEYZO、AVbase；
- 配套插件：Emby 插件直接读取本地 NFO、封面、剧照和演员头像；
- 演员头像：从 gfriends 获取头像，支持日文主名、中文名和别名匹配；
- 封面裁剪：支持人脸检测、居中和手动调整，生成 2:3 封面；
- 自动翻译：配置 AI 翻译服务后，自动翻译标题和剧情；
- 标准格式：使用符合 Emby 规范的 NFO，图片独立保存。

## 部署

```sh
git clone --depth=1 https://github.com/qvshuo/erosia.git erosia && cd erosia
mkdir -p data
cp docker-compose.example.yml docker-compose.yml

# 修改 docker-compose.yml 中的作品目录和项目路径后启动
docker compose up -d --build
```

将 Compose 中的 `/path/to/library` 替换为作品目录，`/path/to/erosia` 替换为 erosia 项目的宿主机绝对路径。

打开 `http://服务器IP:9307`。网页设置中填写容器内路径：作品目录为 `/media`，元数据目录默认为 `/data/metadata`，对应宿主机的 `/path/to/erosia/data/metadata`。

## 使用

1. 设置作品目录和元数据目录，点击 **扫描作品**。视频或 STRM 文件的父文件夹名称须为完整番号，且不能重复。
2. 勾选作品，选择 **补齐缺失** 或 **重新刮削**，点击 **刮削元数据**。
3. 在作品详情中查看结果、编辑字段或调整封面，修改后点击保存。

- **补齐缺失**：保留已有字段、图片和手动设定的空值，仅补充缺失内容。
- **重新刮削**：按选定来源重写元数据和作品图片；已有演员头像保留。
- **更新头像**：在演员页勾选后操作，重新获取头像，不修改 NFO 署名；失败时保留旧图。

### 接入 Emby

1. 下载 [erosia.dll](emby-plugin/erosia.dll?raw=true)，放入 Emby 配置目录下的 `plugins` 文件夹；Docker 部署时，对应容器内的 `/config/plugins`。

2. 在 Emby 的 Compose 服务中挂载元数据目录，左侧填写实际的宿主机绝对路径：

   ```yaml
   volumes:
     - /path/to/erosia/data/metadata:/erosia-metadata:ro
   ```

3. 在 Emby 的 Compose 目录执行以下命令，应用挂载并加载插件；`emby` 替换为实际服务名：

   ```sh
   docker compose up -d --force-recreate emby
   ```

4. 在插件设置中确认 **元数据目录** 为 `/erosia-metadata`，在媒体库的元数据读取器中启用 **erosia**，随后刷新媒体库。

插件直接读取本地文件，无需连接 erosia 服务。后续元数据更新后，刷新 Emby 对应作品即可。
