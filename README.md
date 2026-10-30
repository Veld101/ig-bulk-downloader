# IG Bulk Downloader

批量下载 Instagram 账号的全部图片。

> **本仓库已停止维护浏览器扩展方案。** 原先的实现是一个 Chrome 扩展（修补某个闭源扩展的 "Download All" 按钮），已删除，原因见下方「为什么放弃插件方案」。

当前推荐做法：用 [`gallery-dl`](https://github.com/mikf/gallery-dl) 配合登录态 cookies，脚本在 [`img-operation`](https://github.com/Veld101/img-operation) 仓库的 `img_dl.py`。

## 为什么放弃插件方案

原扩展走 Instagram 的私有接口：

- `getAccount()` → `GET /api/v1/users/web_profile_info/`
- `appendToItems()` → `GET /api/v1/feed/user/<user>/username/?count=12&max_id=<cursor>`

Instagram 收紧限制后，这个老接口翻到第 1～2 页就不再返回 `next_max_id`。实测一个 **358 帖**的账号，只拿到 **153 张图**，而且**没有任何报错**——脚本自己认为已成功完成。

后续逐一验证过替代路径，全部走不通：

| 尝试 | 结果 |
|---|---|
| REST `/api/v1/feed/user/.../username/` | 第 1～2 页后静默截断；带完整 header 时返回登录页 HTML |
| 手搓 GraphQL（`doc_id` + `variables`） | `error 1357004`，缺 `__dyn`/`__csr`/`fb_dtsg`/`lsd`/`jazoest` 等页面指纹参数 |
| `window.require` 调 IG 自己的 Relay | `PolarisProfilePostsQuery` 是空 fragment，取不到数据 |
| 页面滚动加载 + DOM 收集 | 滚到 `scrollY + innerHeight === scrollHeight` 后高度冻结，IG 不再加载 |
| `gallery-dl` | ✅ **555 张 / 326 个帖子**，轮播正确展开 |

根因是 Instagram 用一整套动态指纹参数校验请求来源，脚本无法可靠伪造。`gallery-dl` 长期跟进这套接口变化，是更合适的选择。

## 迁移到 gallery-dl

完整说明见 `img-operation` 仓库的 `README-igdl.md`。核心三步：

```powershell
# 1. 安装
python -m pip install -U gallery-dl

# 2. 从已登录的 instagram.com 导出 cookies.txt
#    Chrome 扩展 "Get cookies.txt LOCALLY" → Export → 存为 ig-cookies.txt
#    （Chrome 156+ 有 App-Bound Encryption，--cookies-from-browser 解不开）

# 3. 下载
python img_dl.py <账号名>
```

关键点：cookies 里**必须有 `sessionid`**。缺它时 Instagram 按匿名处理，分页会被截断——这正是老方案只拿到 153 张的原因。

## 仓库现状

```
ig-bulk-downloader/
├─ README.md          本文件
├─ LICENSE            LGPL-3.0（继承自原反编译目标，见下）
└─ .gitignore
```

插件代码（`extension/`、`patch/`）已从工作区删除，仍可通过 git 历史取回：

```powershell
git log --oneline -- extension/
git checkout <commit> -- extension/
```

## 许可与致谢

- 原方案基于 **InstagramDownloader**（HuiiBuh），LGPL-3.0
  <https://github.com/igdownloader/InstagramDownloader>
- 目标对象是闭源的 **Turbo Downloader for Instagram 4.12.16**（反编译自发布包，无公开源码）
- 因此保留 LGPL-3.0，见 `LICENSE`

插件代码删除后，本仓库仅存文档；`LICENSE` 予以保留以便追溯历史。
