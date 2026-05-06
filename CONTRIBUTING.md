# 贡献指南

参考 [Agent Skills 规范](https://github.com/anthropics/skills)；本仓采用根目录 + `skills/<skill-name>/` 的集合布局。

1. Fork 本仓库。
2. 在 `skills/{skill-name}/` 下新增或修改技能，**每个技能目录必须包含 `SKILL.md`**。
3. `SKILL.md` 建议 **500 行以内**；长表、JSON Schema 细节放在 `skills/{skill-name}/references/`。
4. 若技能含可执行脚本，请在 `SKILL.md` 写明依赖与安装步骤；并补充/更新 `test/` 与 CI。
5. 提交 Pull Request，在描述中说明变更与是否破坏 profile JSON 等契约。
