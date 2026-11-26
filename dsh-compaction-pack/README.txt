# @dsh-external/dsh-compaction-pack

DSH 上下文压缩替换包：用一个可调参、可改提示词、保留证据链的压缩后端，替换 `standard` 预设里的
`@deepseek-ai/dsh-compaction-basic`，并在 Web 插件页提供一张设置卡片。

## 它解决什么

随包后端在实测里会一次吞掉 30-46 万 token、压成一条约 11 KB 的英文八段摘要，且阈值、保留、提示词
全是冻结常量。本包做三件事：

1. **策略可调**：触发阈值、逐字保留尾部、摘要输出上限、重试次数、溢出保留、摘要路由、语言，
   全部是 `volatile()` 字段，改完对下一次压缩生效，不用重启。
2. **提示词可改**：检查点指令是设置卡片里的文本域，清空即回退到最小指令，可做 A/B 对照。
3. **保留证据链**：指令要求逐字保留用户原话、纠正、精确路径/命令/数值/错误串，旧结论被推翻时写
   「旧 -> 被新取代」而不是静默删除。

事务、锁、计量、投影、工具配对边界仍沿用随包后端（本插件继承 `BasicCompactionEngine`），只替换
`compactIfNeeded` 的策略来源与 `summarize` 的指令。

## 结构

| 路径 | 作用 |
|---|---|
| `lib/tuning.js` | Host：`compaction-tuning` 行，唯一配置源，提供服务 `compactionTuning` |
| `lib/engine.js` | Host：`compaction-engine` 行，装在预设的 `compaction` 隔离组里，提供 `compaction` |
| `lib/client.js` | 浏览器半：插件页「内置插件配置 -> 压缩调参」卡片 |
| `cordis.patch.yml` | 由 `tools/gen-patch.mjs` 生成：根行两条 + `preset-standard` 覆盖 |
| `tools/gen-patch.mjs` | 从当前 DSH 安装的 `standard.patch.yml` 重新生成覆盖层 |
| `tools/selfcheck.mjs` | 安装后自检：两个 Host 半能加载、引擎仍覆盖正确的钩子、补丁齐全 |
| `tools/install.ps1` | 目标机：建 `node_modules/@deepseek-ai` 联接并跑自检 |

## 安装（本机）

已安装：插件页 -> 插件 -> 压缩调参。命令行等价物：

```powershell
dsh plugin add <pack-dir>
```

## 移植到其它设备

1. 复制整个目录（`node_modules` 不用带，它会重建）。
2. 按目标机的 DSH 版本重新生成预设覆盖层——**DSH 升级后必须重做这一步**：

   ```powershell
   node tools/gen-patch.mjs [<dsh-web-app>/presets/standard.patch.yml]
   ```

   不给参数时依次尝试 `DSH_WEB_APP_DIR`、目标机已安装的 `@deepseek-ai/dsh-web-app`、
   `$DSH_PROFILE_DIR/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml`，以及本包 `node_modules` 联接解析到的同一包。
3. 建依赖联接并自检：

   ```powershell
   pwsh tools/install.ps1
   pwsh tools/install.ps1 -ProfileDir D:\other\profiles\web
   ```

4. 在插件页「添加插件」选择本目录安装；或 `dsh plugin add <目录>`。
5. **新开一个会话**验证（已有会话保留它启动时的预设版本）：
   - 插件页 -> 内置插件配置，出现「压缩调参」；
   - 改一个阈值并保存，重开卡片后值仍在；
   - 需要真跑一次压缩时，看会话日志的 `compaction/summary` 事件是否由本引擎产生（`provider/model`
     与 `shadowedTokenCount` 与你设置的路由/阈值一致）。

