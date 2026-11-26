DSH 压缩替换包
==============

DSH（DeepSeek Harness）上下文压缩替换包与配套 skill 的发布仓库，用于跨设备取用。
文档统一以 .txt 提供，便于直接阅读与复制。

目录
----
dsh-compaction-pack/          可安装 bundle：Host 半 + 浏览器半 + 补丁 + 工具
  README.txt                  安装、调参项、行为差异、回滚、已知限制
  cordis.patch.yml            由 tools/gen-patch.mjs 生成（含 preset-standard 覆盖）
  lib/                        预构建产物，安装时直接使用
  src/                        源码；改完用 esbuild 重新打包
  tools/                      gen-patch / selfcheck / client-smoke / anchor-survey / install.ps1

dsh-compaction-pack-skill/    技能形态
  SKILL.txt                   四条硬约束 + 落地六步 + 四级验证 + 踩坑表
  references/rebuild.txt      逐条重建手册（含实测命令与期望输出）
  references/architecture.txt 数据流、为何拆两半、可调项、失败模式
  references/files/           全部源码副本（原样复制即可）

安装（目标机）
--------------
1. 复制 dsh-compaction-pack 到任意目录
2. node tools/gen-patch.mjs [<dsh-web-app>/presets/standard.patch.yml]
   DSH 升级后必须重跑，预设插件列表是版本相关数据
3. pwsh tools/install.ps1 -ProfileDir <profile 目录>
   建 node_modules 联接并跑两个自检
4. 插件页 → 添加插件 → 选该目录 → 新开一个会话

版本
----
1.1.2  gen-patch 改为按环境变量与已安装包解析预设路径；文档示例路径改为通用写法
1.1.1  修复：Cordis 通过 Proxy 解析服务，类内私有字段导致预设挂载失败
1.1.0  新增 outputCap：对全部路由的请求输出预留统一收上限，卡片可改
1.0.0  首个可用版本：可调阈值/保留/摘要路由/检查点指令 + 插件页设置卡片