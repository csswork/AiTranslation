# 世界地图数据

`world-map.json` 是管理员首页使用的本地几何数据，不包含任何用户统计。

- 来源：[Natural Earth](https://www.naturalearthdata.com/)，[公共领域使用条款](https://www.naturalearthdata.com/about/terms-of-use/)。
- 固定版本：[`ca96624a56bd078437bca8184e78163e5039ad19`](https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19/geojson)。
- 国家轮廓：`ne_110m_admin_0_countries.geojson`；小地区定位：`ne_50m_admin_0_countries.geojson` 的 ISO_A2_EH、LABEL_X 和 LABEL_Y。南极洲不参与运营地区统计。
- 投影：Equal Earth，坐标在构建时计算并压缩到一位小数；[公式参考](https://github.com/d3/d3-geo/blob/main/src/projection/equalEarth.js)，应用不使用 D3 或外部地图服务。

下载对应版本的两个 GeoJSON 到本机后，从 `apps/backend` 运行：

```sh
node scripts/build-world-map.mjs /path/ne_110m_admin_0_countries.geojson /path/ne_50m_admin_0_countries.geojson
```

运行时只读取生成的 JSON 并在服务端输出 SVG。低分辨率轮廓未收录的小地区，在有统计时以定位点显示；不调用地图 API，也不将运营统计发送给第三方。轮廓只用于粗略的运营分布展示，不能用于地理测量。