## 可调项

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | true | 自动压力压缩与溢出恢复总开关（`/compact` 不受影响） |
| `thresholdRatio` | 0.35 | 压力达到窗口比例即触发；1M 窗口约 35 万 token |
| `headroomTokens` | 65536 | 输出预算之外的压力余量 |
| `retainRatio` | 0.30 | 逐字保留尾部占消息预算的比例 |
| `retainTokens` | 空 | 绝对保留预算，填了覆盖比例 |
| `maxSummaryTokens` | 65536 | 单次检查点输出上限 |
| `compactionRetries` | 1 | 一次触发内的追加压缩次数 |
| `maxOverflowRetries` | 1 | 提供方确认溢出后的重试次数 |
| `overflowRetainTokens` | 0 | 溢出恢复时保留的逐字尾部；0 = 只留最后一个节点 |
| `summarizationProvider/Model` | 空 | 摘要路由；空 = 跟随最近作答模型 |
| `language` | auto | 检查点语言：跟随对话 / 中文 / 英文 |
| `prompt` | 内置长指令 | 检查点指令文本，清空回退到最小指令 |
| `outputCapEnabled` | true | 是否对每个路由的 `max_tokens` 收上限 |
| `outputCapDefault` | 98304 | 未命中覆盖时的输出预留上限 |
| `outputCapByPreset` | `{}` | JSON：`{"ptc":393216}`，预设 id → 上限 |
| `outputCapByWorkspace` | `{}` | JSON：`{"D:\\\\work\\\\repo":196608}`，cwd 前缀 → 上限 |

### 输出预留（outputCap）

`maxTokens` 是压缩阈值天花板的直接输入：`threshold ≤ W − O − B`。1M 窗口、预留 393,216 时天花板只有 541,248；降到 98,304 后是 **836,160**。本机 36,795 条实际输出：p99 9,739、最大 52,749，98,304 有 1.9 倍余量。

钳制发生在 `agent/request` 出口，对所有模型一视同仁；解析顺序 `预设 → cwd 最长前缀 → 默认`。改完对下一个请求生效，不用重启。注意：它改变的是 harness 的预算口径与单轮输出上限，不是提供方的窗口校验——实测有 800k 输入的请求成功，说明提供方并不按预留拒绝。
## 与随包后端的行为差异

- **只有 `standard` 预设被替换**；`ptc` / `minimal` / `cordis` 仍用 `compaction-basic`。
- **`/compact` 仍是随包语义**：本插件只覆盖自动压力与溢出两条路径，手动命令走继承的
  `compactNow()`，即除最后一个节点外全部压缩。需要小步手动压缩时，调低阈值让它自动触发，不要按 `/compact`。
- **没有上游改动**：`compaction-basic` / `tool-result-pruner` 的字段仍不可在界面调；本包用自己的
  `compaction-tuning` 命名空间，因此也不会随上游升级自动获得新字段。
- **摘要请求仍复用会话自己的系统提示词与工具**（沿用随包的 KV cache 复用），所以指令位于尾部 user
  消息，权重低于独立 system prompt；本包用更硬的措辞与「不得删除」规则补偿。

## 回滚

插件页 -> 插件 -> 本包 -> 移除。移除后 `preset-standard` 恢复为 DSH 随包定义，新会话回到
`compaction-basic`。已有会话不受影响。

## 已知限制

- `lib/engine.js` 依赖 `BasicCompactionEngine` 的构造 config 与三个可覆盖钩子（`compactIfNeeded`、
  `summarize`、继承的 `compactRegion`）。DSH 升级后先跑 `tools/selfcheck.mjs`；失败说明上游签名变了，
  需要按新签名调整 `src/engine.mjs` 并重新打包。
- 打包时 `@deepseek-ai/*` 全部作为外部依赖，靠 `node_modules/@deepseek-ai` 联接解析；目标机若把 DSH
  装在别处，`install.ps1` 的联接目标要指向该安装的 `node_modules/@deepseek-ai`。
- 摘要仍是「一次替换」，不是账本；反复压缩仍会重写上一份检查点。指令要求保留未决项与取代关系，
  但不能保证零损失。
- 如果之后用 Web 的「Agent 预设」编辑器改过 `standard`，Web 会把完整的 `config.plugins` 写进 profile 层，
  profile 层优先于本包的覆盖层，引擎行会被换回 `compaction-basic`。此时重跑 `tools/gen-patch.mjs` 再重新
  安装本包，或直接在 Web 里把 compaction 组的 `compaction-basic` 行改成
  `@dsh-external/dsh-compaction-pack/engine`。