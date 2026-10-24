<p align="center">
  <img src="erosia/web/assets/favicon.svg" alt="erosia" width="96" height="96" />
</p>

<h1 align="center">erosia <small>/ɪˈrəʊziə/</small></h1>

刮削 JAV 视频元数据以供 Emby 展示。

## 部署

```sh
# 克隆此仓库
git clone --depth=1 https://github.com/qvshuo/Eros.git erosia && cd erosia

# 创建数据目录并复制 Compose 配置
mkdir -p data
cp docker-compose.example.yml docker-compose.yml

# 修改 docker-compose.yml 中的作品目录挂载路径后启动
docker compose up -d --build
```

打开 `http://服务器IP:9307`。

## 使用

1. 设置作品和元数据目录，erosia 将按视频或 STRM 的父文件夹名称刮削作品元数据；

2. 下载 [erosia.dll](emby-plugin/erosia.dll?raw=true)，放入 Emby 插件目录；Docker 部署时，若配置挂载为 `/path/to/emby/config:/config`，则放入 `/path/to/emby/config/plugins/erosia.dll`；

3. 在 Emby 的 Compose 中增加以下挂载，将 `/path/to/erosia` 替换为 erosia 的宿主机绝对路径：

   ```yaml
   volumes:
     - /path/to/erosia/data/metadata:/erosia-metadata:ro
   ```

4. 重启 Emby，在插件中确认信息文件夹为 `/erosia-metadata`，并设置媒体库元数据读取器为 erosia，随后刷新媒体库。
