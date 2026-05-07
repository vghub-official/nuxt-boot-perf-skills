# Nuxt 冷启动与首屏阶段（摘要）

详细量级与日志顺序建议在**业务仓库**自维护的专题文档中编写，并与本技能 `references` 交叉引用（可选）。

## SSR（首字节 HTML）

1. Nitro / 服务端中间件  
2. Nuxt `*.server` 插件  
3. 根组件 `app.vue` 在服务端 setup（含可能 **阻塞** 的顶层 `await`：`useAsyncData` / `useLazyAsyncData` 未设 lazy、或自定义 composable 内的串行请求）  
4. 页面 setup、`@nuxt/content` 等  
5. 输出 HTML  

**要点**：多数「分钟级」体感延迟不在 SSR 本身，而在浏览器侧。若 **TTFB 很短** 仍整体很慢，先把瓶颈放在 CSR；若 **TTFB 本身很长**，再沿本条由上往下查服务端阻塞。

## CSR / Hydration（用户感知「页面活了」）

- 文档与入口脚本（dev 下 Vite 与体积会放大耗时）  
- 客户端插件链  
- 路由与壳、`app:beforeMount`  
- 根组件客户端 setup（顶层 `await` 仍会阻塞后续客户端生命周期树；与 SSR 共用一套 setup 时，同一串 await 在两端各跑一次）  
- 布局与首屏子树 chunk 拉取与执行（限速 / 禁缓存下，`domContentLoaded` 与「根可用」可能差一个数量级）  
- 路由页 setup、根 `onMounted`、Suspense / 异步子树  

**要点**：`app:mounted` 很早但 **根组件 `onMounted`（若打了 profile mark，以此为准）** 很晚时，优先查 **布局 chunk、顶层 await 数据依赖、常驻重弹窗、大依赖、外链 CDN 资源、Content/MDC、DevTools**。本技能附带脚本以「根 `app.vue` 中约定的 mounted 标记」为采样边界，不等价于 Navigation Timing 的 `load`。

## 决策提示

- **bootstrap 日志很快、根 `onMounted` 极慢**：多为 **chunk 拉取与执行**、**顶层 await 仍在等数据**、或 **外链静态资源（图片/字体）**；不一定是 Pinia 门控写错。  
- **服务端数据层很慢**：查根/页 setup 是否在服务端做了不必要的串行 await、是否该用 `lazy` / 拆分关键路径与非关键路径。
