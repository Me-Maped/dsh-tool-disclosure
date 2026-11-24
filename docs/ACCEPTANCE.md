# 0.1.0 验收清单

## 当前状态

**实现、31 项离线检查、打包 dry-run 和当前 web profile 应用已完成。** 生产 Cordis 会话已记录初始工具面 246→14，按需启用 5 项后为 19，均无 REA 全量目录。下表“待验收”保留为产品/真实模型验收状态，不能把共享注册表夹具等同于各内置预设的端到端模型验收；详见末尾实测记录和 [诊断](<DIAGNOSIS.md>)。GUI、Windows、同模型 Yazi A/B 与逐个预设新会话仍未执行。

原 Codex-like 0.2.0 文件保持原样，本轮重新执行其 12/12 检查通过；该记录只证明原包回归，不充当新插件检查。本包 31 项检查为本包实际结果。更早控制器的 18 项记录不属于此架构，不能借用。

后续验收须由获授权的维护者使用受支持 DSH 管理入口，保存应用结果和 `nextStep`。测试可能写缓存、日志与产物；不得为验收绕过权限或手改 profile。

## 证据记录要求

每例保存日期、DSH / bundle 版本、模型 / 路由、preset 与 revision、Agent / session 归属、权限、平台、MCP / 动态工具目录、原能力集、实际每 step 模型工具定义与 PTC SDK、输入、执行轨迹、session log / fork 边界、命令退出码、预期差异与限制。

区分“工具注册”“schema 进入请求”“模型选择工具”“业务调用执行”四件事；模型口头保证、工具名称出现或 child 摘要不构成完整证据。未运行写待验收，缺环境写具体原因，不填假通过数。

## 全 preset 覆盖矩阵

除下列名称外，现场存在的其他 preset 也必须枚举验收，不能只测 Codex-like 或 REA。

| preset / 路径 | 必查事项 | 状态 |
| --- | --- | --- |
| Standard | 首步 core + 发现入口；其他原有能力 lazy；原权限、条件与能力声明不变 | 待验收 |
| PTC | 同一 mask 收窄 SDK，下一 step 更新；原 PTC 执行入口 / 语义保留，无全量 SDK 旁路 | 待验收 |
| minimal | 仅原本存在的工具可用；core / 激活不补不存在的能力 | 待验收 |
| 其他内置 preset（含现场实际存在的条目） | 逐个记录原能力集与披露后集合，保留各自执行器与条件 | 待验收 |
| Codex-like 0.2.0（若现场存在） | 不改该包文件 / 定位 / 单 preset 行为，仅受独立 Host 披露插件作用 | 待验收 |
| 其他自定义 preset / child | 不继承其他 Agent 的可变集合，不因全局挂载新增业务能力 | 待验收 |

## 契约测试

| # | 场景 | 通过条件 / 证据 | 状态 |
| --- | --- | --- | --- |
| T1 | 首步披露与原目录对照 | 默认 core 仅包含当前 Agent 已存在且有效的 `bash`、`pwsh`、`read`、`read_image`、`glob`、`grep`、`working_directory`、`skill`、`ask_user_question`、`exit_plan_mode`、`job_output`、`job_kill`、`job_list`；另有 `tool_search` / `tool_activate`；其他工具 lazy | 待验收 |
| T2 | 可配置 core；配置不存在工具名，跨 Linux / Windows | 改名单只改披露策略，不挂载工具；没有 shell / skill / plan 工具的 Agent 不凭空获得；记录真实 Config schema 与边界值 | 待验收 |
| T3 | `tool_search({query, offset?, limit?})` 多页与 >8 命中 | 每页最多 8 个精确名称 + 用途，每项用途 ≤240 字符；不返回 schemas / 完整定义；查询覆盖 REA 和非 REA | 待验收 |
| T4 | 空命中、非法分页 / limit、lazy 工具检索 | 明确结果或校验失败；候选来自本 Agent 原合法集合，不被 own mask 自我截断，也不跳过其他约束或搜索全局越界目录 | 待验收 |
| T5 | 单批激活 1 个、8 个、超过 8 个、未知名 / 模糊别名 / 越界名 / 混合批次 | `tool_activate({names})` 精确名称与单批上限明确校验；不构造工具、不静默宣称全成功，结果与实际登记一致 | 待验收 |
| T6 | 当前 step 与激活后下一 step 对照 | 当前调用只登记；下一 step 才公开当前原始 schema；名称、描述、参数及约束未被缩减或重写；返回值不转储 schemas | 待验收 |
| T7 | 重复激活，多批累计 >8，跨多个 step | sticky 累积、无重复定义；8 不是会话总上限；搜索不改变状态 | 待验收 |
| T8 | 业务夹具调用计数器；只执行搜索 / 激活 | 计数保持零；真正业务调用仍需后续显式选择原工具，走原 native / PTC 执行器与原权限 | 待验收 |
| T9 | 同一 Host / preset revision 的两个 root 与兄弟 child | 每 Agent own mask、工具集与激活集合隔离；互不污染，无共享可变 Host / preset Set | 待验收 |
| T10 | parent 激活后 spawn child，再由 child 激活 | child 不复制 parent 的可变集合；child 激活不反向改变 parent 或 sibling；只继承原来允许的能力 | 待验收 |
| T11 | fork 带 parent 历史前缀，再在 child 激活 / 恢复 | parent 前缀中的激活不计作 child 自己的状态；只投影正确 Agent / 边界后的记录；child 自己的记录可恢复 | 待验收 |
| T12 | 保存、重开 / resume、重复处理日志 | 从对应 session log 投影恢复，幂等、不重放业务调用、不重复定义；不读其他 Agent 日志补状态 | 待验收 |
| T13 | MCP / 动态注册移除、加入、断开 / 重连 | 搜索、激活和后续定义收集重校验当前目录；失效工具不公开，新非 core 不自动全部激活；历史选择不越过现有范围 | 待验收 |
| T14 | 同名 schema 更新、恢复时旧名称失效 | 当前有效名称采用当前原始 schema，不沿用旧快照；不可用明确报告，不伪造成功或执行业务 | 待验收 |
| T15 | `conditionalWhen` true / false 切换、其他 mask 排除 | 本插件不覆盖原条件或其他 mask；不因 core / 激活而让原本无效工具变可用 | 待验收 |
| T16 | native 与 PTC 同能力夹具，首步 / 下一 step SDK 比较 | 两路径按同一披露策略；初始 SDK / prompt / 搜索结果无全量 schema 隐藏副本；PTC 通道不切 native，必需执行入口不丢失 | 待验收 |
| T17 | 权限拒绝、批准与真实 plan 未完成 | 激活不是授权，原拒绝 / 批准 / plan 保持；不宣称安全沙箱、硬只读角色或 workflow controller | 待验收 |
| T18 | 独立禁用 / 移除本包再对照工具目录 | 撤销本插件贡献后回原披露方式；原业务注册与 preset 能力不被删除，Codex 包不改；记录是否需新会话及真实 nextStep，不假定热回滚 | 待验收 |

