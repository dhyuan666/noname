<h1 align="center">无名杀</h1>

<p align="center">
  <a href="https://github.com/libnoname/noname/actions/workflows/build.yml"><img alt="构建状态" src="https://img.shields.io/github/actions/workflow/status/libnoname/noname/build.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/libnoname/noname/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/libnoname/noname?display_name=tag&style=flat-square"></a>
  <a href="https://github.com/libnoname/noname/releases"><img alt="累计下载" src="https://img.shields.io/github/downloads/libnoname/noname/total?style=flat-square"></a>
  <a href="https://github.com/libnoname/noname/graphs/contributors"><img alt="项目贡献者" src="https://img.shields.io/github/contributors/libnoname/noname?style=flat-square"></a>
  <a href="./LICENSE"><img alt="许可证" src="https://img.shields.io/github/license/libnoname/noname?style=flat-square"></a>
</p>

## 项目使用约定

本项目基于 GPL 3.0 协议开源，使用此项目时请遵守开源协议。  
除此外，希望你在使用代码时已经了解以下额外说明：

1. 打包、二次分发 **请保留代码出处**：<https://github.com/libnoname/noname>
2. 请不要用于商业用途。

## 快速启动

### 环境要求

> **提示：** 请参考 [本地文档](./docs/how-to-start.md) 或 [github文档](https://github.com/libnoname/noname/wiki/%E5%A6%82%E4%BD%95%E8%BF%90%E8%A1%8C%E6%97%A0%E5%90%8D%E6%9D%80%EF%BC%88%E7%A8%8B%E5%BA%8F%E5%91%98%E7%89%88%EF%BC%89) 配置环境。

- [Node.js](https://nodejs.org/) ^20.19.0 || >=22.12.0
- [pnpm](https://pnpm.io/) >= 9
- Webview: Chromium >= 91 || Safari >=16.4.0 (暂不支持Firefox)

### 安装依赖

```bash
pnpm install
```

### 启动

```bash
pnpm dev
```

### 局域网联机

本版本的联机是「独立服务器 + 多个客户端」的结构：先启动一个联机服务器，所有人（包括房主）都作为客户端连上去，再由某个人在服务器里创建房间，其他人加入。客户端自己不能直接开房。

| 组件 | 作用 | 默认端口 |
| --- | --- | --- |
| 联机服务器 `packages/server` | 转发房间和对局消息 | 8082 |
| 游戏文件服务 `packages/fs` | 给页面提供游戏文件（开发模式需要） | 8089 |
| 游戏页面（Vite） | 玩家用浏览器打开的页面 | 8081（仅本机），局域网用 8095 |

所有人必须连同一个 Wi-Fi 或同一个局域网。

#### 1. 查本机局域网 IP

```bash
ipconfig getifaddr en0   # Wi-Fi，没有输出就试 en1
```

下面用 `<IP>` 代表这个地址，例如 `10.0.0.244`。IP 可能随路由器重新分配而变化，每次联机前确认一下。

#### 2. 在房主电脑上启动（在仓库根目录）

需要开三个终端。

```bash
# 终端 1：联机服务器（端口 8082）
pnpm -F @noname/server dev

# 终端 2：游戏文件服务（端口 8089）
pnpm -F @noname/fs dev --dirname=../../apps/core

# 终端 3：对局域网开放的游戏页面（端口 8095）
cd apps/core && pnpm vite dev --host 0.0.0.0 --port 8095 --strictPort
```

第一次使用时，要先构建一次 `@noname/fs`：

```bash
pnpm -F @noname/fs build
```

看到下面这些输出就说明成功：

- 终端 1：`Server listening on port 8082`
- 终端 3：`Network: http://<IP>:8095/`

#### 3. 所有玩家加入

1. 浏览器打开 `http://<IP>:8095`（房主也可以用这个地址，或者用自己原来的页面）。
2. 点「选项 → 开始 → 联机」，再点右下角的「启」。
3. 在「输入联机地址」里填：

   ```
   <IP>:8082
   ```

   注意：开头不要有空格，也不要在前面再加 `ws://`；房主自己也要填局域网 IP，不要填 `127.0.0.1`。
4. 点「连接」。
5. 「联机大厅」留空即可，那是公共大厅服务器的地址，局域网用不到。

#### 4. 创建房间

1. 由房主在连上服务器之后，选择模式（身份、斗地主等）。
2. **建房之前**，先去「武将」「卡牌」标签页确认武将包、卡牌包和禁将设置。房间建好之后再改这些不会生效，只有模式自带的选项（人数、选将时间等）可以通过「更新房间设置」同步。要改就退出房间重建。
3. 点「启」创建房间。
4. 其他玩家连上服务器后，在房间列表里选择加入。

#### 5. 默认武将池

联机的默认值写在 `apps/core/game/config.json`：

| 键 | 含义 |
| --- | --- |
| `connect_characters` | 联机里「关闭」的武将包。当前只开启标准、神话再临、一将成名、SP |
| `connect_cards` | 联机里「关闭」的卡牌包。当前只开启 `standard`（标准）和 `extra`（军争） |
| `connect_<模式>_banned` | 各模式的联机禁将，目前和单机身份场的禁将保持一致 |

这些只是首次使用的默认值。浏览器里如果已经保存过联机设置，保存的设置会覆盖它们，需要在游戏里重置，或者清掉浏览器里该站点的数据。

#### 6. 常见问题

**弹窗提示「连接失败」**
- 在房主电脑上确认服务器在监听：`lsof -iTCP:8082 -sTCP:LISTEN -nP`。
- 地址是否写成了 `<IP>:8082`。只写 IP 的话，客户端会自动补成 8080 端口，那是旧版的端口，会连不上。
- 地址开头有没有多余的空格。
- 从另一台设备试一下能否访问 `http://<IP>:8095`，如果不行，说明是网络层的问题，见下面两条。

**别人打不开 `http://<IP>:8095`**
- 页面没有用 `--host` 启动。直接用 `pnpm dev` 默认只监听本机。
- macOS 弹出「是否允许 node 接受传入网络连接」时必须点「允许」。可以到「系统设置 → 网络 → 防火墙」检查。
- 路由器开了「AP 隔离」或「客户端隔离」时，同一个 Wi-Fi 里的设备互相访问不了，需要在路由器里关闭。

**端口被占用**
启动联机服务器报 `Error: listen EADDRINUSE: address already in use :::8082` 就是这种情况：该端口已被别的进程占用，多半是之前启动的 server 没退出。

1. 查是谁占用了端口（把 `8082` 换成报错里的端口）：
   ```bash
   lsof -nP -iTCP:8082 -sTCP:LISTEN
   ```
   输出里 `PID` 那一列就是要结束的进程号。
2. 确认它是不是自己的旧进程：
   ```bash
   ps -o pid,lstart,command -p <PID>
   ```
   - 命令里包含 `tsx ... src/cli.ts`（联机服务器）、`vite`（游戏页面）等本项目的启动命令，并且是你之前启动的，可以结束。
   - 如果是别的程序（比如其他项目、数据库），不要 kill，改用别的端口，或者关掉那个程序。
3. 结束进程：
   ```bash
   kill <PID>        # 先正常结束
   kill -9 <PID>     # 仍然不退出时才用
   ```
4. 重新启动，并用第 1 步的命令确认端口只有一个监听者。

一条命令清理 8082：`kill $(lsof -nP -tiTCP:8082 -sTCP:LISTEN)`。执行前先看一眼第 1 步的结果。

之前遗留的旧进程还会让新实例自动换端口，导致地址对不上，所以启动前先清理一下。

**页面是 `https` 但连的是 `ws://`**
- 浏览器会拦截这种混合内容。局域网里一律用 `http://` 打开页面。

#### 7. 使用 Electron 版（可选）

仓库里的 `apps/electron` 也可以当客户端使用：

```bash
pnpm -F @noname/fs build     # 只需要构建一次
pnpm -F electron dev
```

它同样是客户端，也要连到上面的联机服务器，不会自己开房。

---

贡献代码可阅读相关文档：

[Git 下载安装指南](https://github.com/libnoname/noname/wiki/Git%E4%B8%8B%E8%BD%BD%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97)

[Github 桌面版客户端使用入门](https://docs.github.com/zh/desktop/overview/getting-started-with-github-desktop)

[如何提交代码到《无名杀》Github 仓库](https://github.com/libnoname/noname/wiki/%E5%A6%82%E4%BD%95%E6%8F%90%E4%BA%A4%E4%BB%A3%E7%A0%81%E5%88%B0%E3%80%8A%E6%97%A0%E5%90%8D%E6%9D%80%E3%80%8BGithub%E4%BB%93%E5%BA%93)

[《无名杀》项目 Pull Request 提交规范](https://github.com/libnoname/noname/wiki/%E3%80%8A%E6%97%A0%E5%90%8D%E6%9D%80%E3%80%8B%E9%A1%B9%E7%9B%AE-Pull-Request-%E6%8F%90%E4%BA%A4%E8%A7%84%E8%8C%83)

客户端下载戳这里：

安卓： <https://github.com/nonameShijian/noname-shijian-android/releases/tag/v1.6.8>

PC:  <https://github.com/nonameShijian/noname/releases/tag/v1.75>

网页端推荐使用 Chrome 系内核浏览器游玩，暂不支持 Firefox 浏览器

请尽量保证游玩的 Chrome 系浏览器或手机 Webview 的`内核版本大于等于91`

---

最近有一伙人号称是《无名杀十周年》的开发团队，宣称《无名杀十周年》“全新无名杀，比旧版拥有更多武将，兼容更多扩展”，实际上:

- 《无名杀十周年》（原《无名杀清瑶版》）由无名杀 v1.9.124 修改而来，属于无名杀的一种**Fork**，并非“全新无名杀”；且《无名杀十周年》开发团队**公然违反 GPL-3.0 协议**，详情请看[这里](https://github.com/github/dmca/blob/master/2023/09/2023-09-20-noname.md)、[这里](https://tieba.baidu.com/p/8623890806)以及[这里](https://tieba.baidu.com/p/8624582238)。
- 《无名杀十周年》至今没有更新神典韦等新机制武将，且删除了部分无名杀的原创武将，导致《无名杀十周年》的武将数量远远不及无名杀前几个版本的武将数量；不仅如此，《无名杀十周年》自分裂后的部分武将源码依然来自无名杀和其他开发者开源的代码。
- 《无名杀十周年》兼容扩展的方式是不更新本体数据，从而导致《无名杀十周年》仍然在用 1.9.124 版本的代码，无法兼容使用 1.10 以后功能的扩展；而且《无名杀十周年》开发团队在使用**大量**GPL-3.0 开源的代码后对生成产物进行了**混淆加密**，在**违反开源精神**的同时，也导致扩展稳定性极具下降，更容易出问题。

《无名杀十周年》就是彻头彻尾的骗局，《无名杀十周年》的开发团队更是一群拿无名杀吸血的骗子，虽然号称“不忘初心”，却公然对最有资格论述无名杀创作初心的无名杀创始人进行侮辱谩骂，直接违背其制定的规则和开源精神，恶劣程度远超当初在多个无名杀社群“自立”的水叶之流。

先秦介子推曾言：“窃人之财，犹谓之盗，况贪天之功以为己力乎。”无名杀社区发展至今，正是因为有大量的开源代码进行参考，才能不断推陈出新。试想每个扩展开发者在成为一个扩展开发者之前，谁敢说没有大量参考社区内的源码？每个作品凝聚的都是大家的心血，而不是仅仅归属于个别人。我们相信：开放、共享、多元才是无名杀的初心，绝不是封闭、私藏与趋同。

我们在此呼吁无名杀社区正确认识《无名杀十周年》开发团队的一些行为与做法，并希望《无名杀十周年》开发团队能反省迄今以来的所作所为。**自由开源**是无名杀社区的灵魂，希望各方都能够遵循这一精神。
