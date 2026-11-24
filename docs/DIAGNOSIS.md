# 会话工具定义消耗：归因与实测

日期：2026-11-20（Asia/Shanghai）。运行版本：DSH 0.2.2-rc.5。

## 结论

不是 Codex-like 误调用 REA。目标任务没有 REA 业务调用；问题是 **REA 大型输入 schema + Host 工具全量继承/披露**。预设选择工作流不会自动减少注册表中的可见工具。

原 Codex-like 自身只有一般工程工具组合，但继承了 Host 的 REA 注册目录。DSH Native executor 将全部可见能力投影为模型工具；PTC 将全部可见能力转换成 SDK，换承载位置不等于按需加载。Standard、Minimal、Cordis、Codex-like 的继承路径及 PTC 的 SDK 路径均有此放大条件，但不能从一个会话推断所有预设的精确计费相同。

## 原始样本

会话 `session-c043da76-9035-4528-8d36-346c7d771464`，任务：本机 Yazi 默认用 Neovim 打开文档。

路线 `zhuzi / gpt-6.2-sol`，reasoning `high`。主流程 5 次模型请求、5 次工具调用，另有独立标题生成请求但缺 usage，不计入下表。

| step | 行为 | 未缓存输入 | 缓存输入 | 输出 |
| --- | --- | ---: | ---: | ---: |
| 1 | bash 版本/变量/目录 | 141377 | 0 | 163 |
| 2 | 配置文档 + bash 帮助/包路径 | 619 | 141056 | 115 |
| 3 | 版本对应默认配置 | 7456 | 141568 | 43 |
| 4 | 配置合并说明 | 3172 | 148736 | 72 |
| 5 | 回答，不修改文件 | 1427 | 151808 | 390 |
| 合计 | | 154051 | 583168 | 783 |

总输入 737219，含输出共 738002；输入约 79.1% 命中缓存。第一次请求贡献约 91.8% 未缓存输入。实际金额须使用服务商价格，不把缓存读取按未缓存价格计算。

工具定义 235 项、794382 字符，其中 REA 207 项、775016 字符（97.56%）；其他 28 项、19367 字符。两个分组分别 JSON 序列化，括号/逗号导致加总比整体多 1 字符。最大单项 `mcp__rea__compare_web_captures` 为 166651 字符，约占所有工具定义长度 21%。主要是输入 schema 的嵌套结构，而非返回结果。

无 subagent、重试、Goal、TODO、compaction；只有一个稳定的 request/header。没有重复注册导致目录逐步累加的证据。

工具返回 39189 字符，三个网页约 36648 字符，是次要优化点。运行耗时约 77.8s，模型约 75.5s，工具约 2.0s；不能将模型耗时全部归因于工具定义。组合 shell 中 `yazi --help` 的 TTY 错误被最终成功命令的退出码掩盖，也值得改善探测停止条件。

## 精确历史 schema 的离线对照

把样本 request/header 中的精确 schema 注册到真实安装的 DSH ToolsService，使用无模型、无业务副作用的 fixture 加载本插件：

| 条件 | 工具数 | JSON 字符 | DSH /4 启发式估算 |
| --- | ---: | ---: | ---: |
| 原始 | 235 | 794382 | 198600 |
| 默认披露 | 13 | 8747 | 2191 |

未执行历史工具的任何业务 body。此对照验证定义缩减，不是新的 provider usage，也不是账单降幅。

## 已安装 profile 的真实请求头

独立 bundle `@local/dsh-tool-disclosure@0.1.0` 已启用，管理器最终返回 `application: applied`、warnings 空；插件条目 `include:local-tool-disclosure` active。REA 与所有五个预设条目仍 active。

当前 Cordis 会话 `session-3ffcc8b1-1f70-4152-bff9-4d586d8bbb3f` 的真实日志：

| header seq | 条件 | 定义数 | JSON 字符 | REA 项数 |
| --- | --- | ---: | ---: | ---: |
| 1382 | 启用前 | 246 | 810054 | 207 |
| 1922 | 启用后初始（含此前已激活的正式 Plan 退出工具） | 14 | 9220 | 0 |
| 1934 | 本轮按需启用 5 个管理/检查工具后 | 19 | 15419 | 0 |

当前会话实际调用 `tool_search` 找到 `cordis_inspect_query`，再用 `tool_activate` 选择 5 个精确名称，下一 step 成功调用检查工具。随后还选择了 `edit`、`write`、`get_goal`，证实非 MCP 工具同样走按需通道。这是生产 Host 的真实披露/激活证据，不等于 Yazi 同模型对照或所有预设模型验收。

## 修复与限制

- 初次安装校验因 CLI 校验进程无 `DSH_INSTALL_DIR` 导入失败；已改为从实际 CLI 启动脚本 realpath 锚定安装位置并严格校验 DSH 包名/版本，添加无该变量的独立子进程导入回归。重试启用成功。
- 31 项离线检查覆盖 native/PTC、状态恢复、fork 前缀、多 Agent、多 preset、条件、重绑定、名称碰撞和卸载；PTC 源码求值边界用 in-process fixture，执行器/SDK/管道/日志为真实 DSH。
- 覆盖 Host/preset **继承工具**；DSH restrict 不隐藏 Agent 自己注册的私有工具，不将其误称为安全沙箱。
- 搜索返回注册目录元数据，不代表权限/条件已经通过；激活不绕过其他 mask、Skill、Plan、审批或原来的参数校验。
- 可选 Inspect 统计 provider 在本 profile 的列表中未出现，本次生产验证直接读取真实 request/header，不依赖该可选诊断通道。
- 真实 Yazi 同路线 A/B、其他预设逐个新会话的模型成功率、Windows 实机、GUI 图标显示仍待验证；不从字符缩减推导固定价格或耗时降幅。