## 静态检查、打包与安装

不在文档虚构不存在的检查脚本；后续以实现提供的实际脚本、Config schema 与 DSH 管理器为准，记录每条命令及退出码。至少核对：

- 包名 `@local/dsh-tool-disclosure`、版本 0.1.0，Host 插件独立挂载；不修改其他 preset 文件或默认选择。
- 默认 core 与文档一致且可配置；原能力与条件、own mask 的候选收集顺序、native / PTC 共用 mask、Agent 日志归属与 fork 边界均有覆盖。
- 分发包含必要实现、配置、本地化与本文档，不以“纯 YAML / 无 Host JS”描述代码插件；无新增 UI 或既有图标变更。
- 打包清单、测试计数、安装 version / application / warnings / nextStep 均来自实际结果，不借用旧包历史。

离线检查不能证明全 preset 运行行为、Windows 实机、GUI、恢复或模型发现质量。安装 applied 也不等于模型 A/B 已通过。

## 模型 A/B 与诊断复核

历史样本（用户提供，非本次复测）：目标 `c043..`，235 tools / 794,382 chars；REA 207 tools / 775,016 chars（约 97.56%）；other 28 tools / 19,367 chars（字符 / 4 估约 4,846 tokens）。分组与总计相差 1 字符。主 5 请求 input 737,219 = cache 583,168 + uncached 154,051；output 783；无 subagent / retry / compaction。

本样本用于定位注册 / 装配后的定义体积，**不是 REA bug、误调用或账单 97.56% 的证据**。不能据此宣称 0.1.0 已降低 token / 成本。

| 对照维度 | 实测要求 | 状态 |
| --- | --- | --- |
| 条件 | 同模型 / 路由、同任务、同权限、同工具目录、同 preset 与起始会话；明确样本数和缓存条件，披露开 / 关对照 | 待验收 |
| schema 体积 | 各 preset 的实际首步与后续 step 工具定义，含 PTC SDK；说明字符 / 字节口径，不只测 REA | 待验收 |
| 真实计量 | input / cached / uncached / output tokens 与请求数量；字符 / 4 只能另列估算 | 待验收 |
| 任务质量与开销 | 成功率、漏发现 / 错误激活、额外往返、耗时、业务轨迹、错误 / 重试 / compaction / child；不得以更小 schema 掩盖能力损失 | 待验收 |
| 成本 | 实际模型价格与缓存口径、全任务总成本；不把 97.56% 字符占比当节省率，不忽略额外搜索请求 | 待验收 |

## 0.1.0 实测补录

| 项目 | 结果 | 待补证据 |
| --- | --- | --- |
| 静态 / 单元 / 集成检查 | `npm run check`：31/31 pass，0 fail/skip，退出码0 | 真实 DSH 注册表、native/PTC执行器/管道/日志；Agent驱动与PTC源码求值用离线夹具，无模型或业务副作用 |
| 打包与内容检查 | `npm run pack:check` dry-run 通过；无发布/生成 tarball | 最终文件数以命令结果为准；包含全部运行模块、测试、元数据、图标与诊断 |
| 安装 / 应用 | 0.1.0；最终 `set_bundle enabled:true` 为 `application:applied`、warnings `[]`；条目 active | 初次无 `DSH_INSTALL_DIR` 导入失败已修复；无该变量的CLI入口导入回归通过；未要求重启 |
| 全 preset 矩阵、T1–T18 | 多preset作用域/native/PTC等离线契约已覆盖；当前Cordis生产请求246→14且按需激活成功 | 不能代替每个内置预设新会话的真实模型/GUI验收；Windows待验 |
| 禁用 / 回滚 | 双owner卸载、已存在Agent挂载/卸载、重新挂载恢复等离线通过 | 未在当前生产profile反复切换禁用，避免扰动其他会话 |
| 模型 A/B / token / 成本 | 历史原schema离线235→13；生产当前会话头246→14（14项含Plan退出），非同任务A/B | Yazi同路线完整任务、成功率、耗时与价格仍待用户样本；不能把字符缩减当账单比例 |
