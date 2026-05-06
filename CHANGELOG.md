# Changelog

## 0.1.1

- 落地 `package.json`、`.gitignore`、`verify-env.mjs`、`test/` 契约测试、`.github/workflows/ci.yml`、根目录 `LICENSE`。
- `docs/artifacts-to-extract.md` 改为工程路径索引。
- `npm test` 使用 `test/*.test.mjs`（避免部分 Node 版本下 `node --test test/` 解析异常）。

## 0.1.0

- 集合仓 `nuxt-boot-perf-skills`；技能 `nuxt-boot-timing`、`verify-env`、profile 输出 JSON 契约测试骨架。
